/**
 * WebRtcViewer — 基于 WebRTC 连接 debian_screen_control 服务的投屏组件
 *
 * 工作流程：
 *  1. 建立 WebSocket 连接到后端代理 ws://127.0.0.1:8080/api/instance/{id}/webrtc
 *  2. 发送 { type: "connect", token } 触发服务端建立 PeerConnection
 *  3. 服务端返回 SDP Offer（Base64），浏览器创建 Answer 并回传
 *  4. ICE 候选双向交换，P2P 链路建立后 <video> 接收 H.264 + Opus 流
 *  5. DataChannel 用于鼠标/键盘控制指令
 *
 * 设备端已配置公网 IP 直连，无需 STUN/TURN 服务器。
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { createLogger } from "@/lib/logger";

const logger = createLogger("webrtc-viewer");

export type WebRtcConnectionState = "disconnected" | "connecting" | "connected" | "failed";

/** 控制指令类型（对应 debian_screen_control DataChannel JSON 协议） */
export type ControlMessage =
  | { type: "touch"; x: number; y: number }
  | { type: "mouse_relative"; x: number; y: number }
  | { type: "d_left"; x: number; y: number }
  | { type: "u_left"; x: number; y: number }
  | { type: "d_right"; x: number; y: number }
  | { type: "u_right"; x: number; y: number }
  | { type: "s_up" }
  | { type: "s_down" }
  | { type: "input"; text: string }
  | { type: "code"; action: 0 | 1; code: number }
  | { type: "reset_video"; width: number; height: number; bitrate: number; fps: number }
  | { type: "get_clipboard" };

export interface WebRtcViewerHandle {
  /** 向该设备发送控制指令 */
  sendControl: (msg: ControlMessage) => void;
  /** 当前连接状态 */
  connectionState: WebRtcConnectionState;
  /** 视频元素的实际分辨率（用于群控坐标归一化） */
  videoSize: { width: number; height: number };
}

export interface WebRtcViewerProps {
  /** 实例 ID（用于日志和 key） */
  instanceId: string;
  /** debian_screen_control 服务的可访问 host（公网 IP） */
  host: string;
  /** debian_screen_control 服务端口（TCP 公网映射端口，用于 WebSocket） */
  port: number;
  /** debian_screen_control 的 session token（通过登录 /api/login 获取） */
  token: string;
  /** 是否接管本组件的鼠标/键盘输入并发送控制（单独使用时为 true，群控从设备为 false） */
  captureInput?: boolean;
  /** 连接状态变更回调 */
  onStateChange?: (state: WebRtcConnectionState) => void;
  /** 被顶掉（kicked）或忙碌（busy）回调 */
  onKicked?: (message: string) => void;
  onBusy?: (message: string) => void;
  /** 额外 CSS 类名 */
  className?: string;
}

/**
 * 改写 SDP 以请求最高视频画质：
 * 1. 添加 b=AS 和 b=TIAS 高带宽上限（8Mbps）
 * 2. 设置 H.264 profile-level-id 为 4d0032（High Profile Level 5.0）
 */
function enhanceSdpForQuality(sdp: string): string {
  const lines = sdp.split("\n");
  const result: string[] = [];
  let inVideoMedia = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    result.push(line);

    // 追踪当前 media section
    if (line.startsWith("m=video")) {
      inVideoMedia = true;
    } else if (line.startsWith("m=")) {
      inVideoMedia = false;
    }

    // 在 video media section 的端口行后插入带宽声明
    if (inVideoMedia && line.startsWith("m=video")) {
      result.push("b=AS:8000");
      result.push("b=TIAS:8000000");
    }

    // 替换 H.264 profile-level-id 为 High Profile
    if (line.includes("profile-level-id=")) {
      result[result.length - 1] = line.replace(
        /profile-level-id=[0-9a-fA-F]{6}/,
        "profile-level-id=4d0032",
      );
    }
  }

  return result.join("\n");
}

/**
 * WebRTC 投屏查看器组件（支持 forwardRef 暴露 sendControl 给父组件用于群控广播）
 */
