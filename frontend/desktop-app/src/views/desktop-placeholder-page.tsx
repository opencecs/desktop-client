/**
 * 远程桌面页面 — 单台实例的远程桌面控制
 * 支持两种模式：
 *  1. VNC 模式 — 使用 noVNC 直连 VNC 服务器（通过后端 WebSocket → TCP 桥接）
 *  2. WebRTC 模式 — 使用 WebRtcViewer 连接 debian_screen_control 服务
 *
 * 设备类型自动检测：
 *  - 桌面系统设备默认使用 VNC 模式，可手动切换为 WebRTC
 *  - 非 VNC 环境的设备默认使用 WebRTC 模式
 */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { describeApiError, isApiErrorKind } from "@/api/client";
import { consoleApi } from "@/api/console";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { NoVncViewer, type VncConnectionState } from "@/components/NoVncViewer";
import { WebRtcViewer, type WebRtcConnectionState } from "@/components/WebRtcViewer";
import { StatusPill } from "@/components/StatusPill";
import { useAuthStore } from "@/stores/auth-store";
import { useWebRtcTokenStore } from "@/stores/webrtc-token-store";
import { useEnsurePortMapping } from "@/lib/use-ensure-port-mapping";
import { useVncPasswordStore, DEFAULT_VNC_PASSWORD } from "@/stores/vnc-thumbnail-store";

/** 投屏模式 */
type ScreenMode = "vnc" | "webrtc";

/** debian_screen_control 默认端口 */
const WEBRTC_SERVICE_PORT = 8077;

