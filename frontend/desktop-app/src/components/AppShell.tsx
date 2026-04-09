import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { formatDateTime, initials } from "@/lib/format";
import { checkAndInstallUpdateFromRemote, checkVersionFromRemote, type VersionCheckResult } from "@/lib/updater";
import { useAuthStore } from "@/stores/auth-store";
import { useUiStore } from "@/stores/ui-store";
import { consoleApi } from "@/api/console";
import { EditProfileModal } from "@/components/EditProfileModal";
import { UpdateChannelModal } from "@/components/UpdateChannelModal";
import { UpdateConfirmModal } from "@/components/UpdateConfirmModal";
import moyuntengLogo from "@/assets/moyunteng-logo.ico";

/** 侧边栏导航项配置 */
const navItems = [
  { to: "/", label: "设备管理", end: true },
  { to: "/webrtc-screen-wall", label: "投屏墙" },
  { to: "/group-control", label: "群控" },
  { to: "/models", label: "模型管理" },
];

/** 路由路径 → 页面标题映射 */
function getPageTitle(pathname: string): string {
  if (pathname === "/" || pathname === "") return "设备管理";
  if (pathname.startsWith("/models")) return "模型管理";
  if (pathname.startsWith("/instances") && pathname.includes("/desktop")) return "远程桌面";
  if (pathname.startsWith("/instances")) return "设备详情";
  if (pathname.startsWith("/terminal")) return "终端";
  if (pathname.startsWith("/files")) return "文件管理";
  if (pathname.startsWith("/screen-wall")) return "VNC 投屏墙";
  if (pathname.startsWith("/webrtc-screen-wall")) return "投屏墙";
  if (pathname.startsWith("/group-terminal")) return "群控终端";
  if (pathname.startsWith("/group-control")) return "群控";
  return "";
}

/** 侧边栏折叠/展开箭头图标 */
function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ transition: "transform 0.3s ease", transform: collapsed ? "rotate(180deg)" : "none" }}>
      <path d="M11.5 4L6.5 9L11.5 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 导航图标 */
