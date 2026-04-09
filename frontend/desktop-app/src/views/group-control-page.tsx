/**
 * 群控页面 — 通过 iframe + postMessage 实现多设备同步操控
 *
 * URL: /group-control?ids=CECS-001,CECS-002,CECS-003
 *
 * 工作原理：
 *  - 每台设备通过端口映射暴露 debian_screen_control 服务（:8077）
 *  - 前端用 iframe 嵌入 http://<natPublicIp>:<publicPort>/ 页面
 *  - 用户在主控设备上直接操作，主控 iframe 由用户直接控制
 *  - 主控 iframe 内的设备页面通过 postMessage 上报操作事件（group_event）
 *  - 父页面监听 group_event 并广播 group_control 到所有从设备 iframe
 *  - 从设备上覆盖透明遮罩，点击遮罩可切换该设备为主控
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { useEnsurePortMapping } from "@/lib/use-ensure-port-mapping";

const WEBRTC_PORT = 8077;
const MAX_DEVICES = 20;

type LayoutCols = 1 | 2 | 3 | 4 | 5;

// ─────────────────────────────────────────────
// 单台设备面板（负责端口映射 + iframe 嵌入）
// ─────────────────────────────────────────────
interface DevicePanelProps {
  instanceId: string;
  token: string;
  isMaster: boolean;
  iframeRef: (instanceId: string, el: HTMLIFrameElement | null) => void;
}

function DevicePanel({ instanceId, token, isMaster, iframeRef }: DevicePanelProps) {
  const { natPublicIp, publicPort, isReady, isCreating, error } = useEnsurePortMapping(
    instanceId,
    token,
    WEBRTC_PORT,
    "WebRTC群控",
  );

  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeSrc = isReady ? `http://${natPublicIp}:${publicPort}/` : "";
  const onIframeLoad = useCallback(() => setIframeLoaded(true), []);

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

  const handleRef = useCallback(
    (el: HTMLIFrameElement | null) => iframeRef(instanceId, el),
    [instanceId, iframeRef],
  );

  return (
    <div
      className={`gc-panel ${isMaster ? "gc-panel-master" : ""}`}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
    >
      {/* 设备标签 */}
      <div className="gc-panel-label">
        {isMaster && <span className="gc-master-badge">主控</span>}
        {instanceId}
      </div>

      {/* 状态提示 */}
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

      {/* iframe */}
      {isReady && (
        <iframe
          ref={handleRef}
          src={iframeSrc}
          title={`群控 ${instanceId}`}
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

export function GroupControlPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authToken = useAuthStore((s) => s.session?.accessToken) ?? "";

  // ── 从 URL 解析设备 ID ──
  const instanceIds = useMemo(() => {
    const raw = searchParams.get("ids") ?? "";
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return ids.length > MAX_DEVICES ? ids.slice(0, MAX_DEVICES) : ids;
  }, [searchParams]);

  // ── 布局列数 ──
  const [cols, setCols] = useState<LayoutCols>(() => {
    const count = instanceIds.length;
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    if (count <= 9) return 3;
    if (count <= 16) return 4;
    return 5;
  });

  // ── 主控设备（第一台） ──
  const [masterId, setMasterId] = useState<string>(() => instanceIds[0] ?? "");

  // ── 群控开关 ──
  const [syncEnabled, setSyncEnabled] = useState(true);

  // ── iframe refs ──
  const iframeMapRef = useRef<Map<string, HTMLIFrameElement>>(new Map());
  const handleIframeRef = useCallback((instanceId: string, el: HTMLIFrameElement | null) => {
    if (el) {
      iframeMapRef.current.set(instanceId, el);
    } else {
      iframeMapRef.current.delete(instanceId);
    }
  }, []);

  // ── 全屏模式 ──
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  // ── 从设备列表（除主控外） ──
  const slaveIds = useMemo(
    () => instanceIds.filter((id) => id !== masterId),
    [instanceIds, masterId],
  );

  // ── 广播控制指令到所有从设备 ──
  const broadcastToSlaves = useCallback(
    (action: Record<string, unknown>) => {
      if (!syncEnabled) return;
      const msg = { type: "group_control", action };
      slaveIds.forEach((id) => {
        const iframe = iframeMapRef.current.get(id);
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage(msg, "*");
        }
      });
    },
    [syncEnabled, slaveIds],
  );

  // ── 广播控制指令到所有设备（包括主控） ──
  const broadcastToAll = useCallback(
    (action: Record<string, unknown>) => {
      if (!syncEnabled) return;
      const msg = { type: "group_control", action };
      instanceIds.forEach((id) => {
        const iframe = iframeMapRef.current.get(id);
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage(msg, "*");
        }
      });
    },
    [syncEnabled, instanceIds],
  );

  // ── 监听主控 iframe 发来的操作事件（group_event），转发到所有从设备 ──
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!syncEnabled) return;
      const data = e.data;
      if (!data || typeof data !== "object") return;

      // 设备端页面上报的操作事件
      if (data.type === "group_event" && data.action) {
        // 确认是主控 iframe 发来的
        const masterIframe = iframeMapRef.current.get(masterId);
        if (masterIframe?.contentWindow === e.source) {
          broadcastToSlaves(data.action as Record<string, unknown>);
        }
      }

      // 设备端页面上报的连接状态
      if (data.type === "group_status" && typeof data.connected === "boolean") {
        for (const [id, iframe] of iframeMapRef.current.entries()) {
          if (iframe.contentWindow === e.source) {
            setDeviceStatus((prev) => {
              const next = new Map(prev);
              next.set(id, data.connected as boolean);
              return next;
            });
            break;
          }
        }
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [masterId, syncEnabled, broadcastToSlaves]);

  // ── 文本广播输入 ──
  const [broadcastText, setBroadcastText] = useState("");
  const handleBroadcastText = useCallback(() => {
    if (!broadcastText.trim()) return;
    broadcastToAll({ type: "input", text: broadcastText });
    setBroadcastText("");
  }, [broadcastText, broadcastToAll]);

  // ── 状态轮询 ──
  const [deviceStatus, setDeviceStatus] = useState<Map<string, boolean>>(new Map());
  useEffect(() => {
    const poll = () => {
      instanceIds.forEach((id) => {
        const iframe = iframeMapRef.current.get(id);
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage({ type: "group_query", query: "status" }, "*");
        }
      });
    };

    const timer = setInterval(poll, 3000);
    poll();

    return () => {
      clearInterval(timer);
    };
  }, [instanceIds]);

  const connectedCount = Array.from(deviceStatus.values()).filter(Boolean).length;

  // ── 切换主控 ──
  const switchMaster = useCallback((id: string) => {
    setMasterId(id);
  }, []);

  if (instanceIds.length === 0) {
    return (
      <div className="gc-empty-state">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" style={{ opacity: 0.35 }}>
          <rect x="4" y="6" width="24" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
          <rect x="36" y="6" width="24" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
          <rect x="4" y="34" width="24" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
          <rect x="36" y="34" width="24" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
          <path d="M32 24v16M24 32h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <h3 style={{ margin: "16px 0 8px", color: "var(--text-1)", fontWeight: 600 }}>
          还没有选择设备
        </h3>
        <p style={{ color: "var(--text-3)", fontSize: 14, margin: 0, lineHeight: 1.6 }}>
          请先返回设备管理页面，勾选需要群控的设备后点击「群控」按钮
        </p>
        <Button variant="primary" onClick={() => navigate("/devices")} style={{ marginTop: 20 } as React.CSSProperties}>
          前往设备管理
        </Button>
      </div>
    );
  }

  const displayIds = fullscreenId ? [fullscreenId] : instanceIds;
  const gridCols = fullscreenId ? 1 : cols;

  return (
    <div className="gc-page">
      {/* 顶部工具栏 */}
      <div className="sw-toolbar">
        <div className="sw-toolbar-left">
          <Button variant="ghost" onClick={() => navigate("/devices")}>← 返回</Button>
          <span className="sw-toolbar-count">
            群控 {instanceIds.length} 台设备
            {connectedCount > 0 && (
              <span className="gc-status-dot gc-status-connected" title="已连接">
                {" "}· {connectedCount} 台已连接
              </span>
            )}
          </span>
        </div>

        <div className="sw-toolbar-right">
          {/* 群控同步开关 */}
          <button
            className={`gc-sync-toggle ${syncEnabled ? "gc-sync-on" : "gc-sync-off"}`}
            onClick={() => setSyncEnabled(!syncEnabled)}
            title={syncEnabled ? "群控已开启" : "群控已关闭"}
          >
            {syncEnabled ? "同步已开启" : "同步已关闭"}
          </button>

          {/* 文本广播 */}
          <div className="gc-broadcast-input">
            <input
              type="text"
              value={broadcastText}
              onChange={(e) => setBroadcastText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleBroadcastText(); }}
              placeholder="输入文本广播到所有设备..."
            />
            <button onClick={handleBroadcastText} disabled={!broadcastText.trim()}>
              发送
            </button>
          </div>

          {/* 布局切换 */}
          <div className="sw-layout-switch">
            {([1, 2, 3, 4, 5] as LayoutCols[]).map((c) => (
              <button
                key={c}
                className={`sw-layout-btn ${cols === c ? "active" : ""}`}
                onClick={() => setCols(c)}
                title={`${c} 列布局`}
              >
                {c}
              </button>
            ))}
          </div>

          {fullscreenId && (
            <Button variant="ghost" onClick={() => setFullscreenId(null)}>退出全屏</Button>
          )}
        </div>
      </div>

      {/* 画面网格 */}
      <div
        className="sw-grid"
        style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}
      >
        {displayIds.map((id) => (
          <div
            key={id}
            style={{ position: "relative", minHeight: 0, overflow: "hidden" }}
            onDoubleClick={() => setFullscreenId(fullscreenId === id ? null : id)}
            title="双击全屏"
          >
            <DevicePanel
              instanceId={id}
              token={authToken}
              isMaster={id === masterId}
              iframeRef={handleIframeRef}
            />
            {/* 从设备遮罩层：拦截直接交互，点击可切换为主控 */}
            {id !== masterId && syncEnabled && !fullscreenId && (
              <GroupOverlay
                instanceId={id}
                onSwitchMaster={switchMaster}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 从设备遮罩层 — 阻止直接操作，点击切换为主控
// ─────────────────────────────────────────────
interface GroupOverlayProps {
  instanceId: string;
  onSwitchMaster: (id: string) => void;
}

function GroupOverlay({ instanceId, onSwitchMaster }: GroupOverlayProps) {
  const handleClick = useCallback(() => {
    onSwitchMaster(instanceId);
  }, [instanceId, onSwitchMaster]);

  return (
    <div
      className="gc-slave-overlay"
      title={`从设备 ${instanceId} — 点击切换为主控`}
      onClick={handleClick}
    >
      <div className="gc-slave-overlay-hint">
        点击切换为主控
      </div>
    </div>
  );
}
