package httpapi

// SSH 终端 WebSocket 处理器
// 工作流程：
//  1. 完成 WebSocket 握手（RFC 6455）
//  2. 读取第一条 WebSocket 帧：JSON 格式的 SSH 凭据 {host, port, username, password}
//  3. 通过公网 IP + 映射端口建立真实 SSH 连接并分配 PTY
//  4. 双向桥接 WebSocket ↔ SSH 会话数据

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/ssh"

	"device-control-center/backend/api/internal/observability"
)

// sshConnCredentials 是客户端握手完成后发送的第一条消息（JSON 格式）
type sshConnCredentials struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// sshTerminalHandler 处理 SSH 终端 WebSocket 请求
func sshTerminalHandler(c *gin.Context) {
	instanceID := c.Param("id")
	token := c.Query("token")

	logger := slog.Default().With(
		"component", "ssh-terminal",
		"instance_id", instanceID,
		"client_ip", observability.ClientIP(c.Request),
	)

	// 校验 token
	if token == "" {
		logger.Warn("SSH 终端请求缺少 token")
		c.JSON(http.StatusUnauthorized, gin.H{"message": "missing token"})
		return
	}

	// 校验 WebSocket 握手头
	clientKey := c.Request.Header.Get("Sec-WebSocket-Key")
	if clientKey == "" {
		logger.Warn("缺少 Sec-WebSocket-Key 头")
		c.JSON(http.StatusBadRequest, gin.H{"message": "missing Sec-WebSocket-Key"})
		return
	}

	// 劫持 HTTP 连接，自主接管为 WebSocket
	hijacker, ok := c.Writer.(http.Hijacker)
	if !ok {
		logger.Error("HTTP 连接不支持 Hijack（不支持 WebSocket 升级）")
		c.JSON(http.StatusInternalServerError, gin.H{"message": "websocket not supported"})
		return
	}

	conn, rw, err := hijacker.Hijack()
	if err != nil {
		logger.Error("Hijack 失败", "err", err)
		return
	}
	defer conn.Close()

	// 发送 WebSocket 101 升级响应
	acceptKey := wsAcceptKey(clientKey)
	upgradeResp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + acceptKey + "\r\n" +
		"\r\n"
	if _, err := rw.WriteString(upgradeResp); err != nil {
		logger.Error("发送 101 响应失败", "err", err)
		return
	}
	if err := rw.Flush(); err != nil {
		logger.Error("刷新 101 响应缓冲失败", "err", err)
		return
	}

	logger.Info("WebSocket 握手完成，等待 SSH 凭据")

	// HTTP 服务器的 bufio.Reader 可能缓存了少量 WebSocket 数据，需合并读取
	var wsReader io.Reader = conn
	if rw.Reader.Buffered() > 0 {
		wsReader = io.MultiReader(rw.Reader, conn)
	}

	// ── 第一步：读取 SSH 凭据（30s 超时）──
	conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	payload, opcode, err := wsReadFrame(wsReader)
	conn.SetReadDeadline(time.Time{})
	if err != nil {
		logger.Error("读取凭据帧失败", "err", err)
		wsWriteClose(conn, 1008, "failed to read credentials")
		return
	}
	if opcode == wsOpcodeClose {
		return
	}

	var creds sshConnCredentials
	if err := json.Unmarshal(payload, &creds); err != nil {
		logger.Error("凭据 JSON 解析失败", "err", err, "raw", string(payload))
		wsWriteText(conn, "\r\n\x1b[31m[系统错误] SSH 凭据格式无效\x1b[0m\r\n")
		wsWriteClose(conn, 1008, "invalid credentials format")
		return
	}
	if creds.Host == "" || creds.Username == "" {
		wsWriteText(conn, "\r\n\x1b[31m[系统错误] 主机地址或用户名不能为空\x1b[0m\r\n")
		wsWriteClose(conn, 1008, "missing host or username")
		return
	}
	if creds.Port <= 0 {
		creds.Port = 22
	}

	addr := fmt.Sprintf("%s:%d", creds.Host, creds.Port)
	logger.Info("建立 SSH 连接", "addr", addr, "username", creds.Username)
	wsWriteText(conn, fmt.Sprintf("\r\n\x1b[36m[系统] 正在连接 %s ...\x1b[0m\r\n", addr))

	// ── 第二步：建立 SSH 连接 ──
	sshCfg := &ssh.ClientConfig{
		User: creds.Username,
		Auth: []ssh.AuthMethod{ssh.Password(creds.Password)},
		// 内网设备不校验主机指纹，生产环境可改为 knownhosts 验证
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), //nolint:gosec
		Timeout:         15 * time.Second,
	}

	sshClient, err := ssh.Dial("tcp", addr, sshCfg)
	if err != nil {
		logger.Error("SSH 连接失败", "addr", addr, "err", err)
		wsWriteText(conn, fmt.Sprintf("\r\n\x1b[31m[系统错误] SSH 连接失败: %v\x1b[0m\r\n", err))
		wsWriteClose(conn, 1011, "ssh connection failed")
		return
	}
	defer sshClient.Close()

	// ── 第三步：创建 SSH 会话并分配 PTY ──
	session, err := sshClient.NewSession()
	if err != nil {
		logger.Error("SSH 会话创建失败", "err", err)
		wsWriteText(conn, fmt.Sprintf("\r\n\x1b[31m[系统错误] SSH 会话失败: %v\x1b[0m\r\n", err))
		wsWriteClose(conn, 1011, "session creation failed")
		return
	}
	defer session.Close()

	termModes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 38400,
		ssh.TTY_OP_OSPEED: 38400,
	}
	// 初始终端大小 80×24，前端 resize 事件暂未实现（TODO: 支持 resize 消息）
	if err := session.RequestPty("xterm-256color", 24, 80, termModes); err != nil {
		logger.Error("PTY 请求失败", "err", err)
		wsWriteText(conn, fmt.Sprintf("\r\n\x1b[31m[系统错误] 伪终端分配失败: %v\x1b[0m\r\n", err))
		wsWriteClose(conn, 1011, "pty allocation failed")
		return
	}

	sshStdin, err := session.StdinPipe()
	if err != nil {
		logger.Error("获取 SSH stdin 失败", "err", err)
		return
	}
	// SSH stdout/stderr 直接写入 WebSocket 二进制帧
	session.Stdout = &wsWriterAdapter{w: conn}
	session.Stderr = &wsWriterAdapter{w: conn}

	if err := session.Shell(); err != nil {
		logger.Error("Shell 启动失败", "err", err)
		wsWriteText(conn, fmt.Sprintf("\r\n\x1b[31m[系统错误] Shell 启动失败: %v\x1b[0m\r\n", err))
		wsWriteClose(conn, 1011, "shell start failed")
		return
	}

	logger.Info("SSH 连接成功，终端会话已建立", "addr", addr)
	wsWriteText(conn, fmt.Sprintf("\r\n\x1b[32m[系统] 已连接到 %s\x1b[0m\r\n\r\n", addr))

	// ── 第四步：双向桥接 ──
	done := make(chan struct{}, 2)

	// WebSocket → SSH stdin
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			data, opcode, err := wsReadFrame(wsReader)
			if err != nil || opcode == wsOpcodeClose {
				break
			}
			if opcode == wsOpcodeText || opcode == wsOpcodeBinary {
				if _, werr := sshStdin.Write(data); werr != nil {
					break
				}
			}
			// Ping → Pong
			if opcode == wsOpcodePing {
				wsWriteFrame(conn, wsOpcodePong, data)
			}
		}
		sshStdin.Close()
	}()

	// 等待 SSH 会话自然结束
	go func() {
		defer func() { done <- struct{}{} }()
		session.Wait()
	}()

	<-done
	logger.Info("SSH 会话结束", "addr", addr)
	wsWriteText(conn, "\r\n\x1b[33m[系统] SSH 连接已断开\x1b[0m\r\n")
	wsWriteClose(conn, 1000, "session ended")
}