export function DesktopPlaceholderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const token = session?.accessToken ?? "";
  const deviceToken = useWebRtcTokenStore((s) => s.globalToken);
  const setGlobalToken = useWebRtcTokenStore((s) => s.setGlobalToken);

  // 获取实例详情
  const detailQuery = useQuery({
    queryKey: ["console", "desktop", id, token],
    queryFn: () => consoleApi.fetchInstanceDetail(id ?? "", token),
    enabled: Boolean(id && session),
  });

  const detail = detailQuery.data;

  // ── 投屏模式选择（VNC / WebRTC 均可用，默认 WebRTC 性能更好）──
  const [screenMode, setScreenMode] = useState<ScreenMode>("webrtc");

  // ── VNC 配置（不自动映射，需用户在端口管理中手动添加 5900 映射）──
  const vncMappingQuery = useQuery({
    queryKey: ["portMappingList", id, "vnc-check"],
    queryFn: () => consoleApi.fetchPortMappings(id ?? "", token),
    enabled: !!id && !!token && screenMode === "vnc",
  });
  const vncOverviewQuery = useQuery({
    queryKey: ["portMappingOverview", id],
    queryFn: () => consoleApi.fetchPortMappingOverview(id ?? "", token),
    enabled: !!id && !!token && screenMode === "vnc",
  });
  const vncRule = vncMappingQuery.data?.items?.find(
    (r) => r.privatePort === 5900 && r.protocol.toUpperCase() === "TCP",
  );
  const vncHost = vncOverviewQuery.data?.natPublicIp ?? "";
  const vncPort = vncRule?.publicPort ?? 0;
  const vncReady = !!vncHost && !!vncRule;
  const savedPassword = useVncPasswordStore((s) => s.passwords.get(id ?? "") ?? DEFAULT_VNC_PASSWORD);
  const [vncPassword, setVncPassword] = useState(savedPassword);
  const [passwordConfirmed, setPasswordConfirmed] = useState(true);
  const [vncConnState, setVncConnState] = useState<VncConnectionState>("disconnected");

  const handleVncStateChange = (s: VncConnectionState) => {
    setVncConnState(s);
    if (s === "connected" && id && vncPassword) {
      useVncPasswordStore.getState().setPassword(id, vncPassword);
    }
    if (s === "failed") {
      setPasswordConfirmed(false);
    }
  };

  // ── WebRTC 配置 ──
  const webrtcMapping = useEnsurePortMapping(id ?? "", token, WEBRTC_SERVICE_PORT, "WebRTC投屏", ["tcp", "udp"]);
  const [webrtcConnState, setWebrtcConnState] = useState<WebRtcConnectionState>("disconnected");
  const [webrtcTokenInput, setWebrtcTokenInput] = useState(deviceToken);
  const [showTokenEditor, setShowTokenEditor] = useState(false);

  const saveWebrtcToken = () => {
    setGlobalToken(webrtcTokenInput.trim());
    setShowTokenEditor(false);
  };

  // ── 统一连接状态 ──
  const connState = screenMode === "vnc" ? vncConnState : webrtcConnState;
  const connLabel =
    connState === "connected" ? "● 已连接" :
    connState === "connecting" ? "◌ 连接中..." :
    connState === "failed" ? "✕ 连接失败" :
    "○ 未连接";

  // 错误处理
  const placeholderError = detailQuery.error;
  const isAuthError = isApiErrorKind(placeholderError, "auth");

  if (id && detailQuery.isError) {
    return (
      <EmptyState
        title={isAuthError ? "登录已过期" : "远程桌面不可用"}
        description={
          isAuthError
            ? "当前会话已经失效，请重新登录后再继续。"
            : placeholderError instanceof Error
              ? describeApiError(placeholderError)
              : "无法读取实例详情"
        }
        action={
          <div className="empty-actions">
            <Link className="ghost-button" to="/login">返回登录</Link>
            <button className="primary-button" onClick={() => detailQuery.refetch()}>重试</button>
          </div>
        }
      />
    );
  }

  if (!id) {
    return <DesktopInstanceSelector token={token} navigate={navigate} />;
  }

  return (
    <div className="desktop-page">
      {/* 顶部工具栏 */}
      <div className="desktop-toolbar">
        <div className="desktop-toolbar-left">
          <button className="ghost-button" onClick={() => navigate(-1)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            返回
          </button>
          <span className="desktop-instance-name">
            {detail?.instanceName ?? id}
          </span>
          {detail && <StatusPill status={detail.status ?? "pending"} />}
          <span className={`desktop-conn-status desktop-conn-${connState}`}>
            {connLabel}
          </span>
        </div>
        <div className="desktop-toolbar-right">
          {/* 模式切换 */}
          <div style={{ display: "flex", gap: 0, border: "1px solid #2a5090", borderRadius: 4, overflow: "hidden" }}>
            <button
              className={screenMode === "vnc" ? "primary-button" : "ghost-button"}
              style={{ padding: "3px 10px", fontSize: 12, borderRadius: 0, border: "none" }}
              onClick={() => setScreenMode("vnc")}
            >
              VNC
            </button>
            <button
              className={screenMode === "webrtc" ? "primary-button" : "ghost-button"}
              style={{ padding: "3px 10px", fontSize: 12, borderRadius: 0, border: "none" }}
              onClick={() => setScreenMode("webrtc")}
            >
              WebRTC
            </button>
          </div>

          {/* WebRTC Token 编辑 */}
          {screenMode === "webrtc" && (
            <button
              className="ghost-button"
              onClick={() => { setWebrtcTokenInput(deviceToken); setShowTokenEditor(true); }}
              title="设置设备 Token"
            >
              🔑 Token
            </button>
          )}

          {/* 重连 */}
          {screenMode === "vnc" && passwordConfirmed && vncConnState !== "connecting" && (
            <button className="ghost-button" onClick={() => { setPasswordConfirmed(false); setVncConnState("disconnected"); }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13 5.5C12.1 3.4 10.2 2 8 2 4.7 2 2 4.7 2 8s2.7 6 6 6c2.4 0 4.5-1.4 5.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M13 2v4H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              重连
            </button>
          )}

          {/* 打开终端 */}
          <button className="ghost-button" onClick={() => navigate(`/terminal/${id}`)}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4l3 3-3 3M7 10h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            终端
          </button>

          {/* 返回实例详情 */}
          <Link className="ghost-button" to={`/instances/${id}`}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M5 5h4M5 7h3M5 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            详情
          </Link>
        </div>
      </div>

      {/* Token 编辑弹窗 */}
      {showTokenEditor && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={() => setShowTokenEditor(false)}
        >
          <div
            style={{ background: "#1a2a3a", padding: 24, borderRadius: 8, minWidth: 360, display: "flex", flexDirection: "column", gap: 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ color: "#e0e8f0", margin: 0, fontSize: 16 }}>设备 Token 设置</h3>
            <p style={{ color: "#8899aa", fontSize: 12, margin: 0 }}>
              输入设备端的投屏 Token
            </p>
            <input
              type="text"
              value={webrtcTokenInput}
              onChange={(e) => setWebrtcTokenInput(e.target.value)}
              placeholder="输入设备 Token"
              style={{ padding: "8px 12px", borderRadius: 4, border: "1px solid #2a5090", background: "#0a1628", color: "#e0e8f0", fontSize: 14 }}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") saveWebrtcToken(); }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="ghost-button" onClick={() => setShowTokenEditor(false)}>取消</button>
              <button className="primary-button" onClick={saveWebrtcToken}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 远程桌面区域 */}
      <div className="desktop-vnc-area">
        {screenMode === "vnc" ? (
          /* ── VNC 模式 ── */
          !passwordConfirmed ? (
            <div className="sw-panel-password">
              <span className="sw-password-icon">🔒</span>
              <h3 className="sw-password-title">VNC 需要密码</h3>

              {vncMappingQuery.isLoading && (
                <p className="sw-password-hint">正在检查端口映射...</p>
              )}
              {vncReady && (
                <p className="sw-password-hint">
                  {vncHost}:{vncPort}
                </p>
              )}
              {!vncReady && !vncMappingQuery.isLoading && (
                <p className="desktop-error">
                  未找到 VNC 端口映射（5900），请先在端口管理中添加，或切换到 WebRTC 模式
                </p>
              )}

              <input
                type="password"
                value={vncPassword}
                onChange={(e) => setVncPassword(e.target.value)}
                placeholder="输入 VNC 密码"
                onKeyDown={(e) => { if (e.key === "Enter" && vncReady) setPasswordConfirmed(true); }}
                autoFocus
              />
              <button
                className="primary-button"
                disabled={!vncReady}
                onClick={() => setPasswordConfirmed(true)}
              >
                {vncReady ? "连接" : "等待 VNC 端口映射..."}
              </button>
            </div>
          ) : (
            <NoVncViewer
              instanceId={id}
              token={token}
              host={vncHost}
              port={vncPort}
              password={vncPassword}
              onStateChange={handleVncStateChange}
              className="desktop-vnc-canvas"
            />
          )
        ) : (
          /* ── WebRTC 模式 ── */
          !deviceToken ? (
            <div className="sw-panel-password">
              <span className="sw-password-icon">🔑</span>
              <h3 className="sw-password-title">WebRTC 需要 Token</h3>

              {webrtcMapping.isCreating && (
                <p className="sw-password-hint">正在准备端口映射...</p>
              )}
              {webrtcMapping.isReady && (
                <p className="sw-password-hint">
                  {webrtcMapping.natPublicIp}:{webrtcMapping.publicPort}
                </p>
              )}
              {webrtcMapping.error && (
                <p className="desktop-error">端口映射失败: {webrtcMapping.error}</p>
              )}

              <input
                type="text"
                value={webrtcTokenInput}
                onChange={(e) => setWebrtcTokenInput(e.target.value)}
                placeholder="输入设备 Token"
                onKeyDown={(e) => { if (e.key === "Enter" && webrtcMapping.isReady) saveWebrtcToken(); }}
                autoFocus
              />
              <button
                className="primary-button"
                disabled={!webrtcMapping.isReady}
                onClick={() => {
                  if (webrtcTokenInput.trim()) {
                    saveWebrtcToken();
                  }
                }}
              >
                {webrtcMapping.isReady ? "连接" : "等待端口映射..."}
              </button>
            </div>
          ) : (
            <WebRtcViewer
              instanceId={id}
              host={webrtcMapping.natPublicIp}
              port={webrtcMapping.publicPort}
              token={deviceToken}
              captureInput={true}
              onStateChange={setWebrtcConnState}
              className="desktop-vnc-canvas"
            />
          )
        )}
      </div>
    </div>
  );
}

/* ───────── 设备选择器（无 instanceId 时展示） ───────── */

function DesktopInstanceSelector({
  token,
  navigate,
}: {
  token: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [search, setSearch] = useState("");

  const dashboardQuery = useQuery({
    queryKey: ["dashboard", token],
    queryFn: () => consoleApi.fetchDashboard(token),
    enabled: Boolean(token),
  });

  const instances = dashboardQuery.data?.items ?? [];
  const filtered = search.trim()
    ? instances.filter((inst) =>
        [inst.instanceId, inst.instanceName, inst.ipAddress, inst.boardType, inst.osName ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : instances;

  return (
    <div className="desktop-page">
      <div className="desktop-selector">
        <h2 className="desktop-selector-title">🖥️ 远程桌面 — 选择设备</h2>
        <p className="desktop-selector-desc">选择一台设备进入远程桌面控制</p>

        <input
          className="fm-selector-search"
          type="text"
          placeholder="搜索设备名称、ID 或 IP..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {dashboardQuery.isLoading ? (
          <LoadingSpinner />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={instances.length === 0 ? "暂无设备" : "没有匹配的设备"}
            description={instances.length === 0 ? "请先在设备管理中添加设备" : ""}
          />
        ) : (
          <div className="fm-selector-list">
            {filtered.map((inst) => (
              <button
                key={inst.instanceId}
                className="fm-selector-item"
                onClick={() => navigate(`/instances/${inst.instanceId}/desktop`)}
              >
                <span className="fm-selector-icon">{inst.isDesktop ? "🖥️" : "📦"}</span>
                <span className="fm-selector-info">
                  <span className="fm-selector-name">{inst.instanceName || inst.instanceId}</span>
                  <span className="fm-selector-meta">
                    {inst.instanceId} · {inst.ipAddress || "—"} · {inst.osName || inst.boardType}
                  </span>
                </span>
                <span className={`fm-selector-status fm-selector-status--${inst.status}`}>
                  {inst.status}
                </span>
              </button>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
