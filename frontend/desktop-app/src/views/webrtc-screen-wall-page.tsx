/**
 * WebRTC 投屏画面墙 — 使用原生 WebRtcViewer 组件渲染
 *
 * URL: /webrtc-screen-wall?ids=CECS-001,CECS-002,CECS-003
 *
 * 改进点（对比 iframe 方案）：
 *  - 使用 WebRtcViewer 组件直接渲染 WebRTC 视频流，无需 iframe 嵌入
 *  - 支持群控：通过 forwardRef 暴露 sendControl，主设备操作可广播到从设备
 *  - 通过后端 WebSocket 代理连接设备，无需直连设备公网 IP（避免 NAT/CSP 问题）
 *  - 设备端已配置公网 IP 直连，无需 STUN/TURN 服务器
 *  - 统一的连接状态管理和错误提示
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { useWebRtcTokenStore } from "@/stores/webrtc-token-store";
import { useEnsurePortMapping } from "@/lib/use-ensure-port-mapping";
import { consoleApi } from "@/api/console";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import {
  WebRtcViewer,
  type WebRtcViewerHandle,
  type WebRtcConnectionState,
  type ControlMessage,
} from "@/components/WebRtcViewer";
import type { BatchActionResult } from "@/types";

/** debian_screen_control 服务端口 */
const WEBRTC_PORT = 8077;

/** 最大同时投屏设备数 */
const MAX_SCREENS = 20;

/** 布局列数 */
type LayoutCols = 1 | 2 | 3 | 4 | 5;

// ─────────────────────────────────────────────
// 单台设备面板（端口映射 + 登录 + WebRtcViewer 原生渲染）
// ─────────────────────────────────────────────
interface DevicePanelProps {
  instanceId: string;
  authToken: string;
  /** 是否作为群控主设备（接管鼠标/键盘输入） */
  isLeader?: boolean;
  /** 群控广播回调 */
  onBroadcast?: (msg: ControlMessage) => void;
  /** 连接状态变更回调 */
  onStateChange?: (state: WebRtcConnectionState) => void;
  className?: string;
}

