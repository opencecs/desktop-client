/**
 * RemoteDesktop 组件 — 基于 iframe 嵌入上游 VNC 控制台页面
 * 上游 Console URL 已包含完整的 web 版 VNC 查看器，直接嵌入即可
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "@/lib/logger";

const logger = createLogger("remote-desktop");

/** 连接状态 */
export type VncConnectionState = "disconnected" | "connecting" | "connected" | "failed";

export interface RemoteDesktopProps {
  /** 上游 Console URL（web 版 VNC 查看器地址） */
  consoleUrl: string;
  /** 连接状态变化回调 */
  onStateChange?: (state: VncConnectionState) => void;
  /** 额外的 CSS 类名 */
  className?: string;
}

/**
 * 远程桌面组件
 * 使用 iframe 嵌入上游提供的 web 版 VNC 查看器
 */
export function RemoteDesktop({
  consoleUrl,
  onStateChange,
  className = "",
}: RemoteDesktopProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [connState, setConnState] = useState<VncConnectionState>("disconnected");

  /** 更新连接状态并通知父组件 */
  const updateState = useCallback(
    (state: VncConnectionState) => {
      logger.info("vnc:state-change", { state, url: consoleUrl });
      setConnState(state);
      onStateChange?.(state);
    },
    [consoleUrl, onStateChange],
  );

  // URL 变化时更新状态
  useEffect(() => {
    if (consoleUrl) {
      logger.info("vnc:loading", { url: consoleUrl });
      updateState("connecting");
    } else {
      updateState("disconnected");
    }
  }, [consoleUrl, updateState]);

  /** iframe 加载完成回调 */
  const handleLoad = useCallback(() => {
    logger.info("vnc:iframe-loaded", { url: consoleUrl });
    updateState("connected");
  }, [consoleUrl, updateState]);

  /** iframe 加载失败回调 */
  const handleError = useCallback(() => {
    logger.error("vnc:iframe-error", { url: consoleUrl });
    updateState("failed");
  }, [consoleUrl, updateState]);

  if (!consoleUrl) {
    return (
      <div className={`remote-desktop-container ${className}`} data-state="disconnected" />
    );
  }

  return (
    <div className={`remote-desktop-container ${className}`} data-state={connState}>
      <iframe
        ref={iframeRef}
        src={consoleUrl}
        className="remote-desktop-iframe"
        title="Remote Desktop"
        sandbox="allow-scripts allow-same-origin allow-popups"
        allowFullScreen
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  );
}
