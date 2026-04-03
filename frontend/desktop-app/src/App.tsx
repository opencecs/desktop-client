import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { DesktopPlaceholderPage } from "./views/desktop-placeholder-page";
import { DeviceControlPage } from "./views/device-control-page";
import { FileManagerPage } from "./views/file-manager-page";
import { InstanceDetailPage } from "./views/instance-detail-page";
import { LoginPage } from "./views/login-page";
import { NotFoundPage } from "./views/not-found-page";
import { OpLogsPage } from "./views/op-logs-page";
import { ScreenWallPage } from "./views/screen-wall-page";
import { TerminalPage } from "./views/terminal-page";
import { GroupTerminalPage } from "./views/group-terminal-page";
import { ModelManagerPage } from "./views/model-manager-page";
import { SyncControlPage } from "./views/sync-control-page";
import { WebRtcScreenWallPage } from "./views/webrtc-screen-wall-page";
import { useAuthStore } from "./stores/auth-store";

/**
 * Component that requires an active user session to render its children.
 * If the session is loading, it shows a loading screen.
 * If the session is missing, it redirects to the login page.
 */
function RequireAuth({ children }: { children: JSX.Element }) {
  const hydrated = useAuthStore((state) => state.hydrated);
  const session = useAuthStore((state) => state.session);

  if (!hydrated) {
    console.log("[App/RequireAuth] Hydration missing, showing boot screen.");
    return <div className="boot-screen">正在加载会话...</div>;
  }

  if (!session) {
    console.log("[App/RequireAuth] No user session found, redirecting to /login.");
    return <Navigate to="/login" replace />;
  }

  console.log("[App/RequireAuth] Active session found, rendering children.");
  return children;
}

/**
 * Component that restricts access to public users only.
 * If the session is loading, it shows a loading screen.
 * If a session exists, it redirects away from public pages (like login) back to the dashboard.
 */
function PublicOnly({ children }: { children: JSX.Element }) {
  const hydrated = useAuthStore((state) => state.hydrated);
  const session = useAuthStore((state) => state.session);

  if (!hydrated) {
    console.log("[App/PublicOnly] Hydration missing, showing boot screen.");
    return <div className="boot-screen">正在加载会话...</div>;
  }

  if (session) {
    console.log("[App/PublicOnly] Active session found, redirecting to /.");
    return <Navigate to="/" replace />;
  }

  console.log("[App/PublicOnly] No active session, rendering children.");
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DeviceControlPage />} />
        <Route path="devices" element={<DeviceControlPage />} />
        <Route path="screen-wall" element={<ScreenWallPage />} />
        <Route path="terminal/:instanceId" element={<TerminalPage />} />
        <Route path="instances/:id" element={<InstanceDetailPage />} />
        <Route path="instances/:id/desktop" element={<DesktopPlaceholderPage />} />
        <Route path="instances/:id/logs" element={<OpLogsPage />} />
        <Route path="files/:instanceId" element={<FileManagerPage />} />
        <Route path="group-terminal" element={<GroupTerminalPage />} />
        <Route path="sync-control" element={<SyncControlPage />} />
        <Route path="webrtc-screen-wall" element={<WebRtcScreenWallPage />} />
        <Route path="models" element={<ModelManagerPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
