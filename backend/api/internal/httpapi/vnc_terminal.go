package httpapi

// VNC 终端 WebSocket 桥接
// 工作流程：
//  1. 完成 WebSocket 握手（支持 "binary" 子协议，noVNC 必需）
//  2. 从 query 参数读取 host 和 port
//  3. 直接 TCP 连接到 VNC 服务器（RFB 协议）
//  4. WebSocket ↔ TCP 字节流双向透明桥接
//     noVNC 客户端全权处理 RFB 协议（包括密码认证）

import (
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"device-control-center/backend/api/internal/observability"
)

// vncTerminalHandler 处理 VNC 终端 WebSocket 请求
// 前端使用 noVNC（RFB over WebSocket "binary" 子协议），后端做透明 TCP 桥接
func vncTerminalHandler(c *gin.Context) {
	instanceID := c.Param("id")
	token := c.Query("token")
	host := c.Query("host")
	portStr := c.Query("port")
	if portStr == "" {
		portStr = "5900"
	}

	logger := slog.Default().With(
		"component", "vnc-terminal",
		"instance_id", instanceID,
		"client_ip", observability.ClientIP(c.Request),
	)

	if token == "" {
		logger.Warn("VNC 请求缺少 token")
		c.JSON(http.StatusUnauthorized, gin.H{"message": "missing token"})
		return
	}
	if host == "" {
		logger.Warn("VNC 请求缺少 host 参数")
		c.JSON(http.StatusBadRequest, gin.H{"message": "missing host"})
		return
	}

	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 {
		port = 5900
	}

	clientKey := c.Request.Header.Get("Sec-WebSocket-Key")
	if clientKey == "" {
		logger.Warn("缺少 Sec-WebSocket-Key 头")
		c.JSON(http.StatusBadRequest, gin.H{"message": "missing Sec-WebSocket-Key"})
		return
	}

	// 劫持 HTTP 连接
	hijacker, ok := c.Writer.(http.Hijacker)
	if !ok {
		logger.Error("HTTP 连接不支持 Hijack")
		c.JSON(http.StatusInternalServerError, gin.H{"message": "websocket not supported"})
		return
	}

	conn, rw, err := hijacker.Hijack()
	if err != nil {
		logger.Error("Hijack 失败", "err", err)
		return
	}
	defer conn.Close()

	// 发送 WebSocket 101 响应
	// noVNC 握手时携带 Sec-WebSocket-Protocol: binary，必须原样回应
	acceptKey := wsAcceptKey(clientKey)
	protocol := c.Request.Header.Get("Sec-WebSocket-Protocol")
	upgradeResp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + acceptKey + "\r\n"
	if protocol != "" {
		upgradeResp += "Sec-WebSocket-Protocol: " + protocol + "\r\n"
	}
	upgradeResp += "\r\n"

	if _, err := rw.WriteString(upgradeResp); err != nil {
		logger.Error("发送 101 响应失败", "err", err)
		return
	}
	if err := rw.Flush(); err != nil {
		logger.Error("刷新缓冲失败", "err", err)
		return
	}

	// bufio.Reader 中可能已缓存少量来自客户端的数据
	var wsReader io.Reader = conn
	if rw.Reader.Buffered() > 0 {
		wsReader = io.MultiReader(rw.Reader, conn)
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	logger.Info("连接 VNC 服务器", "addr", addr)

	// ── TCP 连接 VNC 服务器 ──
	vncConn, err := net.DialTimeout("tcp", addr, 15*time.Second)
	if err != nil {
		logger.Error("VNC TCP 连接失败", "addr", addr, "err", err)
		wsWriteClose(conn, 1011, fmt.Sprintf("VNC connection failed: %v", err))
		return
	}
	defer vncConn.Close()

	logger.Info("VNC TCP 连接成功，开始 WebSocket ↔ RFB 桥接", "addr", addr)

	// ── 双向透明桥接 ──
	// noVNC 使用 WebSocket 二进制帧封装 RFB 数据，桥接层只做帧解包/重包
	// 两个 goroutine 共享同一个 conn 写端，必须用互斥锁序列化，防止帧头和 payload 交织损坏
	var connWriteMu sync.Mutex
	done := make(chan struct{}, 2)

	// WebSocket → VNC TCP（解包 WebSocket 帧，取 payload 写入 TCP）
	go func() {
		defer func() { done <- struct{}{} }()
		totalFrames := 0
		for {
			data, op, rerr := wsReadFrame(wsReader)
			if rerr != nil {
				logger.Info("WS→TCP: wsReadFrame 失败", "frames_so_far", totalFrames, "err", rerr)
				break
			}
			if op == wsOpcodeClose {
				logger.Info("WS→TCP: 收到 WS Close 帧", "frames_so_far", totalFrames)
				break
			}
			if op == wsOpcodeBinary || op == wsOpcodeText {
				totalFrames++
				if _, werr := vncConn.Write(data); werr != nil {
					logger.Info("WS→TCP: 写入 VNC TCP 失败", "frames", totalFrames, "err", werr)
					break
				}
			}
			if op == wsOpcodePing {
				connWriteMu.Lock()
				wsWriteFrame(conn, wsOpcodePong, data)
				connWriteMu.Unlock()
			}
		}
		vncConn.Close()
	}()

	// VNC TCP → WebSocket（将 TCP 字节流封装为 WebSocket 二进制帧）
	go func() {
		defer func() { done <- struct{}{} }()
		buf := make([]byte, 4096)
		totalBytes := 0
		for {
			n, rerr := vncConn.Read(buf)
			if n > 0 {
				totalBytes += n
				connWriteMu.Lock()
				werr := wsWriteFrameChecked(conn, wsOpcodeBinary, buf[:n])
				connWriteMu.Unlock()
				if werr != nil {
					logger.Info("TCP→WS: 写入 WebSocket 失败", "bytes_so_far", totalBytes, "err", werr)
					break
				}
			}
			if rerr != nil {
				logger.Info("TCP→WS: VNC TCP 读取失败", "bytes_so_far", totalBytes, "err", rerr)
				break
			}
		}
	}()

	<-done
	logger.Info("VNC 桥接连接关闭", "addr", addr)
}
