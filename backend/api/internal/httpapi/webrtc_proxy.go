package httpapi

import (
	"bufio"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"device-control-center/backend/api/internal/observability"
)

// webrtcProxyHandler 将前端 WebSocket 请求透明代理到设备上的 debian_screen_control 服务。
//
// 查询参数：
//   - token  : 设备 token（传给上游服务）
//   - host   : 设备 NAT 公网 IP
//   - port   : 端口映射后的公网端口（对应私网 8077）
//
// 上游目标：ws://<host>:<port>/ws?token=<token>
func webrtcProxyHandler(c *gin.Context) {
	instanceID := c.Param("id")
	token := c.Query("token")
	host := c.Query("host")
	port := c.Query("port")

	logger := slog.Default().With(
		"component", "webrtc-proxy",
		"instance_id", instanceID,
		"client_ip", observability.ClientIP(c.Request),
	)

	if host == "" || port == "" {
		logger.Warn("WebRTC 代理请求缺少 host 或 port 参数")
		c.JSON(http.StatusBadRequest, gin.H{"message": "missing host or port"})
		return
	}

	clientKey := c.Request.Header.Get("Sec-WebSocket-Key")
	if clientKey == "" {
		logger.Warn("缺少 Sec-WebSocket-Key 头")
		c.JSON(http.StatusBadRequest, gin.H{"message": "missing Sec-WebSocket-Key"})
		return
	}

	// 构建目标地址
	addr := net.JoinHostPort(host, port)
	requestURI := "/ws"
	if token != "" {
		requestURI += "?token=" + token
	}
	targetURL := fmt.Sprintf("ws://%s%s", addr, requestURI)
	logger.Info("开始 WebRTC WebSocket 代理", "target", targetURL)

	// ── 建立到设备的 TCP 连接 ──
	upstreamConn, err := net.DialTimeout("tcp", addr, 15*time.Second)
	if err != nil {
		logger.Error("TCP 连接设备失败", "addr", addr, "err", err)
		c.JSON(http.StatusBadGateway, gin.H{"message": fmt.Sprintf("TCP connect failed: %v", err)})
		return
	}
	defer upstreamConn.Close()

	// ── 发送 WebSocket 升级请求（不加 Authorization 头，debian_screen_control 不需要） ──
	upgradeReq := fmt.Sprintf(
		"GET %s HTTP/1.1\r\n"+
			"Host: %s\r\n"+
			"Upgrade: websocket\r\n"+
			"Connection: Upgrade\r\n"+
			"Sec-WebSocket-Version: 13\r\n"+
			"Sec-WebSocket-Key: %s\r\n"+
			"\r\n",
		requestURI, addr, clientKey,
	)
	if _, err := upstreamConn.Write([]byte(upgradeReq)); err != nil {
		logger.Error("发送 WebSocket 升级请求失败", "err", err)
		c.JSON(http.StatusBadGateway, gin.H{"message": "WS upgrade write failed"})
		return
	}

	// ── 读取上游 101 响应 ──
	reader := bufio.NewReader(upstreamConn)
	upstreamConn.SetReadDeadline(time.Now().Add(15 * time.Second))

	var respBuilder strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			logger.Error("读取上游响应失败", "err", err)
			c.JSON(http.StatusBadGateway, gin.H{"message": fmt.Sprintf("upstream response read failed: %v", err)})
			return
		}
		respBuilder.WriteString(line)
		if line == "\r\n" {
			break
		}
	}
	upstreamConn.SetReadDeadline(time.Time{})

	respStr := respBuilder.String()
	if !strings.HasPrefix(respStr, "HTTP/1.1 101") {
		logger.Error("上游 WebSocket 升级失败", "response", respStr)
		c.JSON(http.StatusBadGateway, gin.H{"message": "upstream WS upgrade rejected: " + respStr})
		return
	}
	logger.Info("上游 101 握手成功")

	// 始终用 bufferedConn 包装，确保 bufio.Reader 缓冲的数据不丢失
	finalUpstream := &bufferedConn{Conn: upstreamConn, reader: reader}

	// ── 劫持客户端连接 ──
	hijacker, ok := c.Writer.(http.Hijacker)
	if !ok {
		logger.Error("HTTP 连接不支持 Hijack")
		c.JSON(http.StatusInternalServerError, gin.H{"message": "websocket not supported"})
		return
	}

	clientConn, clientBuf, err := hijacker.Hijack()
	if err != nil {
		logger.Error("劫持客户端连接失败", "err", err)
		return
	}
	defer clientConn.Close()

	// 将上游 101 响应原样转发给客户端
	if _, err := clientBuf.Write([]byte(respStr)); err != nil {
		logger.Error("转发上游 101 响应失败", "err", err)
		return
	}
	if err := clientBuf.Flush(); err != nil {
		logger.Error("刷新响应缓冲区失败", "err", err)
		return
	}

	// 用 bufio.Reader 包装客户端连接，确保 Hijack 缓冲中残留的数据不丢失
	clientReader := clientBuf.Reader

	logger.Info("WebRTC 代理连接已建立，开始双向转发", "target", targetURL)

	done := make(chan struct{}, 2)

	go func() {
		defer func() { done <- struct{}{} }()
		n, err := io.Copy(clientConn, finalUpstream)
		logger.Info("上游→客户端 转发结束", "bytes", n, "err", err)
		// 上游关闭后，通知客户端不再有数据
		if tc, ok := clientConn.(*net.TCPConn); ok {
			tc.CloseWrite()
		}
	}()

	go func() {
		defer func() { done <- struct{}{} }()
		n, err := io.Copy(finalUpstream, clientReader)
		logger.Info("客户端→上游 转发结束", "bytes", n, "err", err)
		// 客户端关闭后，通知上游不再有数据
		if tc, ok := upstreamConn.(*net.TCPConn); ok {
			tc.CloseWrite()
		}
	}()

	// 等待两个方向都结束
	<-done
	<-done
	logger.Info("WebRTC 代理连接关闭", "instance_id", instanceID)
}