// wsWriterAdapter 实现 io.Writer，把数据作为 WebSocket 二进制帧写出
type wsWriterAdapter struct {
	w net.Conn
}

func (a *wsWriterAdapter) Write(p []byte) (int, error) {
	wsWriteBinary(a.w, p)
	return len(p), nil
}

// ─────────────────────────────────────────────────────────────
// WebSocket RFC 6455 最小化实现（仅用于服务端 SSH 桥接）
// ─────────────────────────────────────────────────────────────

const (
	wsOpcodeContinuation = 0x0
	wsOpcodeText         = 0x1
	wsOpcodeBinary       = 0x2
	wsOpcodeClose        = 0x8
	wsOpcodePing         = 0x9
	wsOpcodePong         = 0xA
)

// wsAcceptKey 计算 Sec-WebSocket-Accept（RFC 6455 §4.2.2）
func wsAcceptKey(clientKey string) string {
	const magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	h := sha1.New()
	h.Write([]byte(clientKey + magic))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// wsReadFrame 从 r 读取一个完整的 WebSocket 帧
// 返回：去掩码后的 payload、opcode、错误
func wsReadFrame(r io.Reader) (payload []byte, opcode int, err error) {
	header := make([]byte, 2)
	if _, err = io.ReadFull(r, header); err != nil {
		return
	}

	opcode = int(header[0] & 0x0F)
	masked := (header[1] & 0x80) != 0
	payloadLen := int64(header[1] & 0x7F)

	switch payloadLen {
	case 126:
		ext := make([]byte, 2)
		if _, err = io.ReadFull(r, ext); err != nil {
			return
		}
		payloadLen = int64(binary.BigEndian.Uint16(ext))
	case 127:
		ext := make([]byte, 8)
		if _, err = io.ReadFull(r, ext); err != nil {
			return
		}
		payloadLen = int64(binary.BigEndian.Uint64(ext))
	}

	var maskKey [4]byte
	if masked {
		if _, err = io.ReadFull(r, maskKey[:]); err != nil {
			return
		}
	}

	payload = make([]byte, payloadLen)
	if _, err = io.ReadFull(r, payload); err != nil {
		return
	}

	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i%4]
		}
	}
	return
}

