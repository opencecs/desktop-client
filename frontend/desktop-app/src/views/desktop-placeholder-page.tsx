/**
 * 远程桌面页面 — 单台实例的 VNC 远程桌面控制
 * 使用 noVNC 直连 VNC 服务器（通过后端 WebSocket → TCP 桥接）
 * 支持全屏显示
 */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { describeApiError, isApiErrorKind } from "@/api/client";
import { consoleApi } from "@/api/console";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { NoVncViewer, type VncConnectionState } from "@/components/NoVncViewer";
import { StatusPill } from "@/components/StatusPill";
import { useAuthStore } from "@/stores/auth-store";
import { useEnsurePortMapping } from "@/lib/use-ensure-port-mapping";
import { useVncPasswordStore, DEFAULT_VNC_PASSWORD } from "@/stores/vnc-thumbnail-store";

export function DesktopPlaceholderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const token = session?.accessToken ?? "";

  // 获取实例详情
  const detailQuery = useQuery({
    queryKey: ["console", "desktop", id, token],
    queryFn: () => consoleApi.fetchInstanceDetail(id ?? "", token),
    enabled: Boolean(id && session),
  });

  // ── 自动确保 VNC 端口映射存在（私网端口 5900）──
  const vncMapping = useEnsurePortMapping(id ?? "", token, 5900, "VNC");

  // VNC 密码（默认 123456，直接自动连接）
  const savedPassword = useVncPasswordStore((s) => s.passwords.get(id ?? "") ?? DEFAULT_VNC_PASSWORD);
  const [vncPassword, setVncPassword] = useState(savedPassword);
  const [passwordConfirmed, setPasswordConfirmed] = useState(true);

  // VNC 连接状态
  const [connState, setConnState] = useState<VncConnectionState>("disconnected");

  // 连接成功时保存密码，失败时显示密码输入
  const handleStateChange = (s: VncConnectionState) => {
    setConnState(s);
    if (s === "connected" && id && vncPassword) {
      useVncPasswordStore.getState().setPassword(id, vncPassword);
    }
    if (s === "failed") {
      setPasswordConfirmed(false);
    }
  };

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

  // 无实例 ID 时显示设备选择器
  if (!id) {
    return <DesktopInstanceSelector token={token} navigate={navigate} />;
  }

  const detail = detailQuery.data;

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
            {connState === "connected" ? "● 已连接" : connState === "connecting" ? "◌ 连接中..." : connState === "failed" ? "✕ 连接失败" : "○ 未连接"}
          </span>
        </div>
        <div className="desktop-toolbar-right">
          {passwordConfirmed && connState !== "connecting" && (
            <button className="ghost-button" onClick={() => { setPasswordConfirmed(false); setConnState("disconnected"); }}>
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

      {/* VNC 远程桌面区域 */}
      <div className="desktop-vnc-area">
        {!passwordConfirmed ? (
          /* ── VNC 密码输入表单 ── */
          <div className="sw-panel-password">
            <span className="sw-password-icon">🔒</span>
            <h3 className="sw-password-title">VNC 需要密码</h3>
            
            {vncMapping.isCreating && (
              <p className="sw-password-hint">正在准备端口映射...</p>
            )}
            {vncMapping.isReady && (
              <p className="sw-password-hint">
                {vncMapping.natPublicIp}:{vncMapping.publicPort}
              </p>
            )}
            {vncMapping.error && (
              <p className="desktop-error">端口映射失败: {vncMapping.error}</p>
            )}
            
            <input
              type="password"
              value={vncPassword}
              onChange={(e) => setVncPassword(e.target.value)}
              placeholder="输入 VNC 密码"
              onKeyDown={(e) => { if (e.key === "Enter" && vncMapping.isReady) setPasswordConfirmed(true); }}
              autoFocus
            />
            <button
              className="primary-button"
              disabled={!vncMapping.isReady}
              onClick={() => setPasswordConfirmed(true)}
            >
              {vncMapping.isReady ? "连接" : "等待端口映射..."}
            </button>
          </div>
        ) : (
          /* ── noVNC 画面 ── */
          <NoVncViewer
            instanceId={id ?? ""}
            token={token}
            host={vncMapping.natPublicIp}
            port={vncMapping.publicPort}
            password={vncPassword}
            onStateChange={handleStateChange}
            className="desktop-vnc-canvas"
          />
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
  // 只显示桌面系统设备
  const desktopInstances = instances.filter((inst) => inst.isDesktop);
  const filtered = search.trim()
    ? desktopInstances.filter((inst) =>
        [inst.instanceId, inst.instanceName, inst.ipAddress, inst.boardType, inst.osName ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : desktopInstances;

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
            title={desktopInstances.length === 0 ? "暂无桌面系统设备" : "没有匹配的设备"}
            description={desktopInstances.length === 0 ? "只有安装了桌面系统的设备才能使用远程桌面" : ""}
          />
        ) : (
          <div className="fm-selector-list">
            {filtered.map((inst) => (
              <button
                key={inst.instanceId}
                className="fm-selector-item"
                onClick={() => navigate(`/instances/${inst.instanceId}/desktop`)}
              >
                <span className="fm-selector-icon">🖥️</span>
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

        {/* 也显示非桌面设备（折叠） */}
        {instances.length > desktopInstances.length && (
          <details className="desktop-selector-other">
            <summary className="desktop-selector-other-title">
              其他设备（{instances.length - desktopInstances.length} 台，无桌面系统）
            </summary>
            <div className="fm-selector-list">
              {instances
                .filter((inst) => !inst.isDesktop)
                .map((inst) => (
                  <button
                    key={inst.instanceId}
                    className="fm-selector-item"
                    style={{ opacity: 0.6 }}
                    onClick={() => navigate(`/instances/${inst.instanceId}/desktop`)}
                  >
                    <span className="fm-selector-icon">📦</span>
                    <span className="fm-selector-info">
                      <span className="fm-selector-name">{inst.instanceName || inst.instanceId}</span>
                      <span className="fm-selector-meta">
                        {inst.instanceId} · {inst.ipAddress || "—"} · {inst.boardType}
                      </span>
                    </span>
                    <span className={`fm-selector-status fm-selector-status--${inst.status}`}>
                      {inst.status}
                    </span>
                  </button>
                ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
