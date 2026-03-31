/**
 * NoVncViewer — 使用 noVNC (RFB over WebSocket) 实现真实 VNC 连接
 *
 * 工作流程：
 *  1. 建立 WebSocket 连接到后端 /api/instance/:id/vnc
 *  2. 发送 JSON 凭据 {host, port, password} 作为首帧
 *  3. 后端桥接 WebSocket ↔ VNC TCP（RFB 协议）
 *  4. noVNC RFB 类接管后续所有 RFB 握手和画面渲染
 */
import { useCallback, useEffect, useRef, useState } from "react";
import RFB from "@novnc/novnc/lib/rfb.js";
import { consoleApi } from "@/api/console";
import { createLogger } from "@/lib/logger";

const logger = createLogger("novnc-viewer");

export type VncConnectionState = "disconnected" | "connecting" | "connected" | "failed";

export interface NoVncViewerProps {
  /** 实例 ID */
  instanceId: string;
  /** 认证 token */
  token: string;
  /** VNC 服务器公网 IP */
  host: string;
  /** VNC 映射端口 */
  port: number;
  /** VNC 密码 */
  password: string;
  /** 连接状态回调 */
  onStateChange?: (state: VncConnectionState) => void;
  /** RFB 实例变更回调（同步控制用） */
  onRfbChange?: (rfb: any | null) => void;
  /** 额外 CSS 类名 */
  className?: string;
}

/**
 * VNC 查看器组件
 * 挂载时自动连接，卸载时自动断开
 */
export function NoVncViewer({
  instanceId,
  token,
  host,
  port,
  password,
  onStateChange,
  onRfbChange,
  className = "",
}: NoVncViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const onRfbChangeRef = useRef(onRfbChange);
  onRfbChangeRef.current = onRfbChange;
  const [state, setState] = useState<VncConnectionState>("disconnected");

  const updateState = useCallback((s: VncConnectionState) => {
    setState(s);
    onStateChange?.(s);
  }, [onStateChange]);

  /** 建立 VNC 连接 */
  const connect = useCallback(() => {
    if (!containerRef.current || !host || !instanceId || !token) return;

    // 清理旧连接
    if (rfbRef.current) {
      onRfbChangeRef.current?.(null);
      try { rfbRef.current.disconnect(); } catch (_) {}
      rfbRef.current = null;
    }

    updateState("connecting");
    logger.info("vnc:connect:start", { instanceId, host, port });

    // 构建 WebSocket URL — host/port 作为 query 参数，后端用于建立 TCP 连接
    const wsUrl = consoleApi.getVncWsUrl(instanceId, token, host, port);

    // noVNC 需要 "binary" 子协议
    const rfb = new RFB(containerRef.current, wsUrl, {
      wsProtocols: ["binary"],
      credentials: { password },
    });

    // 画面自适应容器大小
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.background = "#0a1628";

    rfb.addEventListener("connect", () => {
      logger.info("vnc:connect:success", { instanceId, host, port });
      updateState("connected");
      onRfbChangeRef.current?.(rfb);

      // 在捕获阶段监听 keydown，在 noVNC 处理之前拦截 Ctrl+V
      // noVNC 会吞掉键盘事件直接发到远端，导致浏览器 paste 事件不触发
      // 所以在 Ctrl+V 按下时主动读取本地剪贴板并同步到远端 VNC 剪贴板
      const keyHandler = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "v" && (rfb as any)._rfbConnectionState === "connected") {
          navigator.clipboard.readText().then((text) => {
            if (text) {
              (rfb as any).clipboardPasteFrom(text);
            }
          }).catch(() => {});
        }
      };
      document.addEventListener("keydown", keyHandler, true); // capture phase
      (rfb as any)._localKeyHandler = keyHandler;
    });

    rfb.addEventListener("disconnect", (e) => {
      logger.info("vnc:disconnect", { instanceId, clean: e.detail?.clean });
      // 清理键盘监听
      const keyHandler = (rfb as any)._localKeyHandler;
      if (keyHandler) {
        document.removeEventListener("keydown", keyHandler, true);
      }
      updateState(e.detail?.clean ? "disconnected" : "failed");
      if (rfbRef.current === rfb) {
        rfbRef.current = null;
        onRfbChangeRef.current?.(null);
      }
    });

    rfb.addEventListener("securityfailure", (e) => {
      logger.error("vnc:security-failure", { instanceId, status: e.detail?.status, reason: e.detail?.reason });
      updateState("failed");
    });

    // 部分 VNC 服务器在握手中途再次请求凭据时触发此事件
    // 此时直接回传 password，避免连接挂起
    rfb.addEventListener("credentialsrequired", () => {
      logger.warn("vnc:credentials-required", { instanceId });
      try {
        (rfb as any).sendCredentials({ password });
      } catch (e) {
        logger.error("vnc:credentials-send-failed", { instanceId, err: String(e) });
      }
    });

    rfbRef.current = rfb;
  }, [instanceId, token, host, port, password, updateState]);

  // 凭据就绪时建立连接
  useEffect(() => {
    if (host && port && instanceId && token) {
      connect();
    }
    return () => {
      // 使用快照指针：即使 disconnect 事件把 rfbRef.current 置 null，
      // 这里的 snapshot 仍能正确断开本次 effect 创建的连接
      const snapshot = rfbRef.current;
      rfbRef.current = null;
      if (snapshot) {
        onRfbChangeRef.current?.(null);
        try { snapshot.disconnect(); } catch (_) {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, token, host, port, password]);

  return (
    <div
      ref={containerRef}
      className={`novnc-container ${className}`}
      style={{ width: "100%", height: "100%", background: "#0a1628" }}
    />
  );
}
