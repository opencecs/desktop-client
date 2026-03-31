/**
 * 同步操控弹出窗口页面
 * 通过 window.open() 在独立窗口中显示
 * URL: /sync-control?ids=CECS-001,CECS-002&master=CECS-001
 * 主控设备全尺寸显示，从设备缩略图排列
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/auth-store";
import { NoVncViewer, type VncConnectionState } from "@/components/NoVncViewer";
import { useEnsurePortMapping } from "@/lib/use-ensure-port-mapping";
import { useVncPasswordStore, DEFAULT_VNC_PASSWORD } from "@/stores/vnc-thumbnail-store";
import { Button } from "@/components/ui/Button";

const MAX_SYNC_DEVICES = 9;

export function SyncControlPage() {
  const [searchParams] = useSearchParams();
  const token = useAuthStore((s) => s.session?.accessToken) ?? "";

  const instanceIds = useMemo(() => {
    const raw = searchParams.get("ids") ?? "";
    return raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_SYNC_DEVICES);
  }, [searchParams]);

  const [masterId, setMasterId] = useState<string>(() => {
    return searchParams.get("master") || instanceIds[0] || "";
  });

  const rfbMapRef = useRef<Map<string, any>>(new Map());
  const [rfbVersion, setRfbVersion] = useState(0);

  const handleRfbChange = useCallback((instanceId: string, rfb: any | null) => {
    if (rfb) {
      rfbMapRef.current.set(instanceId, rfb);
    } else {
      rfbMapRef.current.delete(instanceId);
    }
    setRfbVersion((v) => v + 1);
  }, []);

  // 同步操控 effect — 拦截主控 RFB 输入广播到从设备
  useEffect(() => {
    if (!masterId) return;
    const masterRfb = rfbMapRef.current.get(masterId);
    if (!masterRfb || masterRfb._rfbConnectionState !== "connected") return;

    const RfbMessages = masterRfb.constructor.messages;
    const origSendMouse = masterRfb._sendMouse;
    const origSendKey = masterRfb.sendKey;
    const currentMasterId = masterId;

    masterRfb._sendMouse = function (x: number, y: number, mask: number) {
      origSendMouse.call(masterRfb, x, y, mask);
      const fbX = masterRfb._display.absX(x);
      const fbY = masterRfb._display.absY(y);
      const fbW = masterRfb._fbWidth;
      const fbH = masterRfb._fbHeight;
      if (!fbW || !fbH) return;
      rfbMapRef.current.forEach((slave: any, id: string) => {
        if (id === currentMasterId || slave._rfbConnectionState !== "connected") return;
        const sw = slave._fbWidth;
        const sh = slave._fbHeight;
        if (!sw || !sh) return;
        RfbMessages.pointerEvent(
          slave._sock,
          Math.round((fbX / fbW) * sw),
          Math.round((fbY / fbH) * sh),
          mask,
        );
      });
    };

    masterRfb.sendKey = function (keysym: number, code: string, down?: boolean) {
      origSendKey.call(masterRfb, keysym, code, down);
      if (down !== undefined) {
        rfbMapRef.current.forEach((slave: any, id: string) => {
          if (id === currentMasterId || slave._rfbConnectionState !== "connected") return;
          slave.sendKey(keysym, code, down);
        });
      }
    };

    try { masterRfb.focus(); } catch (_) {}

    return () => {
      masterRfb._sendMouse = origSendMouse;
      masterRfb.sendKey = origSendKey;
    };
  }, [masterId, rfbVersion]);

  const slaveIds = useMemo(() => instanceIds.filter((id) => id !== masterId), [instanceIds, masterId]);

  if (instanceIds.length === 0) {
    return (
      <div className="sc-page">
        <div className="sc-empty">未选择同步操控设备</div>
      </div>
    );
  }

  return (
    <div className="sc-page">
      {/* 工具栏 */}
      <div className="sc-toolbar">
        <span className="sc-toolbar-title">
          同步操控 — 主控: {masterId} · 共 {instanceIds.length} 台设备
        </span>
        <Button variant="ghost" onClick={() => window.close()}>关闭窗口</Button>
      </div>

      <div className="sc-layout">
        {/* 主控区域 — 大画面 */}
        <div className="sc-master">
          <div className="sc-master-label">
            <span className="sw-sync-badge">主控</span> {masterId}
          </div>
          <div className="sc-master-vnc">
            <SyncVncPanel
              instanceId={masterId}
              token={token}
              onRfbChange={handleRfbChange}
            />
          </div>
        </div>

        {/* 从设备缩略图列表 */}
        {slaveIds.length > 0 && (
          <div className="sc-slaves">
            <div className="sc-slaves-label">从设备 ({slaveIds.length})</div>
            <div className="sc-slaves-grid">
              {slaveIds.map((id) => (
                <div
                  key={id}
                  className="sc-slave-item"
                  onClick={() => setMasterId(id)}
                  title={`点击切换为主控: ${id}`}
                >
                  <div className="sc-slave-id">{id}</div>
                  <div className="sc-slave-vnc">
                    <SyncVncPanel
                      instanceId={id}
                      token={token}
                      onRfbChange={handleRfbChange}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── 同步操控用 VNC 面板 ───────── */

interface SyncVncPanelProps {
  instanceId: string;
  token: string;
  onRfbChange: (instanceId: string, rfb: any | null) => void;
}

function SyncVncPanel({ instanceId, token, onRfbChange }: SyncVncPanelProps) {
  const vncMapping = useEnsurePortMapping(instanceId, token, 5900, "VNC");
  const [connState, setConnState] = useState<VncConnectionState>("disconnected");
  const savedPassword = useVncPasswordStore((s) => s.passwords.get(instanceId) ?? DEFAULT_VNC_PASSWORD);
  const [vncPassword, setVncPassword] = useState(savedPassword);
  const [showPasswordInput, setShowPasswordInput] = useState(false);

  const handleStateChange = useCallback((s: VncConnectionState) => {
    setConnState(s);
    if (s === "connected" && vncPassword) {
      useVncPasswordStore.getState().setPassword(instanceId, vncPassword);
    }
    if (s === "failed") setShowPasswordInput(true);
  }, [instanceId, vncPassword]);

  if (showPasswordInput && !vncMapping.isCreating) {
    return (
      <div className="sc-password-form">
        <span>🔒 VNC 密码</span>
        <input
          type="password"
          value={vncPassword}
          onChange={(e) => setVncPassword(e.target.value)}
          placeholder="密码"
          onKeyDown={(e) => { if (e.key === "Enter" && vncPassword) setShowPasswordInput(false); }}
          autoFocus
        />
        <button disabled={!vncPassword} onClick={() => setShowPasswordInput(false)}>连接</button>
      </div>
    );
  }

  if (!vncMapping.isReady) {
    return <div className="sc-status">{vncMapping.isCreating ? "准备中..." : vncMapping.error || "获取连接信息..."}</div>;
  }

  return (
    <>
      {connState !== "connected" && (
        <div className="sc-conn-overlay">
          {connState === "connecting" ? "连接中..." : connState === "failed" ? "连接失败" : "未连接"}
        </div>
      )}
      <NoVncViewer
        instanceId={instanceId}
        token={token}
        host={vncMapping.natPublicIp}
        port={vncMapping.publicPort}
        password={vncPassword}
        onStateChange={handleStateChange}
        onRfbChange={(rfb) => onRfbChange(instanceId, rfb)}
      />
    </>
  );
}