function DevicePanel({
  instanceId,
  authToken,
  isLeader = false,
  onBroadcast,
  onStateChange,
  className = "",
}: DevicePanelProps) {
  const viewerRef = useRef<WebRtcViewerHandle>(null);
  const [connState, setConnState] = useState<WebRtcConnectionState>("disconnected");

  const deviceToken = useWebRtcTokenStore((s) => s.globalToken);
  const setGlobalToken = useWebRtcTokenStore((s) => s.setGlobalToken);
  const credentials = useWebRtcTokenStore((s) => s.credentials);
  const setCredentials = useWebRtcTokenStore((s) => s.setCredentials);

  // 自动确保 8077 端口的 TCP 映射存在
  const { natPublicIp, publicPort, isReady, isCreating, error: mappingError } =
    useEnsurePortMapping(instanceId, authToken, WEBRTC_PORT, "WebRTC投屏", ["tcp"]);

  // ── 登录状态 ──
  const [loginForm, setLoginForm] = useState({
    username: credentials.username || "myt",
    password: credentials.password || "myt",
  });
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginShake, setLoginShake] = useState(false);
  const [kickedMsg, setKickedMsg] = useState<string | null>(null);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [sessionConfirm, setSessionConfirm] = useState<{ token: string; username: string; password: string } | null>(null);

  /** 执行设备登录 */
  const doDeviceLogin = useCallback(async (username: string, password: string) => {
    if (!isReady || !natPublicIp || !publicPort) {
      setLoginError("端口映射尚未就绪，请稍后重试");
      return;
    }
    setLoginLoading(true);
    setLoginError("");
    try {
      const { token } = await consoleApi.deviceLogin(natPublicIp, publicPort, username, password);

      const isActive = await consoleApi.deviceSessionActive(natPublicIp, publicPort, token);
      if (isActive) {
        setSessionConfirm({ token, username, password });
        setLoginLoading(false);
        return;
      }

      setGlobalToken(token);
      setCredentials({ username, password });
      // 清除被顶/忙碌状态，允许重新进入投屏
      setKickedMsg(null);
      setBusyMsg(null);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "登录失败");
      setLoginShake(true);
      setTimeout(() => setLoginShake(false), 500);
    } finally {
      setLoginLoading(false);
    }
  }, [isReady, natPublicIp, publicPort, setGlobalToken, setCredentials]);

  // 不自动登录，让用户手动点击
  useEffect(() => {}, [deviceToken, credentials, isReady, doDeviceLogin]);

  const handleLoginSubmit = useCallback(() => {
    if (loginForm.username && loginForm.password) {
      doDeviceLogin(loginForm.username, loginForm.password);
    }
  }, [loginForm, doDeviceLogin]);

  /** 被顶掉回调 — 清除 token，保留凭据供手动重连 */
  const handleKicked = useCallback((message: string) => {
    setGlobalToken("");
    setKickedMsg(message);
  }, [setGlobalToken]);

  /** 忙碌回调 */
  const handleBusy = useCallback((message: string) => {
    setBusyMsg(message);
  }, []);

  // 连接状态回调
  const handleStateChange = useCallback((state: WebRtcConnectionState) => {
    setConnState(state);
    onStateChange?.(state);
  }, [onStateChange]);

  // 主设备输入广播到从设备
  const handleControlCapture = useCallback((msg: ControlMessage) => {
    onBroadcast?.(msg);
  }, [onBroadcast]);

  const showLogin = !deviceToken || kickedMsg || busyMsg;

  return (
    <div
      className={`webrtc-panel gc-panel ${isLeader ? "gc-panel-master" : ""} ${className}`}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
    >
      {/* 设备标签 + 连接状态指示 */}
      <div className="gc-panel-label">
        {isLeader && <span className="gc-master-badge">主控</span>}
        {instanceId}
        {connState === "connected" && (
          <span
            style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "#22c55e", display: "inline-block",
              marginLeft: 6, verticalAlign: "middle",
            }}
          />
        )}
      </div>

      {/* WebRtcViewer — 直接使用公网 IP + TCP 端口连接 */}
      {isReady && deviceToken && !showLogin ? (
        <WebRtcViewer
          ref={viewerRef}
          instanceId={instanceId}
          host={natPublicIp}
          port={publicPort}
          token={deviceToken}
          captureInput={true}
          onStateChange={handleStateChange}
          onKicked={handleKicked}
          onBusy={handleBusy}
          className="webrtc-viewer"
        />
      ) : null}

      {/* 登录 / 被顶 / 忙碌浮层 — 在面板内显示 */}
      {showLogin && (
        <div className="sw-login-inline">
          <div className={`sw-login-card ${loginShake ? "sw-login-shake" : ""}`} style={{ width: 280, padding: "24px 20px" }}>
            <div className="sw-login-header" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 16 }}>投屏连接</h2>
              <p style={{ fontSize: 12 }}>{instanceId}</p>
            </div>

            {kickedMsg && (
              <div className="sw-login-error" style={{ fontSize: 12 }}>
                <strong>连接已断开：</strong>{kickedMsg}
              </div>
            )}

            {busyMsg && (
              <div className="sw-login-warning" style={{ fontSize: 12 }}>
                <strong>设备忙碌：</strong>{busyMsg}
                <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "center" }}>
                  <Button variant="ghost" onClick={() => setBusyMsg(null)} style={{ fontSize: 12, padding: "6px 12px" }}>关闭</Button>
                  <button
                    className="sw-login-btn"
                    style={{ width: "auto", padding: "6px 16px", marginTop: 0, fontSize: 12 }}
                    disabled={loginLoading}
                    onClick={() => {
                      setBusyMsg(null);
                      if (credentials.username && credentials.password) {
                        doDeviceLogin(credentials.username, credentials.password);
                      }
                    }}
                  >
                    确认连接
                  </button>
                </div>
              </div>
            )}

            {loginError && !kickedMsg && !busyMsg && (
              <div className="sw-login-error" style={{ fontSize: 12 }}>{loginError}</div>
            )}

            {!busyMsg && (
              <div className="sw-login-form" style={{ gap: 10 }}>
                <label className="sw-login-label">
                  <span style={{ fontSize: 12 }}>用户名</span>
                  <input
                    type="text"
                    value={loginForm.username}
                    onChange={(e) => setLoginForm((f) => ({ ...f, username: e.target.value }))}
                    placeholder="请输入用户名"
                    style={{ padding: "8px 10px", fontSize: 13 }}
                    autoFocus
                  />
                </label>
                <label className="sw-login-label">
                  <span style={{ fontSize: 12 }}>密码</span>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="请输入密码"
                    style={{ padding: "8px 10px", fontSize: 13 }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleLoginSubmit(); }}
                  />
                </label>
                <button
                  className="sw-login-btn"
                  style={{ padding: "8px", fontSize: 13 }}
                  onClick={handleLoginSubmit}
                  disabled={loginLoading || !isReady || !loginForm.username || !loginForm.password}
                >
                  {loginLoading ? "登录中..." : !isReady ? "等待端口映射..." : "连接设备"}
                </button>
              </div>
            )}

            {!busyMsg && (
              <div className="sw-login-hint" style={{ marginTop: 12 }}>
                默认账号: myt / myt
              </div>
            )}
          </div>
        </div>
      )}

      {/* 活跃会话确认弹窗 */}
      {sessionConfirm && (
        <div className="sw-login-inline">
          <div className="sw-kicked-dialog" style={{ width: 280, padding: 24 }}>
            <h3 style={{ fontSize: 15 }}>设备正在被使用</h3>
            <p style={{ fontSize: 12 }}>继续登录将断开该设备的连接。是否继续？</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <Button variant="ghost" onClick={() => setSessionConfirm(null)} style={{ fontSize: 12 }}>取消</Button>
              <button
                className="sw-login-btn"
                style={{ width: "auto", padding: "8px 18px", fontSize: 12 }}
                onClick={() => {
                  setGlobalToken(sessionConfirm.token);
                  setCredentials({ username: sessionConfirm.username, password: sessionConfirm.password });
                  setKickedMsg(null);
                  setBusyMsg(null);
                  setSessionConfirm(null);
                }}
              >
                继续连接
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 端口映射状态提示 */}
      {!showLogin && !deviceToken && isCreating && (
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center",
          background: "#0a1628", color: "#8899aa", fontSize: 13,
          flexDirection: "column", gap: 10, zIndex: 5,
        }}>
          <div className="webrtc-loading-spinner" />
          <span>正在创建端口映射...</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 从设备遮罩层 — 阻止直接操作，点击切换为主控
// ─────────────────────────────────────────────
function GroupOverlay({ instanceId, onSwitchMaster }: { instanceId: string; onSwitchMaster: (id: string) => void }) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止冒泡到双击全屏
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

// ─────────────────────────────────────────────
// 主页面
// ─────────────────────────────────────────────

export function WebRtcScreenWallPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authToken = useAuthStore((s) => s.session?.accessToken) ?? "";
  const deviceToken = useWebRtcTokenStore((s) => s.globalToken);
  const setGlobalToken = useWebRtcTokenStore((s) => s.setGlobalToken);
  const clearTokenStore = useWebRtcTokenStore((s) => s.clear);

  // 每次进入投屏墙页面，清除 token 强制重新登录
  const tokenCleared = useRef(false);
  useEffect(() => {
    if (!tokenCleared.current) {
      tokenCleared.current = true;
      setGlobalToken("");
    }
  }, [setGlobalToken]);

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
    if (count <= 9) return 3;
    if (count <= 16) return 4;
    return 5;
  });

  // ── 全屏设备 ──
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  // ── 群控模式 ──
  const [syncControlEnabled, setSyncControlEnabled] = useState(false);
  const [leaderId, setLeaderId] = useState<string | null>(null);

  // ── 批量操作 ──
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<BatchActionResult | null>(null);

  // ── 群控广播 ──
  const followerRefs = useRef<Map<string, WebRtcViewerHandle>>(new Map());

  const handleBroadcast = useCallback((leaderId: string, msg: ControlMessage) => {
    if (!syncControlEnabled) return;
    // 广播到除主设备外的所有从设备
    followerRefs.current.forEach((handle, id) => {
      if (id !== leaderId) {
        handle.sendControl(msg);
      }
    });
  }, [syncControlEnabled]);

  // ── 文本广播 ──
  const [broadcastText, setBroadcastText] = useState("");
  const handleBroadcastText = useCallback(() => {
    if (!broadcastText.trim() || !syncControlEnabled || !leaderId) return;
    const msg: ControlMessage = { type: "input", text: broadcastText };
    // 发送到所有设备（包括主控）
    followerRefs.current.forEach((handle) => {
      handle.sendControl(msg);
    });
    setBroadcastText("");
  }, [broadcastText, syncControlEnabled, leaderId]);

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
      {/* 顶部工具栏 */}
      <div className="sw-toolbar">
        <div className="sw-toolbar-left">
          <Button variant="ghost" onClick={() => navigate("/")}>← 返回</Button>
          <span className="sw-toolbar-count">
            投屏 {instanceIds.length} 台设备
          </span>
        </div>

        <div className="sw-toolbar-right">
          {/* 设备登出 */}
          {deviceToken && (
            <Button variant="ghost" onClick={() => { clearTokenStore(); }} title="退出设备登录">
              退出设备
            </Button>
          )}

          {/* 群控同步开关 */}
          <button
            className={`gc-sync-toggle ${syncControlEnabled ? "gc-sync-on" : "gc-sync-off"}`}
            onClick={() => {
              setSyncControlEnabled(!syncControlEnabled);
              if (syncControlEnabled) setLeaderId(null);
            }}
            title={syncControlEnabled ? "群控已开启" : "群控已关闭"}
          >
            {syncControlEnabled ? "群控已开启" : "群控已关闭"}
          </button>

          {/* 取消主控 */}
          {syncControlEnabled && leaderId && (
            <Button variant="ghost" onClick={() => setLeaderId(null)}>取消主控</Button>
          )}

          {/* 文本广播 */}
          {syncControlEnabled && leaderId && (
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
          )}

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
        {displayIds.map((id) => {
          const isLeader = syncControlEnabled && leaderId === id;
          const isSlave = syncControlEnabled && leaderId !== null && leaderId !== id;
          const isSelectingLeader = syncControlEnabled && !leaderId;

          return (
            <div
              key={id}
              data-instance-id={id}
              style={{ position: "relative", minHeight: 0, overflow: "hidden" }}
            >
              <DevicePanel
                instanceId={id}
                authToken={authToken}
                isLeader={isLeader}
                onBroadcast={(msg) => handleBroadcast(id, msg)}
                onStateChange={(state) => {
                  if (state === "failed" && leaderId === id) {
                    setLeaderId(null);
                  }
                }}
              />
              {/* 选择主控模式：所有设备都显示遮罩，点击选为主控 */}
              {isSelectingLeader && !fullscreenId && (
                <GroupOverlay instanceId={id} onSwitchMaster={setLeaderId} />
              )}
              {/* 从设备遮罩层：拦截直接交互，点击可切换为主控 */}
              {isSlave && !fullscreenId && (
                <GroupOverlay instanceId={id} onSwitchMaster={setLeaderId} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