function NavIcon({ type }: { type: string }) {
  if (type === "设备管理") return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 16h6M9 13v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
  if (type === "投屏墙") return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="1" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10" y="1" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1" y="10" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10" y="10" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
  if (type === "群控") return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="2" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 15h6M9 12v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6 6l2 2-2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="3" y="2" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 6h6M6 9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 应用壳层组件
 * 包含可折叠侧边栏、顶部操作栏和内容出口
 */
export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const clearSession = useAuthStore((state) => state.clearSession);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const [updateMessage, setUpdateMessage] = useState("");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [updateChannelOpen, setUpdateChannelOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<VersionCheckResult | null>(null);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);

  /** 用户信息面板显示的字段 */
  const profileItems = [
    { label: "用户名", value: session?.user.username },
    { label: "手机号", value: session?.user.phone },
    { label: "邮箱", value: session?.user.email },
    { label: "用户类型", value: session?.user.userType },
    { label: "认证状态", value: session?.user.isVerified === undefined ? undefined : session.user.isVerified ? "已认证" : "未认证" },
    { label: "登录有效期", value: session?.expiresAt ? formatDateTime(session.expiresAt) : undefined },
  ].filter((item) => Boolean(item.value));

  /** 点击弹窗外部自动关闭 */
  useEffect(() => {
    if (!profileOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [profileOpen]);

  /** 启动后自动检查更新（延迟 3 秒，避免阻塞首屏） */
  useEffect(() => {
    const timer = setTimeout(() => {
      console.log("[AppShell] 自动检查版本更新");
      void onAutoCheckUpdate();
    }, 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 启动后自动检查更新，发现新版本先提示用户确认 */
  const onAutoCheckUpdate = async () => {
    setUpdateBusy(true);
    setUpdateMessage("正在自动检查更新...");
    const result = await checkVersionFromRemote();
    if (result.hasUpdate) {
      setPendingUpdate(result);
      setUpdateMessage(`发现新版本 ${result.latestVersion}，请确认是否更新。`);
      setUpdateBusy(false);
      return;
    }

    setUpdateMessage(result.message);
    setUpdateBusy(false);
  };

  /** 路由变更时记录日志 */
  useEffect(() => {
    console.log(`[AppShell] 路由切换: ${location.pathname}`);
  }, [location.pathname]);

  /** 头像 URL 变化后重置加载失败状态 */
  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [session?.user.avatar]);

  /** 退出登录 */
  const onLogout = () => {
    console.log("[AppShell] 用户退出登录");
    setProfileOpen(false);
    clearSession();
    navigate("/login", { replace: true });
  };

  const onEditProfile = () => {
    console.log("[AppShell] 打开编辑资料弹窗");
    setProfileOpen(false);
    setEditProfileOpen(true);
  };

  /** 资料更新后重新拉取用户信息并刷新 session */
  const onProfileUpdated = async () => {
    console.log("[AppShell] 用户资料已更新，重新拉取用户信息");
    try {
      const updatedUser = await consoleApi.fetchCurrentUser(session?.accessToken);
      if (session) {
        const setSession = useAuthStore.getState().setSession;
        setSession({ ...session, user: updatedUser });
      }
    } catch (err) {
      console.error("[AppShell] 拉取更新后的用户信息失败", err);
    }
  };

  /** 点击版本更新：先检查，再提示用户确认 */
  const onCheckUpdate = async () => {
    setUpdateBusy(true);
    setUpdateMessage("正在检查更新...");
    const result = await checkVersionFromRemote();
    if (result.hasUpdate) {
      setPendingUpdate(result);
      setUpdateMessage(`发现新版本 ${result.latestVersion}，请确认是否更新。`);
      setUpdateBusy(false);
      return;
    }

    setUpdateMessage(result.message);
    setUpdateBusy(false);
  };

  /** 用户确认后才开始安装更新 */
  const onConfirmInstallUpdate = async () => {
    if (!pendingUpdate) return;

    setUpdateBusy(true);
    setUpdateMessage(`开始安装新版本 ${pendingUpdate.latestVersion}...`);
    const result = await checkAndInstallUpdateFromRemote((state) => setUpdateMessage(state.message));
    setUpdateMessage(result.message);
    setPendingUpdate(null);
    setUpdateBusy(false);
  };

  /** 用户拒绝更新，忽略本次 */
  const onIgnoreUpdate = () => {
    setPendingUpdate(null);
    setUpdateMessage("已忽略本次更新。");
  };

  return (
    <div className={`app-shell ${sidebarCollapsed ? "is-collapsed" : ""}`}>
      <aside className="side-rail">
        <div className="brand">
          <img src={moyuntengLogo} alt="魔云腾" className="brand-mark-img" />
          {!sidebarCollapsed && (
            <div className="brand-text">
              <strong>DCC</strong>
              <span>Device Control Center</span>
            </div>
          )}
        </div>

        <div className="side-divider" />

        <nav className="side-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link ${isActive ? "is-active" : ""}`}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <NavIcon type={item.label} />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="side-spacer" />

        <button className="sidebar-toggle" type="button" onClick={toggleSidebar} title={sidebarCollapsed ? "展开导航" : "收起导航"}>
          <CollapseIcon collapsed={sidebarCollapsed} />
          {!sidebarCollapsed && <span>收起</span>}
        </button>


      </aside>

      <main className="content-shell">
        <header className="top-bar">
          <div className="top-bar-left">
            <h1 className="top-bar-title">{getPageTitle(location.pathname)}</h1>
            {updateMessage ? <div className="top-bar-note">{updateMessage}</div> : null}
          </div>

          <div className="top-bar-actions">
            <button
              className="ghost-button update-check-button"
              type="button"
              onClick={onCheckUpdate}
              disabled={updateBusy}
              title="检查版本更新"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 1v6l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M1 8a7 7 0 1 0 14 0A7 7 0 1 0 1 8" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              {updateBusy ? "检查中..." : "版本更新"}
            </button>
            <div className="profile-anchor" ref={profileRef}>
              <button
                className="avatar-trigger"
                type="button"
                onClick={() => setProfileOpen((current) => !current)}
                title="查看个人信息"
              >
                {session?.user.avatar && !avatarLoadFailed ? (
                  <img className="user-avatar-image" src={session.user.avatar} alt={`${session.user.username} avatar`} onError={() => setAvatarLoadFailed(true)} />
                ) : (
                  <span className="user-avatar">{session ? initials(session.user.username) : "NA"}</span>
                )}
              </button>
              {profileOpen ? (
                <div className="profile-popover">
                  <div className="profile-popover-head">
                    {session?.user.avatar && !avatarLoadFailed ? (
                      <img className="profile-popover-avatar" src={session.user.avatar} alt={`${session.user.username} avatar`} onError={() => setAvatarLoadFailed(true)} />
                    ) : (
                      <span className="user-avatar profile-popover-avatar-fallback">{session ? initials(session.user.username) : "NA"}</span>
                    )}
                    <div>
                      <strong>{session?.user.username ?? "未登录"}</strong>
                      <span>{session?.user.email ?? session?.user.phone ?? "未提供联系方式"}</span>
                    </div>
                  </div>
                  <div className="profile-popover-list">
                    {profileItems.length === 0 ? (
                      <div className="profile-popover-row">
                        <span>信息</span>
                        <strong>暂无更多信息</strong>
                      </div>
                    ) : (
                      profileItems.map((item) => (
                        <div className="profile-popover-row" key={item.label}>
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="profile-popover-actions">
                    <button className="ghost-button profile-action-button" type="button" onClick={onEditProfile}>
                      编辑资料
                    </button>
                    <button className="ghost-button profile-action-button" type="button" onClick={onLogout}>
                      退出登录
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="content-stage">
          <Outlet />
        </div>
      </main>

      {/* 更新渠道设置弹窗 */}
      {updateChannelOpen && (
        <UpdateChannelModal onClose={() => setUpdateChannelOpen(false)} />
      )}

      {/* 编辑资料弹窗 */}
      {editProfileOpen && session?.user && (
        <EditProfileModal
          user={session.user}
          onClose={() => setEditProfileOpen(false)}
          onUpdated={onProfileUpdated}
        />
      )}

      {/* 更新确认弹窗：同意后才执行安装 */}
      {pendingUpdate && (
        <UpdateConfirmModal
          versionInfo={pendingUpdate}
          installing={updateBusy}
          onConfirm={onConfirmInstallUpdate}
          onClose={onIgnoreUpdate}
        />
      )}
    </div>
  );
}
