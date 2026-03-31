/**
 * 投屏画面墙页面 — 多设备 VNC 画面并排显示
 * 通过 URL 参数 ?ids=xxx,yyy 指定要投屏的设备
 * 支持 2×2、3×3 等布局切换
 * 使用 noVNC 直连 VNC 服务器（公网 IP + 映射端口）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { consoleApi } from "@/api/console";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { NoVncViewer, type VncConnectionState } from "@/components/NoVncViewer";
import { useEnsurePortMapping } from "@/lib/use-ensure-port-mapping";
import { useVncPasswordStore, DEFAULT_VNC_PASSWORD } from "@/stores/vnc-thumbnail-store";
import type { BatchActionResult } from "@/types";

/* ── 操作录制事件类型 ── */
interface RecordedEvent {
  type: "mouse" | "key";
  /** 相对事件序列开始的时间偏移(ms) */
  dt: number;
  // mouse
  rx?: number; ry?: number; mask?: number;
  // key
  keysym?: number; code?: string; down?: boolean;
}

/** 画面墙布局列数 */
type LayoutCols = 1 | 2 | 3 | 4;

/** 最大同时投屏设备数 */
const MAX_SCREENS = 9;

/**
 * 投屏画面墙页面
 * URL: /screen-wall?ids=CECS-001,CECS-002,CECS-003
 */
