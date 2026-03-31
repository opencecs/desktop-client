/**
 * 群控终端页面 — 主控输入广播到多台设备
 * 在一个主终端中输入命令，同步发送到所有选中设备的 SSH WebSocket
 * URL: /group-terminal?ids=CECS-001,CECS-002
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { consoleApi } from "@/api/console";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/** SSH 凭据（所有设备共用） */
interface SshCredentials {
  host: string;
  username: string;
  password: string;
  port: number;
}

/** 单台设备的 WebSocket 连接状态 */
interface DeviceConnection {
  instanceId: string;
  ws: WebSocket | null;
  status: "connecting" | "connected" | "disconnected" | "error";
  terminal: Terminal | null;
  fitAddon: FitAddon | null;
}

/** 最大同时连接设备数 */
const MAX_GROUP_TERMINALS = 12;

/**
 * 群控终端页面
 * 主控终端输入广播 + 各设备独立输出显示
 */
export function GroupTerminalPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useAuthStore((s) => s.session?.accessToken) ?? "";

  // 从 URL 解析设备 ID 列表
  const instanceIds = useMemo(() => {
    const raw = searchParams.get("ids") ?? "";
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > MAX_GROUP_TERMINALS) {
      console.warn(`[GroupTerminal] 设备数超限 (${ids.length} > ${MAX_GROUP_TERMINALS})，截取前 ${MAX_GROUP_TERMINALS} 台`);
      return ids.slice(0, MAX_GROUP_TERMINALS);
    }
    return ids;
  }, [searchParams]);

  // 主控终端 ref
  const masterTermRef = useRef<HTMLDivElement>(null);
  const masterTerminal = useRef<Terminal | null>(null);
  const masterFitAddon = useRef<FitAddon | null>(null);

  // SSH 凭据（所有设备共用）
  const [credentials, setCredentials] = useState<SshCredentials>({
    host: "",
    username: "root",
    password: "",
    port: 22,
  });
  const [showCredentials, setShowCredentials] = useState(true);

  // 各设备连接状态
  const connectionsRef = useRef<Map<string, DeviceConnection>>(new Map());
  const [connStatuses, setConnStatuses] = useState<Record<string, string>>({});

  // 子终端容器 refs
  const subTermRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  /** 更新连接状态到 UI */
  const updateStatus = useCallback((id: string, status: string) => {
    setConnStatuses((prev) => ({ ...prev, [id]: status }));
  }, []);

  /** 初始化主控终端 */
  const initMasterTerminal = useCallback(() => {
    if (!masterTermRef.current || masterTerminal.current) return;

    console.log("[GroupTerminal] 初始化主控终端");
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Consolas', monospace",
      theme: {
        background: "#0a1628",
        foreground: "#ecf4ff",
        cursor: "#7fb0ff",
        selectionBackground: "rgba(127, 176, 255, 0.3)",
      },
      rows: 12,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(masterTermRef.current);
    fitAddon.fit();

    masterTerminal.current = term;
    masterFitAddon.current = fitAddon;

    term.writeln("\x1b[36m[群控终端] 主控输入将广播到所有连接的设备\x1b[0m");
    term.writeln("\x1b[36m[群控终端] 请等待所有设备连接完成后开始输入命令\x1b[0m\r\n");

    // 主控终端输入 → 广播到所有已连接设备
    term.onData((data) => {
      console.log("[GroupTerminal] 广播输入数据", { length: data.length, deviceCount: connectionsRef.current.size });
      connectionsRef.current.forEach((conn) => {
        if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(new TextEncoder().encode(data));
        }
      });
      // 主控终端回显
      term.write(data);
    });
  }, []);

  /** 初始化子设备终端 */
  const initSubTerminal = useCallback((id: string, container: HTMLDivElement): Terminal => {
    console.log("[GroupTerminal] 初始化子终端:", id);
    const term = new Terminal({
      cursorBlink: false,
      fontSize: 12,
      fontFamily: "'Cascadia Code', 'Consolas', monospace",
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
      },
      disableStdin: true, // 子终端不接受直接输入
      rows: 10,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    return term;
  }, []);

  /** 连接到指定设备的 SSH WebSocket */
  const connectDevice = useCallback((instanceId: string, creds: SshCredentials) => {
    if (!token) return;

    const wsUrl = consoleApi.getSshWsUrl(instanceId, token);
    console.log(`[GroupTerminal] 连接设备: ${instanceId}`, { url: wsUrl });
    updateStatus(instanceId, "connecting");

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    // 获取或创建子终端
    const container = subTermRefs.current.get(instanceId);
    let subTerm: Terminal | null = null;
    if (container) {
      subTerm = initSubTerminal(instanceId, container);
      subTerm.writeln(`\x1b[33m[${instanceId}] 正在连接...\x1b[0m`);
    }

    const conn: DeviceConnection = {
      instanceId,
      ws,
      status: "connecting",
      terminal: subTerm,
      fitAddon: null,
    };
    connectionsRef.current.set(instanceId, conn);

    ws.onopen = () => {
      // 发送 SSH 凭据作为第一条消息
      const authPayload = JSON.stringify({
        host: creds.host,
        username: creds.username,
        password: creds.password,
        port: creds.port,
      });
      ws.send(new TextEncoder().encode(authPayload));
      console.log(`[GroupTerminal] 设备连接成功，凭据已发送: ${instanceId}`);
      conn.status = "connected";
      updateStatus(instanceId, "connected");
      subTerm?.writeln(`\x1b[32m[${instanceId}] 已连接\x1b[0m`);
    };

    ws.onmessage = (event) => {
      // 将设备输出写入对应的子终端
      if (subTerm) {
        if (event.data instanceof ArrayBuffer) {
          subTerm.write(new Uint8Array(event.data));
        } else {
          subTerm.write(event.data);
        }
      }
    };

    ws.onerror = () => {
      console.error(`[GroupTerminal] 设备连接错误: ${instanceId}`);
      conn.status = "error";
      updateStatus(instanceId, "error");
      subTerm?.writeln(`\x1b[31m[${instanceId}] 连接错误\x1b[0m`);
    };

    ws.onclose = (event) => {
      console.log(`[GroupTerminal] 设备连接关闭: ${instanceId}`, { code: event.code });
      conn.status = "disconnected";
      updateStatus(instanceId, "disconnected");
      subTerm?.writeln(`\x1b[33m[${instanceId}] 连接已断开 (${event.code})\x1b[0m`);
    };
  }, [token, updateStatus, initSubTerminal]);

  /** 连接所有设备 */
  const connectAll = useCallback(() => {
    if (!credentials.host) {
      masterTerminal.current?.writeln("\x1b[31m[错误] 请先填写 SSH 主机地址\x1b[0m");
      return;
    }
    if (!credentials.username) {
      masterTerminal.current?.writeln("\x1b[31m[错误] 请先填写 SSH 用户名\x1b[0m");
      return;
    }
    if (!credentials.password) {
      masterTerminal.current?.writeln("\x1b[31m[错误] 请先填写 SSH 密码\x1b[0m");
      return;
    }
    setShowCredentials(false);
    console.log("[GroupTerminal] 连接所有设备", { count: instanceIds.length });
    instanceIds.forEach((id) => connectDevice(id, credentials));
  }, [instanceIds, connectDevice, credentials]);

  /** 断开所有设备 */
  const disconnectAll = useCallback(() => {
    console.log("[GroupTerminal] 断开所有连接");
    connectionsRef.current.forEach((conn) => {
      conn.ws?.close();
      conn.terminal?.dispose();
    });
    connectionsRef.current.clear();
    setConnStatuses({});
    setShowCredentials(true);
  }, []);

  // 页面挂载时初始化主控终端
  useEffect(() => {
    initMasterTerminal();
    return () => {
      console.log("[GroupTerminal] 清理所有资源");
      disconnectAll();
      masterTerminal.current?.dispose();
    };
  }, [initMasterTerminal, disconnectAll]);

  // 窗口 resize 处理
  useEffect(() => {
    const handleResize = () => {
      masterFitAddon.current?.fit();
      connectionsRef.current.forEach((conn) => {
        conn.fitAddon?.fit();
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  /** 已连接设备数 */
  const connectedCount = Object.values(connStatuses).filter((s) => s === "connected").length;

  // 空状态
  if (instanceIds.length === 0) {
    return (
      <div className="group-terminal-page">
        <div className="gt-empty">
          <p>未选择设备</p>
          <Button variant="primary" onClick={() => navigate("/devices")}>
            返回群控面板选择设备
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group-terminal-page">
      {/* SSH 凭据输入 */}
      {showCredentials && (
        <div className="gt-credentials">
          <div className="gt-credentials-title">SSH 连接凭据（所有设备共用）</div>
          <div className="gt-credentials-form">
            <Input
              label="主机地址"
              value={credentials.host}
              onChange={(e) => setCredentials((p) => ({ ...p, host: e.target.value }))}
              placeholder="如 192.168.1.100"
            />
            <Input
              label="端口"
              type="number"
              value={credentials.port}
              onChange={(e) => setCredentials((p) => ({ ...p, port: Number(e.target.value) || 22 }))}
            />
            <Input
              label="用户名"
              value={credentials.username}
              onChange={(e) => setCredentials((p) => ({ ...p, username: e.target.value }))}
            />
            <Input
              label="密码"
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials((p) => ({ ...p, password: e.target.value }))}
            />
          </div>
        </div>
      )}

      {/* 工具栏 */}
      <div className="gt-toolbar">
        <div className="gt-toolbar-left">
          <Button variant="ghost" onClick={() => navigate("/devices")}>← 返回群控</Button>
          <span className="gt-toolbar-info">
            群控终端 — {instanceIds.length} 台设备 ({connectedCount} 已连接)
          </span>
        </div>
        <div className="gt-toolbar-right">
          <Button variant="primary" onClick={connectAll}>连接全部</Button>
          <Button variant="danger" onClick={disconnectAll}>断开全部</Button>
        </div>
      </div>

      {/* 主控终端 */}
      <div className="gt-master-section">
        <div className="gt-master-label">主控输入（广播到所有设备）</div>
        <div className="gt-master-terminal" ref={masterTermRef} />
      </div>

      {/* 设备输出网格 */}
      <div className="gt-device-grid">
        {instanceIds.map((id) => (
          <div key={id} className="gt-device-panel">
            <div className="gt-device-header">
              <span className="gt-device-id" title={id}>{id}</span>
              <span className={`gt-device-status gt-status-${connStatuses[id] ?? "disconnected"}`}>
                {connStatuses[id] === "connected" ? "● 已连接" :
                 connStatuses[id] === "connecting" ? "◌ 连接中" :
                 connStatuses[id] === "error" ? "✕ 错误" : "○ 未连接"}
              </span>
            </div>
            <div
              className="gt-device-terminal"
              ref={(el) => {
                if (el) subTermRefs.current.set(id, el);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
