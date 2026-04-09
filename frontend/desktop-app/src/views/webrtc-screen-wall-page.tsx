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
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { consoleApi } from "@/api/console";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useEnsurePortMapping } from "@/lib/use-ensure-port-mapping";
import type { BatchActionResult } from "@/types";

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
          allow="autoplay; camera; microphone; fullscreen; clipboard-read; clipboard-write"
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

  // ── 当 URL 没有 ids 参数时，自动拉取全部运行中的设备 ──
  const urlIds = searchParams.get("ids");
  const hasUrlIds = urlIds !== null && urlIds.trim() !== "";

  const { data: dashboardData, isLoading: dashLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => consoleApi.fetchDashboard(authToken),
    staleTime: 10_000,
    enabled: !hasUrlIds,
  });

  // ── 从 URL 或 dashboard 解析设备 ID ──
  const instanceIds = useMemo(() => {
    if (hasUrlIds) {
      const ids = urlIds!.split(",").map((s) => s.trim()).filter(Boolean);
      return ids.length > MAX_SCREENS ? ids.slice(0, MAX_SCREENS) : ids;
    }
    // 无 ids 参数时使用全部运行中的设备
    const items = dashboardData?.items ?? [];
    const runningIds = items
      .filter((inst: any) => inst.status === "running")
      .map((inst: any) => inst.instanceId);
    return runningIds.length > MAX_SCREENS ? runningIds.slice(0, MAX_SCREENS) : runningIds;
  }, [searchParams, hasUrlIds, urlIds, dashboardData]);

  // ── 布局 ──
  const [cols, setCols] = useState<LayoutCols>(() => {
    const count = instanceIds.length;
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    return 3;
  });

  // ── 全屏设备 ──
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  // ── 批量操作 ──
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<BatchActionResult | null>(null);

  const syncAction = useCallback(async (action: "start" | "stop" | "reboot") => {
    if (instanceIds.length === 0) return;
    setSyncLoading(true);
    setSyncResult(null);
    try {
      let result: BatchActionResult;
      if (action === "start") {
        result = await consoleApi.batchStartInstances(instanceIds, authToken);
      } else if (action === "stop") {
        result = await consoleApi.batchStopInstances(instanceIds, authToken);
      } else {
        result = await consoleApi.batchRebootInstances(instanceIds, authToken);
      }
      setSyncResult(result);
    } catch (err) {
      setSyncResult({ total: instanceIds.length, succeeded: 0, failed: instanceIds.length, items: [] });
    } finally {
      setSyncLoading(false);
    }
  }, [instanceIds, authToken]);

  if (!hasUrlIds && dashLoading) {
    return (
      <div style={{ padding: 40 }}>
        <LoadingSpinner label="加载设备列表..." />
      </div>
    );
  }

  if (instanceIds.length === 0) {
    return (
      <div style={{ padding: 40 }}>
        <Alert type="warning" message={hasUrlIds ? "未选择任何设备，请在 URL 中指定 ?ids=CECS-001,CECS-002" : "暂无运行中的设备，请先在设备管理中启动设备"} />
        <Button variant="ghost" onClick={() => navigate("/")} style={{ marginTop: 16 } as React.CSSProperties}>
          返回设备管理
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
          <Button variant="ghost" onClick={() => navigate("/")}>← 返回设备管理</Button>
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
          {/* 批量操作按钮 */}
          <div className="sw-sync-actions">
            <Button variant="primary" onClick={() => syncAction("start")} disabled={syncLoading}>全部开机</Button>
            <Button variant="danger" onClick={() => syncAction("stop")} disabled={syncLoading}>全部关机</Button>
            <Button variant="ghost" onClick={() => syncAction("reboot")} disabled={syncLoading}>全部重启</Button>
          </div>
        </div>
      </div>

      {/* 批量操作结果提示 */}
      {syncResult && (
        <Alert
          type={syncResult.failed === 0 ? "success" : "error"}
          message={`操作完成：成功 ${syncResult.succeeded} 台，失败 ${syncResult.failed} 台`}
          dismissible
          onDismiss={() => setSyncResult(null)}
        />
      )}

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