// wsWriteFrame 写一个 WebSocket 帧（服务端 → 客户端，不添加掩码）
func wsWriteFrame(w io.Writer, opcode int, payload []byte) {
	n := len(payload)
	var header []byte
	fin := byte(0x80) | byte(opcode)
	switch {
	case n < 126:
		header = []byte{fin, byte(n)}
	case n < 65536:
		header = []byte{fin, 126, byte(n >> 8), byte(n & 0xFF)}
	default:
		header = make([]byte, 10)
		header[0] = fin
		header[1] = 127
		binary.BigEndian.PutUint64(header[2:], uint64(n))
	}
	w.Write(append(header, payload...)) //nolint:errcheck
}

func wsWriteText(w io.Writer, text string)   { wsWriteFrame(w, wsOpcodeText, []byte(text)) }
func wsWriteBinary(w io.Writer, data []byte) { wsWriteFrame(w, wsOpcodeBinary, data) }

// wsWriteFrameChecked 与 wsWriteFrame 相同，但返回写入错误（用于需要检测连接断开的场景）
func wsWriteFrameChecked(w io.Writer, opcode int, payload []byte) error {
	n := len(payload)
	var header []byte
	fin := byte(0x80) | byte(opcode)
	switch {
	case n < 126:
		header = []byte{fin, byte(n)}
	case n < 65536:
		header = []byte{fin, 126, byte(n >> 8), byte(n & 0xFF)}
	default:
		header = make([]byte, 10)
		header[0] = fin
		header[1] = 127
		binary.BigEndian.PutUint64(header[2:], uint64(n))
	}
	_, err := w.Write(append(header, payload...))
	return err
}

func wsWriteClose(w io.Writer, code int, reason string) {
	b := make([]byte, 2+len(reason))
	binary.BigEndian.PutUint16(b, uint16(code))
	copy(b[2:], reason)
	wsWriteFrame(w, wsOpcodeClose, b)
}