export const WebRtcViewer = forwardRef<WebRtcViewerHandle, WebRtcViewerProps>(
  function WebRtcViewer(
    {
      instanceId,
      host,
      port,
      token,
      captureInput = false,
      onStateChange,
      onKicked,
      onBusy,
      className = "",
    },
    ref,
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const dcRef = useRef<RTCDataChannel | null>(null);
    const onStateChangeRef = useRef(onStateChange);
    onStateChangeRef.current = onStateChange;
    const onKickedRef = useRef(onKicked);
    onKickedRef.current = onKicked;
    const onBusyRef = useRef(onBusy);
    onBusyRef.current = onBusy;
    // 标记是否已收到服务端消息（区分 Token 错误和连接失败）
    const msgReceivedRef = useRef(false);

    const [connState, setConnState] = useState<WebRtcConnectionState>("disconnected");
    const [videoSize, setVideoSize] = useState({ width: 1920, height: 1080 });
    const [errorReason, setErrorReason] = useState("");

    const updateState = useCallback((s: WebRtcConnectionState, reason = "") => {
      setConnState(s);
      if (reason) setErrorReason(reason);
      // 延迟通知父组件，避免在渲染阶段触发父组件 setState
      queueMicrotask(() => onStateChangeRef.current?.(s));
    }, []);

    /** 向 DataChannel 发送控制指令 */
    const sendControl = useCallback((msg: ControlMessage) => {
      const dc = dcRef.current;
      if (!dc || dc.readyState !== "open") return;
      try {
        dc.send(JSON.stringify(msg));
      } catch (e) {
        logger.warn("webrtc:send-control:failed", { instanceId, error: String(e) });
      }
    }, [instanceId]);

    /** 暴露句柄给父组件（群控使用） */
    useImperativeHandle(ref, () => ({
      sendControl,
      connectionState: connState,
      videoSize,
    }), [sendControl, connState, videoSize]);

    /** 断开并清理所有连接资源 */
    const disconnect = useCallback(() => {
      logger.info("webrtc:disconnect", { instanceId });
      const dc = dcRef.current;
      const pc = pcRef.current;
      const ws = wsRef.current;
      dcRef.current = null;
      pcRef.current = null;
      wsRef.current = null;

      try { dc?.close(); } catch (_) {}
      try { pc?.close(); } catch (_) {}
      try { ws?.close(); } catch (_) {}
    }, [instanceId]);

    /** 建立 WebRTC 连接 */
    const connect = useCallback(() => {
      console.log("[WebRtcViewer] connect()", { host, port, instanceId, hasToken: !!token });
      if (!host || !port || !instanceId) {
        console.log("[WebRtcViewer] connect() skipped: missing", { host: !host, port: !port, instanceId: !instanceId });
        return;
      }
      logger.info("webrtc:connect:begin", { instanceId, host, port, hasToken: !!token });
      disconnect();
      setErrorReason("");
      msgReceivedRef.current = false;
      updateState("connecting");

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//127.0.0.1:8080/api/instance/${instanceId}/webrtc?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&device_token=${encodeURIComponent(token)}`;
      logger.info("webrtc:connect:start", { instanceId, wsUrl });

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // 设备端已配置公网 IP 直连，无需 STUN/TURN
      const pc = new RTCPeerConnection({ iceServers: [] });
      pcRef.current = pc;

      // 用于缓存在 setRemoteDescription 完成前到达的 ICE candidates
      let remoteDescSet = false;
      const pendingCandidates: RTCIceCandidateInit[] = [];

      // 接收远端音视频流，挂载到 <video>
      pc.ontrack = (ev) => {
        const video = videoRef.current;
        if (!video || !ev.streams[0]) return;
        if (video.srcObject !== ev.streams[0]) {
          video.srcObject = ev.streams[0];
          video.play().catch(() => {});
          logger.info("webrtc:track:attached", { instanceId, kind: ev.track.kind });
        }
      };

      // 接收服务端创建的 DataChannel
      pc.ondatachannel = (ev) => {
        const dc = ev.channel;
        dcRef.current = dc;
        dc.binaryType = "arraybuffer";
        const sendResetVideo = () => {
          try {
            dc.send(JSON.stringify({ type: "reset_video", width: 1920, height: 1080, bitrate: 8000, fps: 60 }));
            logger.info("webrtc:reset_video:sent", { instanceId, width: 1920, height: 1080, bitrate: 8000, fps: 60 });
          } catch (_) {}
        };
        dc.onopen = () => {
          logger.info("webrtc:datachannel:open", { instanceId });
          // 立即发送一次 reset_video
          sendResetVideo();
          // 延迟再发一次，确保设备端编码器已初始化
          setTimeout(sendResetVideo, 2000);
          setTimeout(sendResetVideo, 5000);
        };
        dc.onclose = () => logger.info("webrtc:datachannel:close", { instanceId });
        dc.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data as string);
            logger.debug("webrtc:datachannel:msg", { instanceId, data });
            if (data.type === "kicked") {
              updateState("failed", data.message || "其他设备已连接，当前连接被断开");
              disconnect();
              queueMicrotask(() => onKickedRef.current?.(data.message || "其他设备已连接，当前连接被断开"));
            } else if (data.type === "busy") {
              updateState("failed", data.message || "设备忙碌中");
              queueMicrotask(() => onBusyRef.current?.(data.message || "设备忙碌中"));
            }
          } catch (_) {}
        };
      };

      // ICE 候选收集完毕后通过 WS 发给服务端
      pc.onicecandidate = (ev) => {
        if (!ev.candidate || ws.readyState !== WebSocket.OPEN) return;
        const encoded = btoa(JSON.stringify(ev.candidate.toJSON()));
        ws.send(JSON.stringify({ type: "candidate", sdp: encoded }));
      };

      pc.onconnectionstatechange = () => {
        console.log("[WebRtcViewer] pc.connectionState =", pc.connectionState, { instanceId });
        logger.info("webrtc:pc-state", { instanceId, state: pc.connectionState });
        switch (pc.connectionState) {
          case "connected":
            updateState("connected");
            // 连接建立后定期打印视频统计（分辨率、码率、帧率）
            {
              let lastBytes = 0;
              const statsInterval = setInterval(() => {
                if (pc.connectionState !== "connected") {
                  clearInterval(statsInterval);
                  return;
                }
                pc.getStats().then((stats) => {
                  stats.forEach((report) => {
                    if (report.type === "inbound-rtp" && report.kind === "video") {
                      const bytesDelta = (report.bytesReceived ?? 0) - lastBytes;
                      lastBytes = report.bytesReceived ?? 0;
                      const bitrateKbps = Math.round(bytesDelta * 8 / 1000);
                      logger.info("webrtc:video-stats", {
                        instanceId,
                        resolution: `${report.frameWidth ?? "?"}x${report.frameHeight ?? "?"}`,
                        fps: report.framesPerSecond ?? "?",
                        bitrateKbps,
                        codec: report.codecId ?? "?",
                      });
                    }
                  });
                }).catch(() => {});
              }, 5000);
            }
            break;
          case "failed":
            updateState("failed", "WebRTC连接失败");
            // 连接失败后主动关闭 WebSocket，释放设备端连接槽位
            try { ws.close(); } catch (_) {}
            break;
          case "closed":
            updateState("failed", "WebRTC连接已关闭");
            break;
          case "disconnected":
            updateState("disconnected");
            break;
        }
      };

      ws.onopen = () => {
        console.log("[WebRtcViewer] ws.onopen", { instanceId });
        logger.info("webrtc:ws:open", { instanceId });
        ws.send(JSON.stringify({
          type: "connect",
          token,
        }));
      };

      ws.onmessage = async (ev) => {
        msgReceivedRef.current = true;
        let msg: { type: string; sdp?: string; message?: string };
        try {
          msg = JSON.parse(ev.data as string);
        } catch (_) {
          return;
        }
        console.log("[WebRtcViewer] ws.onmessage", { instanceId, type: msg.type });

        switch (msg.type) {
          case "offer": {
            if (!msg.sdp) return;
            let offerInit: RTCSessionDescriptionInit;
            try {
              offerInit = JSON.parse(atob(msg.sdp));
            } catch (_) {
              logger.error("webrtc:offer:decode-failed", { instanceId });
              return;
            }
            await pc.setRemoteDescription(new RTCSessionDescription(offerInit));
            remoteDescSet = true;
            // 处理在 setRemoteDescription 之前到达的候选
            for (const c of pendingCandidates) {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            }
            pendingCandidates.length = 0;
            const answer = await pc.createAnswer();
            // 改写 SDP 以请求最高画质
            if (answer.sdp) {
              answer.sdp = enhanceSdpForQuality(answer.sdp);
            }
            await pc.setLocalDescription(answer);
            const encodedAnswer = btoa(JSON.stringify(pc.localDescription));
            ws.send(JSON.stringify({ type: "answer", sdp: encodedAnswer }));
            console.log("[WebRtcViewer] answer sent", { instanceId });
            logger.info("webrtc:answer:sent", { instanceId });
            break;
          }
          case "candidate": {
            if (!msg.sdp) return;
            try {
              const candidate = JSON.parse(atob(msg.sdp)) as RTCIceCandidateInit;
              if (remoteDescSet) {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } else {
                pendingCandidates.push(candidate);
              }
            } catch (e) {
              console.warn("[WebRtcViewer] addIceCandidate failed", { instanceId, error: String(e) });
              logger.warn("webrtc:candidate:add-failed", { instanceId, error: String(e) });
            }
            break;
          }
          case "error":
            logger.error("webrtc:server-error", { instanceId, message: msg.message });
            updateState("failed", `服务端错误: ${msg.message ?? "unknown"}`);
            break;
          case "kicked":
            logger.info("webrtc:kicked", { instanceId, message: msg.message });
            updateState("failed", msg.message || "其他设备已连接，当前连接被断开");
            disconnect();
            queueMicrotask(() => onKickedRef.current?.(msg.message || "其他设备已连接，当前连接被断开"));
            break;
          case "busy":
            logger.info("webrtc:busy", { instanceId, message: msg.message });
            updateState("failed", msg.message || "设备忙碌中");
            queueMicrotask(() => onBusyRef.current?.(msg.message || "设备忙碌中"));
            break;
        }
      };

      ws.onerror = (e) => {
        console.error("[WebRtcViewer] ws.onerror", { instanceId, type: (e as any)?.type, readyState: ws.readyState });
        logger.error("webrtc:ws:error", { instanceId, error: String(e), type: (e as any)?.type, readyState: ws.readyState });
        updateState("failed", `后端代理连接失败 (ws://127.0.0.1:8080 → ${host}:${port})`);
      };

      ws.onclose = (e) => {
        console.log("[WebRtcViewer] ws.onclose", { instanceId, code: e.code, reason: e.reason, wasClean: e.wasClean });
        logger.info("webrtc:ws:close", { instanceId, code: e.code, reason: e.reason, wasClean: e.wasClean, readyState: ws.readyState });
        setConnState((prev) => {
          if (prev === "connecting") {
            let reason: string;
            if (!msgReceivedRef.current) {
              reason = `Token 错误或投屏服务未运行（服务端收到请求后立即关闭，没有回应）`;
            } else {
              reason = e.reason ? `服务端关闭: ${e.reason}` : `WebSocket关闭 (code=${e.code})`;
            }
            setErrorReason(reason);
            queueMicrotask(() => onStateChangeRef.current?.("failed"));
            return "failed";
          }
          return prev;
        });
      };
    }, [host, port, instanceId, token, disconnect, updateState]);

    // 用 ref 持有最新的 connect/disconnect，避免 useEffect 依赖闭包导致无限循环
    const connectRef = useRef(connect);
    connectRef.current = connect;
    const disconnectRef = useRef(disconnect);
    disconnectRef.current = disconnect;

    // host/port/token 变化时重新建立连接
    useEffect(() => {
      if (!host || !port || !instanceId) return;
      let cancelled = false;
      const timer = setTimeout(() => {
        if (!cancelled) connectRef.current();
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(timer);
        disconnectRef.current();
      };
    }, [instanceId, host, port, token]);

    // ── 输入捕获（captureInput=true 时激活，单台独立控制模式） ──
    useEffect(() => {
      if (!captureInput) return;
      const video = videoRef.current;
      if (!video) return;

      const getRelativeCoords = (e: MouseEvent) => {
        const rect = video.getBoundingClientRect();
        const scaleX = videoSize.width / rect.width;
        const scaleY = videoSize.height / rect.height;
        return {
          x: Math.round((e.clientX - rect.left) * scaleX),
          y: Math.round((e.clientY - rect.top) * scaleY),
        };
      };

      let lastMoveTime = 0;
      const onMouseMove = (e: MouseEvent) => {
        const now = Date.now();
        if (now - lastMoveTime < 20) return; // 50Hz 节流
        lastMoveTime = now;
        const { x, y } = getRelativeCoords(e);
        sendControl({ type: "touch", x, y });
      };

      const onMouseDown = (e: MouseEvent) => {
        const { x, y } = getRelativeCoords(e);
        if (e.button === 0) sendControl({ type: "d_left", x, y });
        else if (e.button === 2) sendControl({ type: "d_right", x, y });
      };

      const onMouseUp = (e: MouseEvent) => {
        const { x, y } = getRelativeCoords(e);
        if (e.button === 0) sendControl({ type: "u_left", x, y });
        else if (e.button === 2) sendControl({ type: "u_right", x, y });
      };

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        sendControl({ type: e.deltaY < 0 ? "s_up" : "s_down" });
      };

      const onKeyDown = (e: KeyboardEvent) => {
        e.preventDefault();
        sendControl({ type: "code", action: 0, code: e.keyCode });
      };

      const onKeyUp = (e: KeyboardEvent) => {
        e.preventDefault();
        sendControl({ type: "code", action: 1, code: e.keyCode });
      };

      // 中文/IME 输入支持：通过隐藏 input 捕获 compositionend
      const inputEl = document.createElement("input");
      inputEl.style.cssText = "position:absolute;left:-9999px;top:-9999px;opacity:0;width:1px;height:1px;";
      video.parentElement?.appendChild(inputEl);

      const onFocusInput = () => inputEl.focus();
      video.addEventListener("mousedown", onFocusInput);

      inputEl.addEventListener("compositionend", (e: CompositionEvent) => {
        if (e.data) {
          sendControl({ type: "input", text: e.data });
          inputEl.value = "";
        }
      });

      inputEl.addEventListener("input", (e: Event) => {
        const ie = e as InputEvent;
        if (ie.isComposing) return;
        if (ie.data) {
          sendControl({ type: "input", text: ie.data });
          inputEl.value = "";
        }
      });

      video.addEventListener("mousemove", onMouseMove);
      video.addEventListener("mousedown", onMouseDown);
      video.addEventListener("mouseup", onMouseUp);
      video.addEventListener("wheel", onWheel, { passive: false });
      video.setAttribute("tabIndex", "0");
      video.addEventListener("keydown", onKeyDown);
      video.addEventListener("keyup", onKeyUp);
      video.addEventListener("contextmenu", (e) => e.preventDefault());

      return () => {
        video.removeEventListener("mousemove", onMouseMove);
        video.removeEventListener("mousedown", onMouseDown);
        video.removeEventListener("mouseup", onMouseUp);
        video.removeEventListener("wheel", onWheel);
        video.removeEventListener("keydown", onKeyDown);
        video.removeEventListener("keyup", onKeyUp);
        video.removeEventListener("mousedown", onFocusInput);
        inputEl.remove();
      };
    }, [captureInput, sendControl, videoSize]);

    // 视频元数据加载后更新实际分辨率
    const onLoadedMetadata = useCallback(() => {
      const video = videoRef.current;
      if (!video) return;
      setVideoSize({ width: video.videoWidth, height: video.videoHeight });
      logger.info("webrtc:video:metadata", {
        instanceId,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    }, [instanceId]);

    return (
      <div
        className={`webrtc-viewer ${className}`}
        data-state={connState}
        style={{ width: "100%", height: "100%", background: "#0a1628", position: "relative" }}
      >
        {/* 连接状态浮层 */}
        {connState !== "connected" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#8899aa",
              fontSize: 13,
              userSelect: "none",
              flexDirection: "column",
              gap: 8,
              padding: "0 12px",
              textAlign: "center",
            }}
          >
            {connState === "connecting" ? (
              <span>连接中...</span>
            ) : connState === "failed" ? (
              <>
                <span style={{ color: "#e55", fontWeight: 600 }}>连接失败</span>
                {errorReason && (
                  <span style={{ fontSize: 11, color: "#cc9988", wordBreak: "break-all" }}>
                    {errorReason}
                  </span>
                )}
                <button
                  onClick={connect}
                  style={{
                    marginTop: 4,
                    padding: "3px 14px",
                    fontSize: 12,
                    background: "#1a3a5c",
                    color: "#aaccee",
                    border: "1px solid #2a5090",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  重新连接
                </button>
              </>
            ) : (
              <span>未连接</span>
            )}
          </div>
        )}
        <video
          ref={videoRef}
          onLoadedMetadata={onLoadedMetadata}
          autoPlay
          playsInline
          muted={false}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      </div>
    );
  },
);
