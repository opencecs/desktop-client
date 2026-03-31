package httpapi

import (
	"bufio"
	"crypto/tls"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"device-control-center/backend/api/internal/config"
	"device-control-center/backend/api/internal/observability"
)

// wsProxyHandler 将前端 WebSocket 请求透明代理到上游 SSH/Serial WebSocket 服务。
// 工作原理（透明代理）：
//  1. 劫持客户端 HTTP 连接（Hijack）
//  2. 向上游建立 TCP/TLS 连接，转发客户端原始的 Sec-WebSocket-Key
//  3. 将上游的 101 响应原样返回客户端（确保 Accept 值匹配）
//  4. 双向转发数据直到任一端关闭连接
func wsProxyHandler(c *gin.Context, cfg config.Config, terminalType string) {
	instanceID := c.Param("id")
	token := c.Query("token")

	logger := slog.Default().With(
		"component", "ws-proxy",
		"terminal_type", terminalType,
		"instance_id", instanceID,
		"client_ip", observability.ClientIP(c.Request),
	)

	// 验证 token 参数
	if token == "" {
		logger.Warn("WebSocket 代理请求缺少 token")
		c.JSON(http.StatusUnauthorized, gin.H{"message": "missing token"})
		return
	}

	// 获取客户端原始的 Sec-WebSocket-Key，用于转发给上游
	clientKey := c.Request.Header.Get("Sec-WebSocket-Key")
	if clientKey == "" {
		logger.Warn("缺少 Sec-WebSocket-Key 头")
		c.JSON(http.StatusBadRequest, gin.H{"message": "missing Sec-WebSocket-Key"})
		return
	}

	// 构建上游 WebSocket URL（转发客户端的所有查询参数）
	upstreamWsURL, err := buildUpstreamWsURL(cfg.UpstreamBaseURL, instanceID, terminalType, c.Request.URL.RawQuery)
	if err != nil {
		logger.Error("构建上游 WebSocket URL 失败", "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"message": "internal error"})
		return
	}

	logger.Info("开始 WebSocket 代理", "upstream_url", upstreamWsURL)

	// 向上游建立 TCP/TLS 连接并发送带客户端 Key 的 WebSocket 升级请求
	upstreamConn, upstreamRespBytes, err := dialUpstreamWebSocket(upstreamWsURL, token, clientKey)
	if err != nil {
		logger.Error("连接上游 WebSocket 失败", "err", err)
		c.JSON(http.StatusBadGateway, gin.H{"message": fmt.Sprintf("upstream connection failed: %v", err)})
		return
	}
	defer upstreamConn.Close()

	logger.Info("上游 WebSocket 连接成功，准备劫持客户端连接")

	// 劫持客户端连接
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

	// 将上游的 101 响应原样转发给客户端（包含正确的 Sec-WebSocket-Accept）
	if _, err := clientBuf.Write(upstreamRespBytes); err != nil {
		logger.Error("转发上游 101 响应失败", "err", err)
		return
	}
	if err := clientBuf.Flush(); err != nil {
		logger.Error("刷新响应缓冲区失败", "err", err)
		return
	}

	logger.Info("WebSocket 代理连接已建立，开始双向转发")

	// 双向数据转发
	done := make(chan struct{}, 2)

	// 上游 → 客户端
	go func() {
		defer func() { done <- struct{}{} }()
		n, err := io.Copy(clientConn, upstreamConn)
		logger.Info("上游→客户端 转发结束", "bytes", n, "err", err)
	}()

	// 客户端 → 上游
	go func() {
		defer func() { done <- struct{}{} }()
		n, err := io.Copy(upstreamConn, clientConn)
		logger.Info("客户端→上游 转发结束", "bytes", n, "err", err)
	}()

	// 等待任一方向结束
	<-done
	logger.Info("WebSocket 代理连接关闭")
}

// buildUpstreamWsURL 构建到上游服务的 WebSocket URL
// rawQuery 是客户端请求的原始查询字符串（包含 token、host、port 等参数），直接转发给上游
func buildUpstreamWsURL(upstreamBaseURL, instanceID, terminalType, rawQuery string) (string, error) {
	baseURL := strings.TrimRight(upstreamBaseURL, "/")

	// 将 http(s) 替换为 ws(s)
	if strings.HasPrefix(baseURL, "https://") {
		baseURL = "wss://" + baseURL[8:]
	} else if strings.HasPrefix(baseURL, "http://") {
		baseURL = "ws://" + baseURL[7:]
	} else {
		baseURL = "wss://" + baseURL
	}

	wsPath := fmt.Sprintf("/instance/%s/%s", instanceID, terminalType)
	fullURL := baseURL + wsPath
	if rawQuery != "" {
		fullURL += "?" + rawQuery
	}

	return fullURL, nil
}

// dialUpstreamWebSocket 建立到上游的 TCP/TLS 连接并完成 WebSocket 握手。
// 使用客户端原始的 Sec-WebSocket-Key，以便上游返回的 Accept 值可以直接转发给客户端。
// 返回：上游连接、上游 101 响应原始字节（用于原样转发）、错误
func dialUpstreamWebSocket(wsURL, token, clientKey string) (net.Conn, []byte, error) {
	parsed, err := url.Parse(wsURL)
	if err != nil {
		return nil, nil, fmt.Errorf("解析上游 URL 失败: %w", err)
	}

	host := parsed.Hostname()
	port := parsed.Port()
	useTLS := parsed.Scheme == "wss"

	if port == "" {
		if useTLS {
			port = "443"
		} else {
			port = "80"
		}
	}

	addr := net.JoinHostPort(host, port)

	// 建立 TCP/TLS 连接
	var conn net.Conn
	if useTLS {
		conn, err = tls.DialWithDialer(&net.Dialer{Timeout: 15 * time.Second}, "tcp", addr, &tls.Config{
			ServerName: host,
		})
	} else {
		conn, err = net.DialTimeout("tcp", addr, 15*time.Second)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("TCP 连接失败: %w", err)
	}

	// 构建 WebSocket 升级请求，使用客户端原始的 Sec-WebSocket-Key
	requestURI := parsed.RequestURI()
	upgradeReq := fmt.Sprintf(
		"GET %s HTTP/1.1\r\n"+
			"Host: %s\r\n"+
			"Upgrade: websocket\r\n"+
			"Connection: Upgrade\r\n"+
			"Sec-WebSocket-Version: 13\r\n"+
			"Sec-WebSocket-Key: %s\r\n"+
			"Authorization: Bearer %s\r\n"+
			"\r\n",
		requestURI, host, clientKey, token,
	)

	// 发送升级请求
	if _, err := conn.Write([]byte(upgradeReq)); err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("发送 WebSocket 升级请求失败: %w", err)
	}

	// 使用 bufio 读取上游响应头（直到 \r\n\r\n），不多读后续的 WebSocket 帧数据
	reader := bufio.NewReader(conn)
	conn.SetReadDeadline(time.Now().Add(15 * time.Second))

	var respBuilder strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			conn.Close()
			return nil, nil, fmt.Errorf("读取上游响应失败: %w", err)
		}
		respBuilder.WriteString(line)
		// 空行标志 HTTP 响应头结束
		if line == "\r\n" {
			break
		}
	}

	conn.SetReadDeadline(time.Time{}) // 清除超时
	respStr := respBuilder.String()

	// 检查是否为 101 响应
	if !strings.HasPrefix(respStr, "HTTP/1.1 101") {
		conn.Close()
		// 提取状态码用于错误信息
		statusCode := 502
		parts := strings.SplitN(respStr, " ", 3)
		if len(parts) >= 2 {
			fmt.Sscanf(parts[1], "%d", &statusCode)
		}
		return nil, nil, fmt.Errorf("上游 WebSocket 升级失败，状态码: %d", statusCode)
	}

	// 如果 bufio.Reader 有缓冲的未读数据（上游在 101 之后立即发送的帧数据），
	// 需要用带 buffer 的连接包装，确保不丢失数据
	if reader.Buffered() > 0 {
		// 用 bufferedConn 包装，先消费 bufio 中剩余数据再读底层连接
		conn = &bufferedConn{Conn: conn, reader: reader}
	}

	return conn, []byte(respStr), nil
}

// bufferedConn 包装 net.Conn，在 Read 时优先从 bufio.Reader 读取缓冲的数据
type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (bc *bufferedConn) Read(p []byte) (int, error) {
	return bc.reader.Read(p)
}
