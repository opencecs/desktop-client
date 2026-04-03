/**
 * WebRTC 投屏画面墙 — 通过 iframe 嵌入设备 debian_screen_control Web 页面
 *
 * URL: /webrtc-screen-wall?ids=CECS-001,CECS-002,CECS-003
 *
 * 工作原理：
 *  - 每台设备通过端口映射暴露 debian_screen_control 服务（:8077）
 *  - 前端用 iframe 直接嵌入 http://<natPublicIp>:<publicPort>/ 页面
 *  - WebRTC 连接由 iframe 内的原始页面自行处理
 */
import React, {
  useCallback,
  useMemo,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { useEnsurePortMapping } from "@/lib/use-ensure-port-mapping";

/** debian_screen_control 服务端口 */
const WEBRTC_PORT = 8077;

/** 最大同时投屏设备数 */
const MAX_SCREENS = 9;

/** 布局列数 */
type LayoutCols = 1 | 2 | 3 | 4;

// ─────────────────────────────────────────────
// 单台设备面板（负责端口映射 + iframe 嵌入）
// ─────────────────────────────────────────────
interface DevicePanelProps {
  instanceId: string;
  token: string;
  className?: string;
}

function DevicePanel({
  instanceId,
  token,
  className = "",
}: DevicePanelProps) {
  const { natPublicIp, publicPort, isReady, isCreating, error } = useEnsurePortMapping(
    instanceId,
    token,
    WEBRTC_PORT,
    "WebRTC投屏",
  );

  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeSrc = isReady ? `http://${natPublicIp}:${publicPort}/` : "";
  const onIframeLoad = useCallback(() => setIframeLoaded(true), []);

  // 计算提示文本
  const statusText = !isReady
    ? error
      ? error
      : isCreating
        ? "正在创建端口映射..."
        : "正在获取映射信息..."
    : !iframeLoaded
      ? "正在连接设备画面..."
      : null;

  const statusColor = error ? "#e55" : "#8899aa";

  return (
    <div
      className={`webrtc-panel ${className}`}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
    >
      {/* 设备标签 */}
      <div
        style={{
          position: "absolute",
          top: 6,
          left: 8,
          zIndex: 10,
          background: "rgba(0,0,0,0.55)",
          color: "#e0e8f0",
          fontSize: 11,
          padding: "2px 7px",
          borderRadius: 4,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        {instanceId}
      </div>

      {/* 连接状态提示（端口映射中 / iframe加载中） */}
      {statusText && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0a1628",
            color: statusColor,
            fontSize: 14,
            flexDirection: "column",
            gap: 10,
            zIndex: 5,
          }}
        >
          <div className="webrtc-loading-spinner" />
          <span>{statusText}</span>
        </div>
      )}

      {/* iframe 嵌入设备 Web 页面 */}
      {isReady && (
        <iframe
          src={iframeSrc}
          title={`WebRTC ${instanceId}`}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            background: "#0a1628",
          }}
          allow="autoplay; camera; microphone; fullscreen"
          onLoad={onIframeLoad}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 主页面
// ─────────────────────────────────────────────

export function WebRtcScreenWallPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authToken = useAuthStore((s) => s.session?.accessToken) ?? "";

  // ── 从 URL 解析设备 ID ──
  const instanceIds = useMemo(() => {
    const raw = searchParams.get("ids") ?? "";
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > MAX_SCREENS) {
      return ids.slice(0, MAX_SCREENS);
    }
    return ids;
  }, [searchParams]);

  // ── 布局 ──
  const [cols, setCols] = useState<LayoutCols>(() => {
    const count = instanceIds.length;
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    return 3;
  });

  // ── 全屏设备 ──
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  if (instanceIds.length === 0) {
    return (
      <div style={{ padding: 40 }}>
        <Alert type="warning" message="未选择任何设备，请在 URL 中指定 ?ids=CECS-001,CECS-002" />
        <Button variant="ghost" onClick={() => navigate(-1)} style={{ marginTop: 16 } as React.CSSProperties}>
          返回
        </Button>
      </div>
    );
  }

  const displayIds = fullscreenId ? [fullscreenId] : instanceIds;
  const gridCols = fullscreenId ? 1 : cols;

  return (
    <div className="screen-wall-page">
      {/* 顶部工具栏 — 复用 VNC 投屏的 sw-* 样式 */}
      <div className="sw-toolbar">
        <div className="sw-toolbar-left">
          <Button variant="ghost" onClick={() => navigate("/devices")}>← 返回群控</Button>
          <span className="sw-toolbar-count">WebRTC 投屏 {instanceIds.length} 台设备</span>
        </div>

        <div className="sw-toolbar-right">
          {/* 布局切换 */}
          <div className="sw-layout-switch">
            {([1, 2, 3, 4] as LayoutCols[]).map((c) => (
              <button
                key={c}
                className={`sw-layout-btn ${cols === c ? "active" : ""}`}
                onClick={() => setCols(c)}
                title={`${c} 列布局`}
              >
                {c}×{c}
              </button>
            ))}
          </div>
          {fullscreenId && (
            <Button variant="ghost" onClick={() => setFullscreenId(null)}>退出全屏</Button>
          )}
        </div>
      </div>

      {/* ── 投屏网格 ── */}
      <div
        className="sw-grid"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        }}
      >
        {displayIds.map((id) => (
          <div
            key={id}
            data-instance-id={id}
            style={{ position: "relative", minHeight: 0, overflow: "hidden" }}
          >
            <DevicePanel
              instanceId={id}
              token={authToken}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
