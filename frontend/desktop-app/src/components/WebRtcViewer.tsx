/**
 * WebRtcViewer — 基于 WebRTC 连接 debian_screen_control 服务的投屏组件
 *
 * 工作流程：
 *  1. 建立 WebSocket 连接到  ws://<host>:<port>/ws
 *  2. 发送 { type: "connect", ice_server: [...] } 触发服务端建立 PeerConnection
 *  3. 服务端返回 SDP Offer（Base64），浏览器创建 Answer 并回传
 *  4. ICE 候选双向交换，P2P 链路建立后 <video> 接收 H.264 + Opus 流
 *  5. DataChannel 用于鼠标/键盘控制指令
 *
 * 与 NoVncViewer 的接口风格保持一致，便于在群控页面中统一使用。
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { createLogger } from "@/lib/logger";

const logger = createLogger("webrtc-viewer");

export type WebRtcConnectionState = "disconnected" | "connecting" | "connected" | "failed";

/** 控制指令类型（对应 debian_screen_control DataChannel JSON 协议） */
export type ControlMessage =
  | { type: "touch"; x: number; y: number }
  | { type: "d_left"; x: number; y: number }
  | { type: "u_left"; x: number; y: number }
  | { type: "d_right"; x: number; y: number }
  | { type: "u_right"; x: number; y: number }
  | { type: "s_up" }
  | { type: "s_down" }
  | { type: "input"; text: string }
  | { type: "code"; action: 0 | 1; code: number }
  | { type: "reset_video"; width: number; height: number; bitrate: number; fps: number };

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
  /** debian_screen_control 服务的可访问 host */
  host: string;
  /** debian_screen_control 服务端口（默认 8077） */
  port: number;
  /** 设备 token（对应 debian_screen_control ./token 文件内容） */
  token: string;
  /** TURN/STUN 服务器配置，跨网络时需要 */
  iceServers?: RTCIceServer[];
  /** 是否接管本组件的鼠标/键盘输入并发送控制（单独使用时为 true，群控从设备为 false） */
  captureInput?: boolean;
  /** 连接状态变更回调 */
  onStateChange?: (state: WebRtcConnectionState) => void;
  /** 额外 CSS 类名 */
  className?: string;
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
      iceServers = [],
      captureInput = false,
      onStateChange,
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
    // 标记是否已收到服务端消息（区分 Token 错误和 ICE 失败）
    const msgReceivedRef = useRef(false);

    const [connState, setConnState] = useState<WebRtcConnectionState>("disconnected");
    const [videoSize, setVideoSize] = useState({ width: 1920, height: 1080 });
    const [errorReason, setErrorReason] = useState("");

    const updateState = useCallback((s: WebRtcConnectionState, reason = "") => {
      setConnState(s);
      if (reason) setErrorReason(reason);
      onStateChangeRef.current?.(s);
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
      if (!host || !port || !instanceId) return;
      disconnect();
      setErrorReason("");
      msgReceivedRef.current = false;
      updateState("connecting");

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      // 通过本地后端代理连接（避免直连设备公网 IP 遭 NAT/CSP 拦截）
      const wsUrl = `${protocol}//127.0.0.1:8080/api/instance/${instanceId}/webrtc?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&token=${encodeURIComponent(token)}`;
      logger.info("webrtc:connect:start", { instanceId, wsUrl });

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

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
        dc.onopen = () => logger.info("webrtc:datachannel:open", { instanceId });
        dc.onclose = () => logger.info("webrtc:datachannel:close", { instanceId });
        dc.onmessage = (e) => {
          // 服务端通过 DataChannel 发送 notify 消息（如切换完成），目前仅记录日志
          try {
            const data = JSON.parse(e.data as string);
            logger.debug("webrtc:datachannel:msg", { instanceId, data });
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
        logger.info("webrtc:pc-state", { instanceId, state: pc.connectionState });
        switch (pc.connectionState) {
          case "connected":
            updateState("connected");
            break;
          case "failed":
            updateState("failed", "ICE连接失败（无法穿透NAT，请配置STUN/TURN服务器）");
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
        logger.info("webrtc:ws:open", { instanceId });
        // 发送 connect 消息，触发服务端建立 PeerConnection 并发 offer
        ws.send(JSON.stringify({
          type: "connect",
          ice_server: iceServers,
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

        switch (msg.type) {
          case "offer": {
            // SDP Offer 是 Base64 编码的 JSON
            if (!msg.sdp) return;
            let offerInit: RTCSessionDescriptionInit;
            try {
              offerInit = JSON.parse(atob(msg.sdp));
            } catch (_) {
              logger.error("webrtc:offer:decode-failed", { instanceId });
              return;
            }
            await pc.setRemoteDescription(new RTCSessionDescription(offerInit));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            const encodedAnswer = btoa(JSON.stringify(pc.localDescription));
            ws.send(JSON.stringify({ type: "answer", sdp: encodedAnswer }));
            logger.info("webrtc:answer:sent", { instanceId });
            break;
          }
          case "candidate": {
            if (!msg.sdp) return;
            try {
              const candidate = JSON.parse(atob(msg.sdp)) as RTCIceCandidateInit;
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
              logger.warn("webrtc:candidate:add-failed", { instanceId, error: String(e) });
            }
            break;
          }
          case "error":
            logger.error("webrtc:server-error", { instanceId, message: msg.message });
            updateState("failed", `服务端错误: ${msg.message ?? "unknown"}`);
            break;
        }
      };

      ws.onerror = (e) => {
        logger.error("webrtc:ws:error", { instanceId, error: String(e) });
        updateState("failed", `后端代理连接失败 (ws://127.0.0.1:8080 → ${host}:${port})`);
      };

      ws.onclose = (e) => {
        logger.info("webrtc:ws:close", { instanceId, code: e.code, reason: e.reason });
        // 若还未 connected 则标记失败
        setConnState((prev) => {
          if (prev === "connecting") {
            let reason: string;
            if (!msgReceivedRef.current) {
              // 从未收到服务端任何消息——几乎可确定是 Token 错误
              reason = `Token 错误或 debian_screen_control 服务未运行（服务端收到请求后立即关闭，没有回应）`;
            } else {
              reason = e.reason ? `服务端关闭: ${e.reason}` : `WebSocket关闭 (code=${e.code})`;
            }
            setErrorReason(reason);
            onStateChangeRef.current?.("failed");
            return "failed";
          }
          return prev;
        });
      };
    }, [host, port, instanceId, token, iceServers, disconnect, updateState]);

    // host/port/token 变化时重新建立连接
    useEffect(() => {
      if (host && port && instanceId) {
        connect();
      }
      return disconnect;
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
