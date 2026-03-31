/**
 * SSH 终端页面 — 通过 WebSocket 连接实例 SSH/串口终端
 * 使用 xterm.js 渲染终端画面，支持 SSH 和 Serial 两种模式
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { consoleApi } from "@/api/console";
import { useAuthStore } from "@/stores/auth-store";
import { useEnsurePortMapping } from "@/lib/use-ensure-port-mapping";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

/** 终端连接模式 */
type TerminalMode = "ssh" | "serial";

/** SSH 连接凭据 */
interface SshCredentials {
  host: string;
  username: string;
  password: string;
  port: number;
}

/**
 * SSH/Serial 终端页面组件
 * URL: /terminal/:instanceId
 */
export function TerminalPage() {
  const { instanceId = "" } = useParams<{ instanceId: string }>();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.session?.accessToken) ?? "";

  // ── 实例信息查询 ──
  const { data: instance, isLoading } = useQuery({
    queryKey: ["instance", instanceId],
    queryFn: () => consoleApi.fetchInstanceDetail(instanceId, token),
    enabled: !!instanceId,
  });

  // ── 自动确保 SSH 端口映射存在（私网端口 22）──
  const sshMapping = useEnsurePortMapping(instanceId, token, 22, "SSH");

  // ── 连接状态 ──
  const [mode, setMode] = useState<TerminalMode>("ssh");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<SshCredentials>({
    host: "",
    username: "root",
    password: "",
    port: 22,
  });
  const [showCredentials, setShowCredentials] = useState(true);

  // ── 端口映射就绪后自动填充公网 IP + 映射端口（仅首次，不覆写用户手动输入）──
  useEffect(() => {
    if (sshMapping.isReady && !autoFilledRef.current) {
      autoFilledRef.current = true;
      console.log("[Terminal] 自动填充 SSH 公网地址", {
        host: sshMapping.natPublicIp,
        port: sshMapping.publicPort,
      });
      setCredentials((prev) => ({
        ...prev,
        host: sshMapping.natPublicIp || prev.host,
        port: sshMapping.publicPort || prev.port,
      }));
    }
  }, [sshMapping.isReady, sshMapping.natPublicIp, sshMapping.publicPort]);

  // ── Refs ──
  const termRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const autoFilledRef = useRef(false); // 防止 sshMapping 更新时重复覆写手动输入

  /** 初始化 xterm.js 终端实例 */
  const initTerminal = useCallback(() => {
    if (!termRef.current) return null;

    console.log("[Terminal] 初始化 xterm.js 终端");
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
      theme: {
        background: "#0a1628",
        foreground: "#ecf4ff",
        cursor: "#7fb0ff",
        selectionBackground: "rgba(127, 176, 255, 0.3)",
        black: "#08101f",
        red: "#ff7b7b",
        green: "#60d394",
        yellow: "#f7c45a",
        blue: "#7fb0ff",
        magenta: "#c084fc",
        cyan: "#67e8f9",
        white: "#ecf4ff",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termRef.current);
    fitAddon.fit();

    terminalInstance.current = term;
    fitAddonRef.current = fitAddon;

    return term;
  }, []);

  /** 连接 WebSocket */
  const connect = useCallback(() => {
    if (!instanceId || !token) return;

    // SSH 模式下预验证凭据完整性
    if (mode === "ssh") {
      if (!credentials.host) {
        setError("请填写主机地址");
        return;
      }
      if (!credentials.username) {
        setError("请填写用户名");
        return;
      }
      if (!credentials.password) {
        setError("请填写密码");
        return;
      }
    }

    setError("");
    setConnected(false);

    // 关闭旧连接
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // 初始化终端
    let term = terminalInstance.current;
    if (!term) {
      term = initTerminal();
    }
    if (!term) {
      setError("终端初始化失败");
      return;
    }

    term.clear();
    term.writeln(`\x1b[36m[系统] 正在连接 ${mode === "ssh" ? "SSH" : "串口"} 终端...\x1b[0m`);

    // SSH WebSocket URL 仅需 token，host/port 通过应用协议的首条消息传递
    const wsUrl = mode === "ssh"
      ? consoleApi.getSshWsUrl(instanceId, token)
      : consoleApi.getSerialWsUrl(instanceId, token);

    console.log(`[Terminal] 连接 WebSocket: ${mode}`, { instanceId, host: credentials.host, port: credentials.port });

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      console.log(`[Terminal] WebSocket 连接成功: ${mode}`);
      setConnected(true);
      setShowCredentials(false);

      // SSH 模式下发送凭据（目标内网地址 + 用户名/密码）
      if (mode === "ssh") {
        const authPayload = JSON.stringify({
          host: credentials.host,
          username: credentials.username,
          password: credentials.password,
          port: credentials.port,
        });
        ws.send(new TextEncoder().encode(authPayload));
        console.log("[Terminal] SSH 凭据已发送", {
          host: credentials.host,
          port: credentials.port,
          username: credentials.username,
        });
      }

      term!.writeln(`\x1b[32m[系统] 连接成功\x1b[0m`);
      term!.focus();
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        term!.write(new Uint8Array(event.data));
      } else {
        term!.write(event.data);
      }
    };

    ws.onerror = (event) => {
      console.error("[Terminal] WebSocket 错误:", event);
      setError("连接发生错误");
    };

    ws.onclose = (event) => {
      console.log("[Terminal] WebSocket 关闭:", event.code, event.reason);
      setConnected(false);
      // WebSocket 关闭码说明: 1000=正常关闭, 1001=离开, 1011=服务器错误
      const reason = event.reason ? ` - ${event.reason}` : "";
      const codeHint = event.code === 1006 ? " (连接异常断开, 可能是 SSH 目标不可达或凭据错误)" : "";
      term!.writeln(`\r\n\x1b[33m[系统] 连接已断开 (${event.code}${reason})${codeHint}\x1b[0m`);
    };

    // 终端输入转发到 WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });
  }, [instanceId, token, mode, credentials, initTerminal]);

  /** 断开连接 */
  const disconnect = useCallback(() => {
    console.log("[Terminal] 断开连接");
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  /** 窗口尺寸变化时自适应 */
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  /** 清理终端和 WebSocket */
  useEffect(() => {
    return () => {
      console.log("[Terminal] 页面卸载，清理资源");
      wsRef.current?.close();
      terminalInstance.current?.dispose();
    };
  }, []);

  if (isLoading) {
    return <div className="page-loading"><LoadingSpinner label="加载实例信息..." /></div>;
  }

  return (
    <div className="terminal-page">
      {/* 顶部信息栏 */}
      <div className="terminal-header">
        <div className="terminal-header-info">
          <Button variant="ghost" onClick={() => navigate(-1)}>← 返回</Button>
          <h2 className="terminal-title">
            {instance?.instanceName || instanceId}
            <span className="terminal-subtitle">{instance?.ipAddress}</span>
          </h2>
        </div>

        <div className="terminal-header-actions">
          {/* 模式切换 */}
          <div className="terminal-mode-switch">
            <button
              className={`terminal-mode-btn ${mode === "ssh" ? "active" : ""}`}
              onClick={() => { setMode("ssh"); setShowCredentials(true); }}
              disabled={connected}
            >
              SSH
            </button>
            <button
              className={`terminal-mode-btn ${mode === "serial" ? "active" : ""}`}
              onClick={() => { setMode("serial"); setShowCredentials(false); }}
              disabled={connected}
            >
              串口
            </button>
          </div>

          {connected ? (
            <Button variant="danger" onClick={disconnect}>断开连接</Button>
          ) : (
            <Button variant="primary" onClick={connect}>连接</Button>
          )}
        </div>
      </div>

      {/* SSH 凭据表单 */}
      {showCredentials && mode === "ssh" && !connected && (
        <div className="terminal-credentials">
          <div className="terminal-cred-field">
            <label>主机地址（平台内网 IP）</label>
            <input
              type="text"
              value={credentials.host}
              onChange={(e) => setCredentials((p) => ({ ...p, host: e.target.value }))}
              placeholder="实例 IP 地址"
            />
          </div>
          <div className="terminal-cred-field">
            <label>用户名</label>
            <input
              type="text"
              value={credentials.username}
              onChange={(e) => setCredentials((p) => ({ ...p, username: e.target.value }))}
              placeholder="root"
            />
          </div>
          <div className="terminal-cred-field">
            <label>密码</label>
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials((p) => ({ ...p, password: e.target.value }))}
              placeholder="输入密码"
            />
          </div>
          <div className="terminal-cred-field">
            <label>端口</label>
            <input
              type="number"
              value={credentials.port}
              onChange={(e) => setCredentials((p) => ({ ...p, port: Number(e.target.value) || 22 }))}
              placeholder="映射端口"
            />
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && <Alert type="error" message={error} dismissible onDismiss={() => setError("")} />}

      {/* 连接状态指示器 */}
      <div className="terminal-status-bar">
        <span className={`terminal-status-dot ${connected ? "connected" : "disconnected"}`} />
        <span>{connected ? "已连接" : "未连接"}</span>
        <span className="terminal-status-mode">{mode.toUpperCase()}</span>
      </div>

      {/* 终端容器 */}
      <div className="terminal-container" ref={termRef} />
    </div>
  );
}