export function ScreenWallPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useAuthStore((s) => s.session?.accessToken);

  // ── 从 URL 解析设备 ID 列表 ──
  const instanceIds = useMemo(() => {
    const raw = searchParams.get("ids") ?? "";
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > MAX_SCREENS) {
      console.warn(`[ScreenWall] 投屏数量超限 (${ids.length} > ${MAX_SCREENS})，截取前 ${MAX_SCREENS} 台`);
      return ids.slice(0, MAX_SCREENS);
    }
    return ids;
  }, [searchParams]);

  // ── 布局控制 ──
  const [cols, setCols] = useState<LayoutCols>(() => {
    const count = instanceIds.length;
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    return 3;
  });

  // ── 全屏设备 ──
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  // ── 设备选择（始终可用，不依赖同步模式） ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(instanceIds));
  const rfbMapRef = useRef<Map<string, any>>(new Map());
  const [rfbVersion, setRfbVersion] = useState(0);

  // ── 同步操控模式（仅控制鼠标/键盘广播） ──
  const [syncMode, setSyncMode] = useState(false);
  const [masterId, setMasterId] = useState<string | null>(null);

  // ── 同步操控状态 ──
  const [syncResult, setSyncResult] = useState<BatchActionResult | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);

  // ── 文本广播输入 ──
  const [showTextInput, setShowTextInput] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");

  // ── 操作录制/回放 ──
  const [recording, setRecording] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const recordedEvents = useRef<RecordedEvent[]>([]);
  const recordStartTime = useRef(0);
  const replayAbort = useRef(false);

  // ── 截图提示（自动消失） ──
  const [screenshotMsg, setScreenshotMsg] = useState<string | null>(null);
  const screenshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [downloadsDir, setDownloadsDir] = useState<string>("");

  // 获取下载文件夹路径
  useEffect(() => {
    invoke<string>("get_downloads_dir").then(setDownloadsDir).catch(() => {});
  }, []);

  /** 显示截图提示（3秒后自动消失） */
  const showScreenshotNotice = useCallback((msg: string) => {
    if (screenshotTimer.current) clearTimeout(screenshotTimer.current);
    setScreenshotMsg(msg);
    screenshotTimer.current = setTimeout(() => setScreenshotMsg(null), 3000);
  }, []);

  // ── 面板排序 ──
  const [orderedIds, setOrderedIds] = useState<string[]>([]);

  // 同步 orderedIds 与 instanceIds
  useEffect(() => {
    setOrderedIds(instanceIds);
  }, [instanceIds]);

  /** 移动面板位置 */
  const movePanel = useCallback((idx: number, dir: -1 | 1) => {
    setOrderedIds((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  /** 同步批量操作：对选中设备执行统一操作 */
  const syncAction = useCallback(async (action: "start" | "stop" | "reboot") => {
    const targetIds = selectedIds.size > 0 ? Array.from(selectedIds) : instanceIds;
    console.log(`[ScreenWall] 同步操作: ${action}`, { ids: targetIds });
    setSyncLoading(true);
    try {
      let result: BatchActionResult;
      if (action === "start") {
        result = await consoleApi.batchStartInstances(targetIds, token);
      } else if (action === "stop") {
        result = await consoleApi.batchStopInstances(targetIds, token);
      } else {
        result = await consoleApi.batchRebootInstances(targetIds, token);
      }
      console.log(`[ScreenWall] 同步操作完成: 成功${result.succeeded} 失败${result.failed}`);
      setSyncResult(result);
    } catch (err) {
      console.error("[ScreenWall] 同步操作失败:", err);
    } finally {
      setSyncLoading(false);
    }
  }, [instanceIds, selectedIds, token]);

  /** 切换全屏 */
  const toggleFullscreen = useCallback((id: string) => {
    setFullscreenId((prev) => {
      const next = prev === id ? null : id;
      console.log("[ScreenWall] 切换全屏:", next);
      return next;
    });
  }, []);

  /** RFB 实例变更回调 */
  const handleRfbChange = useCallback((instanceId: string, rfb: any | null) => {
    if (rfb) {
      rfbMapRef.current.set(instanceId, rfb);
    } else {
      rfbMapRef.current.delete(instanceId);
    }
    setRfbVersion((v) => v + 1);
  }, []);

  /** 切换设备选中状态 */
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (masterId === id) {
          const first = instanceIds.find((i) => i !== id && next.has(i));
          setMasterId(first ?? null);
        }
      } else {
        next.add(id);
      }
      return next;
    });
  }, [masterId, instanceIds]);

  /** 全选/取消全选 */
  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => prev.size === instanceIds.length ? new Set() : new Set(instanceIds));
  }, [instanceIds]);

  /** 切换同步操控模式 */
  const toggleSyncMode = useCallback(() => {
    if (syncMode) {
      setSyncMode(false);
      setMasterId(null);
    } else {
      setSyncMode(true);
      setMasterId(instanceIds[0] ?? null);
      // 确保有设备被选中
      if (selectedIds.size === 0) setSelectedIds(new Set(instanceIds));
    }
  }, [syncMode, instanceIds, selectedIds.size]);

  /** 同步操控：拦截主控设备的鼠标/键盘事件，广播到所有从设备 */
  useEffect(() => {
    if (!syncMode || !masterId) return;
    const masterRfb = rfbMapRef.current.get(masterId);
    if (!masterRfb || masterRfb._rfbConnectionState !== "connected") return;

    const RfbMessages = masterRfb.constructor.messages;
    const origSendMouse = masterRfb._sendMouse;
    const origSendKey = masterRfb.sendKey;
    const currentMasterId = masterId;
    const currentSyncedIds = selectedIds;

    // 拦截鼠标事件：转换坐标并广播
    masterRfb._sendMouse = function (x: number, y: number, mask: number) {
      origSendMouse.call(masterRfb, x, y, mask);
      const fbX = masterRfb._display.absX(x);
      const fbY = masterRfb._display.absY(y);
      const fbW = masterRfb._fbWidth;
      const fbH = masterRfb._fbHeight;
      if (!fbW || !fbH) return;
      rfbMapRef.current.forEach((slave: any, id: string) => {
        if (id === currentMasterId || !currentSyncedIds.has(id) || slave._rfbConnectionState !== "connected") return;
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

    // 拦截键盘事件：广播到所有从设备
    masterRfb.sendKey = function (keysym: number, code: string, down?: boolean) {
      origSendKey.call(masterRfb, keysym, code, down);
      // 只转发明确的 down/up 事件，避免 undefined 递归时重复发送
      if (down !== undefined) {
        rfbMapRef.current.forEach((slave: any, id: string) => {
          if (id === currentMasterId || !currentSyncedIds.has(id) || slave._rfbConnectionState !== "connected") return;
          slave.sendKey(keysym, code, down);
        });
      }
    };

    // 将焦点设置到主控设备的 canvas
    try { masterRfb.focus(); } catch (_) {}

    return () => {
      masterRfb._sendMouse = origSendMouse;
      masterRfb.sendKey = origSendKey;
    };
  }, [syncMode, masterId, selectedIds, rfbVersion]);

  /** 剪贴板同步：主控设备的 clipboard 事件广播到从设备 */
  useEffect(() => {
    if (!syncMode || !masterId) return;
    const masterRfb = rfbMapRef.current.get(masterId);
    if (!masterRfb) return;
    const handler = (e: any) => {
      const text = e.detail?.text;
      if (!text) return;
      rfbMapRef.current.forEach((slave: any, id: string) => {
        if (id === masterId || !selectedIds.has(id) || slave._rfbConnectionState !== "connected") return;
        try { slave.clipboardPasteFrom(text); } catch (_) {}
      });
    };
    masterRfb.addEventListener("clipboard", handler);
    return () => { masterRfb.removeEventListener("clipboard", handler); };
  }, [syncMode, masterId, selectedIds, rfbVersion]);

  /** 下载截图 blob 并提示 */
  const downloadScreenshot = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return filename;
  }, []);

  /** 批量截图：对选中的已连接设备截图并下载 */
  const screenshotSelected = useCallback(() => {
    let count = 0;
    const targets = selectedIds.size > 0 ? selectedIds : new Set(instanceIds);
    rfbMapRef.current.forEach((rfb: any, id: string) => {
      if (!targets.has(id) || rfb._rfbConnectionState !== "connected") return;
      try {
        rfb.toBlob((blob: Blob) => {
          const name = `${id}_${Date.now()}.png`;
          downloadScreenshot(blob, name);
          count++;
          showScreenshotNotice(`已保存 ${count} 张截图到下载文件夹`);
        }, "image/png");
      } catch (_) {}
    });
  }, [downloadScreenshot, selectedIds, instanceIds, showScreenshotNotice]);

  /** 单设备截图 */
  const screenshotOne = useCallback((id: string) => {
    const rfb = rfbMapRef.current.get(id);
    if (!rfb || rfb._rfbConnectionState !== "connected") return;
    try {
      rfb.toBlob((blob: Blob) => {
        const name = `${id}_${Date.now()}.png`;
        downloadScreenshot(blob, name);
        showScreenshotNotice(`截图已保存: ${name}`);
      }, "image/png");
    } catch (_) {}
  }, [downloadScreenshot, showScreenshotNotice]);

  /** 文本广播：逐字符发送（ASCII 用标准 keysym，非ASCII 用 Unicode keysym 0x01000000+codepoint） */
  const broadcastTextToDevices = useCallback(() => {
    if (!broadcastText) return;
    const targets = selectedIds.size > 0 ? selectedIds : new Set(instanceIds);
    // 同步模式下只发送到主控，主控的 sendKey 拦截器会自动转发到从设备
    const sendTargets = (syncMode && masterId) ? new Set([masterId]) : targets;
    rfbMapRef.current.forEach((rfb: any, id: string) => {
      if (!sendTargets.has(id) || rfb._rfbConnectionState !== "connected") return;
      try {
        let delay = 0;
        for (const char of broadcastText) {
          const cp = char.codePointAt(0)!;
          // ASCII 可打印字符：keysym = codepoint (0x20-0x7e)
          // Latin-1 补充：keysym = codepoint (0xa0-0xff)
          // 其他 Unicode: keysym = 0x01000000 | codepoint
          let keysym: number;
          if (cp >= 0x20 && cp <= 0x7e) {
            keysym = cp;
          } else if (cp >= 0xa0 && cp <= 0xff) {
            keysym = cp;
          } else {
            keysym = 0x01000000 | cp;
          }
          setTimeout(() => {
            try {
              rfb.sendKey(keysym, "", true);
              rfb.sendKey(keysym, "", false);
            } catch (_) {}
          }, delay);
          delay += 30; // 每字符间隔 30ms
        }
      } catch (_) {}
    });
    setBroadcastText("");
    setShowTextInput(false);
  }, [broadcastText, selectedIds, instanceIds, syncMode, masterId]);

  /** 开始录制操作 */
  const startRecording = useCallback(() => {
    if (!masterId) return;
    recordedEvents.current = [];
    recordStartTime.current = Date.now();
    setRecording(true);
  }, [masterId]);

  /** 停止录制 */
  const stopRecording = useCallback(() => {
    setRecording(false);
  }, []);

  /** 回放录制的操作到选中设备 */
  const replayRecording = useCallback(async () => {
    const events = recordedEvents.current;
    if (events.length === 0) return;
    const targets = selectedIds.size > 0 ? selectedIds : new Set(instanceIds);
    setReplaying(true);
    replayAbort.current = false;
    const startTime = Date.now();
    for (const evt of events) {
      if (replayAbort.current) break;
      const elapsed = Date.now() - startTime;
      const wait = evt.dt - elapsed;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (replayAbort.current) break;
      rfbMapRef.current.forEach((rfb: any, id: string) => {
        if (!targets.has(id) || rfb._rfbConnectionState !== "connected") return;
        if (evt.type === "mouse" && evt.rx !== undefined && evt.ry !== undefined) {
          const RfbMessages = rfb.constructor.messages;
          const sw = rfb._fbWidth;
          const sh = rfb._fbHeight;
          if (sw && sh) {
            RfbMessages.pointerEvent(rfb._sock, Math.round(evt.rx * sw), Math.round(evt.ry * sh), evt.mask ?? 0);
          }
        } else if (evt.type === "key" && evt.keysym !== undefined) {
          rfb.sendKey(evt.keysym, evt.code ?? "", evt.down);
        }
      });
    }
    setReplaying(false);
  }, [selectedIds, instanceIds]);

  /** 录制模式下拦截主控事件并记录 */
  useEffect(() => {
    if (!recording || !masterId) return;
    const masterRfb = rfbMapRef.current.get(masterId);
    if (!masterRfb || masterRfb._rfbConnectionState !== "connected") return;
    const origSendMouse2 = masterRfb._sendMouse;
    const origSendKey2 = masterRfb.sendKey;
    const t0 = recordStartTime.current;
    masterRfb._sendMouse = function (x: number, y: number, mask: number) {
      origSendMouse2.call(masterRfb, x, y, mask);
      const fbW = masterRfb._fbWidth;
      const fbH = masterRfb._fbHeight;
      if (fbW && fbH) {
        const fbX = masterRfb._display.absX(x);
        const fbY = masterRfb._display.absY(y);
        recordedEvents.current.push({ type: "mouse", dt: Date.now() - t0, rx: fbX / fbW, ry: fbY / fbH, mask });
      }
    };
    masterRfb.sendKey = function (keysym: number, code: string, down?: boolean) {
      origSendKey2.call(masterRfb, keysym, code, down);
      if (down !== undefined) {
        recordedEvents.current.push({ type: "key", dt: Date.now() - t0, keysym, code, down });
      }
    };
    return () => {
      masterRfb._sendMouse = origSendMouse2;
      masterRfb.sendKey = origSendKey2;
    };
  }, [recording, masterId]);



  // ── 空状态 ──
  if (instanceIds.length === 0) {
    return (
      <div className="screen-wall-page">
        <div className="sw-empty">
          <p>未选择投屏设备</p>
          <Button variant="primary" onClick={() => navigate("/devices")}>
            返回群控面板选择设备
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-wall-page">
      {/* 顶部工具栏 */}
      <div className="sw-toolbar">
        <div className="sw-toolbar-left">
          <Button variant="ghost" onClick={() => navigate("/devices")}>← 返回群控</Button>
          <span className="sw-toolbar-count">投屏 {instanceIds.length} 台设备</span>
          <span className="sw-toolbar-selected" onClick={toggleSelectAll} title="点击全选/取消全选" style={{ cursor: "pointer" }}>
            已选 {selectedIds.size}/{instanceIds.length}
          </span>
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
          {/* 同步操控开关 */}
          <Button
            variant={syncMode ? "danger" : "primary"}
            onClick={toggleSyncMode}
          >
            {syncMode ? "关闭同步操控" : "同步操控"}
          </Button>

          {/* 功能按钮组 */}
          <div className="sw-feature-actions">
            <Button variant="ghost" onClick={screenshotSelected} title="截图选中设备">📷 截图</Button>
            <Button variant="ghost" onClick={() => setShowTextInput(!showTextInput)} title="文本广播">📝 文本</Button>
            {!recording && !replaying && (
              <Button variant="ghost" onClick={startRecording} title="录制操作（需先指定主控）" disabled={!masterId && !syncMode}>⏺ 录制</Button>
            )}
            {recording && (
              <Button variant="danger" onClick={stopRecording}>⏹ 停止录制 ({recordedEvents.current.length})</Button>
            )}
            {!recording && recordedEvents.current.length > 0 && !replaying && (
              <Button variant="primary" onClick={replayRecording}>▶ 回放 ({recordedEvents.current.length})</Button>
            )}
            {replaying && (
              <Button variant="danger" onClick={() => { replayAbort.current = true; }}>⏹ 停止回放</Button>
            )}
            {/* 固定的打开下载文件夹按钮 */}
            {downloadsDir && (
              <Button variant="ghost" onClick={() => invoke("open_folder", { path: downloadsDir })} title={downloadsDir}>📂 下载</Button>
            )}
          </div>
          {/* 同步操作按钮 */}
          <div className="sw-sync-actions">
            <Button variant="primary" onClick={() => syncAction("start")} disabled={syncLoading}>全部开机</Button>
            <Button variant="danger" onClick={() => syncAction("stop")} disabled={syncLoading}>全部关机</Button>
            <Button variant="ghost" onClick={() => syncAction("reboot")} disabled={syncLoading}>全部重启</Button>
          </div>
        </div>
      </div>

      {/* 文本广播输入栏 */}
      {showTextInput && (
        <div className="sw-text-broadcast">
          <input
            type="text"
            value={broadcastText}
            onChange={(e) => setBroadcastText(e.target.value)}
            placeholder="输入文本，逐字符发送到选中设备..."
            onKeyDown={(e) => { if (e.key === "Enter") broadcastTextToDevices(); }}
            autoFocus
          />
          <Button variant="primary" onClick={broadcastTextToDevices} disabled={!broadcastText}>发送</Button>
          <Button variant="ghost" onClick={() => setShowTextInput(false)}>取消</Button>
        </div>
      )}

      {/* 同步操作结果提示 */}
      {syncResult && (
        <Alert
          type={syncResult.failed === 0 ? "success" : "error"}
          message={`同步操作完成：成功 ${syncResult.succeeded} 台，失败 ${syncResult.failed} 台`}
          dismissible
          onDismiss={() => setSyncResult(null)}
        />
      )}

      {/* 截图保存提示（自动消失） */}
      {screenshotMsg && (
        <div className="inline-alert success sw-screenshot-toast" role="alert">
          <span>{screenshotMsg}</span>
          {downloadsDir && <span style={{ marginLeft: 8, opacity: 0.7, fontSize: "0.82rem" }}>{downloadsDir}</span>}
        </div>
      )}

      {/* 画面网格 — 全屏面板叠加在上方，其他面板保持正常渲染（不隐藏，避免 noVNC canvas 失效） */}
      <div
        className="sw-grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${Math.ceil(orderedIds.length / cols)}, 1fr)`,
        }}
      >
        {orderedIds.map((id, idx) => (
          <div
            key={id}
            style={fullscreenId === id ? { position: "fixed", inset: 0, zIndex: 100 } : undefined}
          >
            <VncPanel
              instanceId={id}
              token={token ?? ""}
              isFullscreen={fullscreenId === id}
              onToggleFullscreen={() => toggleFullscreen(id)}
              onOpenTerminal={() => navigate(`/terminal/${id}`)}
              onRfbChange={handleRfbChange}
              syncRole={syncMode ? (masterId === id ? "master" : "slave") : "none"}
              onSetMaster={() => { if (syncMode) setMasterId(id); }}
              isSynced={selectedIds.has(id)}
              onToggleSynced={() => toggleSelected(id)}
              showSyncCheckbox={true}
              onScreenshot={() => screenshotOne(id)}
              panelIndex={idx}
              panelTotal={orderedIds.length}
              onMovePanel={movePanel}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── VNC 面板组件 ───────── */

interface VncPanelProps {
  instanceId: string;
  token: string;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenTerminal: () => void;
  onRfbChange?: (instanceId: string, rfb: any | null) => void;
  syncRole?: "master" | "slave" | "none";
  onSetMaster?: () => void;
  isSynced?: boolean;
  onToggleSynced?: () => void;
  showSyncCheckbox?: boolean;
  onScreenshot?: () => void;
  panelIndex?: number;
  panelTotal?: number;
  onMovePanel?: (idx: number, dir: -1 | 1) => void;
}

/**
 * 单台设备的 VNC 投屏面板
 * 使用 noVNC 直连 VNC 服务器（通过公网 IP + 映射端口）
 */
function VncPanel({
  instanceId,
  token,
  isFullscreen,
  onToggleFullscreen,
  onOpenTerminal,
  onRfbChange,
  syncRole = "none",
  onSetMaster,
  isSynced = false,
  onToggleSynced,
  showSyncCheckbox = false,
  onScreenshot,
  panelIndex = 0,
  panelTotal = 0,
  onMovePanel,
}: VncPanelProps) {
  // ── 自动确保 VNC 端口映射存在（私网端口 5900）──
  const vncMapping = useEnsurePortMapping(instanceId, token, 5900, "VNC");

  // 面板内的连接状态
  const [connState, setConnState] = useState<VncConnectionState>("disconnected");

  // 投屏墙 VNC 密码（默认 123456，连接失败后允许修改）
  const savedPassword = useVncPasswordStore((s) => s.passwords.get(instanceId) ?? DEFAULT_VNC_PASSWORD);
  const [vncPassword, setVncPassword] = useState(savedPassword);
  const [showPasswordInput, setShowPasswordInput] = useState(false);

  // 连接成功时保存密码，失败时显示密码输入框
  const handleStateChange = useCallback((s: VncConnectionState) => {
    setConnState(s);
    if (s === "connected" && vncPassword) {
      useVncPasswordStore.getState().setPassword(instanceId, vncPassword);
    }
    if (s === "failed") {
      setShowPasswordInput(true);
    }
  }, [instanceId, vncPassword]);

  return (
    <div className={`sw-panel ${isFullscreen ? "sw-panel-fullscreen" : ""} ${syncRole === "master" ? "sw-panel-sync-master" : ""} ${syncRole === "slave" ? "sw-panel-sync-slave" : ""}`}>
      {/* 面板标题栏 */}
      <div className="sw-panel-header">
        {showSyncCheckbox && (
          <input
            type="checkbox"
            className="sw-sync-checkbox"
            checked={isSynced}
            onChange={onToggleSynced}
            title={isSynced ? "取消同步控制" : "加入同步控制"}
          />
        )}
        <span
          className="sw-panel-title"
          title={syncRole !== "none" ? `点击设为主控 - ${instanceId}` : instanceId}
          onClick={onSetMaster}
          style={{ cursor: syncRole !== "none" ? "pointer" : undefined }}
        >
          {syncRole === "master" && <span className="sw-sync-badge">主控</span>}
          {instanceId}
        </span>
        <span className={`sw-panel-status sw-panel-status-${connState}`}>
          {connState === "connected" ? "已连接" : connState === "connecting" ? "连接中..." : connState === "failed" ? "连接失败" : vncMapping.isCreating ? "准备中..." : "未连接"}
        </span>
        <div className="sw-panel-actions">
          {panelTotal > 1 && (
            <>
              <button className="sw-panel-btn" onClick={() => onMovePanel?.(panelIndex, -1)} disabled={panelIndex === 0} title="左移">◀</button>
              <button className="sw-panel-btn" onClick={() => onMovePanel?.(panelIndex, 1)} disabled={panelIndex === panelTotal - 1} title="右移">▶</button>
            </>
          )}
          <button className="sw-panel-btn" onClick={onScreenshot} title="截图">📷</button>
          <button className="sw-panel-btn" onClick={onOpenTerminal} title="打开终端">💻</button>
          <button className="sw-panel-btn" onClick={onToggleFullscreen} title={isFullscreen ? "退出全屏" : "全屏"}>
            {isFullscreen ? "⬜" : "⬛"}
          </button>
        </div>
      </div>

      {/* VNC 画面区域 */}
      <div className="sw-panel-content">
        {showPasswordInput && !vncMapping.isCreating ? (
          /* 连接失败时显示密码输入 */
          <div className="sw-panel-password">
            <div className="sw-password-icon">🔒</div>
            <p className="sw-password-title">VNC 需要密码</p>
            <p className="sw-password-hint">{vncMapping.natPublicIp}:{vncMapping.publicPort}</p>
            <input
              type="password"
              value={vncPassword}
              onChange={(e) => setVncPassword(e.target.value)}
              placeholder="输入 VNC 密码"
              onKeyDown={(e) => { if (e.key === "Enter" && vncPassword) setShowPasswordInput(false); }}
              autoFocus
            />
            <button
              className="primary-button"
              disabled={!vncPassword}
              onClick={() => setShowPasswordInput(false)}
            >
              连接
            </button>
          </div>
        ) : vncMapping.isReady ? (
          <NoVncViewer
            instanceId={instanceId}
            token={token}
            host={vncMapping.natPublicIp}
            port={vncMapping.publicPort}
            password={vncPassword}
            onStateChange={handleStateChange}
            onRfbChange={(rfb) => onRfbChange?.(instanceId, rfb)}
            className="sw-panel-vnc"
          />
        ) : (
          <div className="sw-panel-no-url">
            <p>{vncMapping.isCreating ? "正在创建端口映射..." : vncMapping.error ? `端口映射失败: ${vncMapping.error}` : "正在获取连接信息..."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
