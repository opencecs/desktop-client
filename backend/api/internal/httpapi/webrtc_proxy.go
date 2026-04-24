package httpapi

import (
	"bufio"
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"device-control-center/backend/api/internal/observability"
)

// deviceLoginHandler 代理前端请求到设备上的 debian_screen_control 登录接口。
// Tauri CSP 限制前端不能直连设备公网 IP，因此通过本地后端代理。
//
// 请求体：{ "username": "xxx", "password": "xxx", "host": "1.2.3.4", "port": 12345 }
// 响应：透传设备返回的 JSON（{ code, data: { token, role }, msg }）
func deviceLoginHandler(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
		Host     string `json:"host" binding:"required"`
		Port     int    `json:"port" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request: " + err.Error()})
		return
	}

	logger := slog.Default().With(
		"component", "device-login-proxy",
		"host", req.Host,
		"port", req.Port,
		"client_ip", observability.ClientIP(c.Request),
	)

	targetURL := fmt.Sprintf("http://%s:%d/api/login", req.Host, req.Port)
	logger.Info("代理设备登录请求", "target", targetURL)

	body, _ := json.Marshal(map[string]string{
		"username": req.Username,
		"password": req.Password,
	})

	httpClient := &http.Client{Timeout: 15 * time.Second}
	resp, err := httpClient.Post(targetURL, "application/json", bytes.NewReader(body))
	if err != nil {
		logger.Error("请求设备登录接口失败", "err", err)
		c.JSON(http.StatusBadGateway, gin.H{"message": fmt.Sprintf("device login request failed: %v", err)})
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		logger.Error("读取设备登录响应失败", "err", err)
		c.JSON(http.StatusBadGateway, gin.H{"message": "failed to read device response"})
		return
	}

	// 透传设备响应 JSON
	var result map[string]any
	if err := json.Unmarshal(respBody, &result); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"message": "invalid device response"})
		return
	}
	c.JSON(resp.StatusCode, result)
}

// deviceSessionActiveHandler 代理前端请求到设备的 /api/session/active 接口。
// 用于登录后检查是否有其他设备正在投屏。
//
// 请求体：{ "host": "1.2.3.4", "port": 12345, "token": "xxx" }
// 响应：透传设备返回的 JSON（{ code, data: { active: bool }, msg }）
func deviceSessionActiveHandler(c *gin.Context) {
	var req struct {
		Host  string `json:"host" binding:"required"`
		Port  int    `json:"port" binding:"required"`
		Token string `json:"token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request: " + err.Error()})
		return
	}

	targetURL := fmt.Sprintf("http://%s:%d/api/session/active", req.Host, req.Port)

	httpReq, _ := http.NewRequest("GET", targetURL, nil)
	httpReq.Header.Set("token", req.Token)

	httpClient := &http.Client{Timeout: 10 * time.Second}
	resp, err := httpClient.Do(httpReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"message": fmt.Sprintf("session check failed: %v", err)})
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"message": "failed to read device response"})
		return
	}

	var result map[string]any
	if err := json.Unmarshal(respBody, &result); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"message": "invalid device response"})
		return
	}
	c.JSON(resp.StatusCode, result)
}

// webrtcProxyHandler 将前端 WebSocket 请求透明代理到设备上的 debian_screen_control 服务。
//
// 查询参数：
//   - device_token : debian_screen_control 的 session token（优先使用）
//   - token        : 设备 token（向后兼容）
//   - host         : 设备 NAT 公网 IP
//   - port         : 端口映射后的公网端口
func webrtcProxyHandler(c *gin.Context) {
	instanceID := c.Param("id")
	deviceToken := c.Query("device_token")
	if deviceToken == "" {
		deviceToken = c.Query("token")
	}
	host := c.Query("host")
	port := c.Query("port")

	logger := slog.Default().With(
		"component", "webrtc-proxy",
		"instance_id", instanceID,
		"client_ip", observability.ClientIP(c.Request),
	)

	if host == "" || port == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "missing host or port"})
		return
	}

	clientKey := c.Request.Header.Get("Sec-WebSocket-Key")
	if clientKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "missing Sec-WebSocket-Key"})
		return
	}

	// 构建上游 WebSocket URL
	addr := net.JoinHostPort(host, port)
	wsURL := fmt.Sprintf("ws://%s/ws", addr)
	if deviceToken != "" {
		wsURL += "?token=" + deviceToken
	}
	logger.Info("开始 WebRTC WebSocket 代理", "target", wsURL)

	// 先劫持客户端连接（在连接上游之前，避免 gin 干扰连接状态）
	hijacker, ok := c.Writer.(http.Hijacker)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "websocket not supported"})
		return
	}
	clientConn, clientBuf, err := hijacker.Hijack()
	if err != nil {
		logger.Error("劫持客户端连接失败", "err", err)
		return
	}
	defer clientConn.Close()

	// 劫持成功后再连接上游
	upstreamConn, upstreamResp, err := dialDeviceWebSocket(wsURL, deviceToken, clientKey)
	if err != nil {
		logger.Error("连接上游 WebSocket 失败", "err", err)
		// 已经 hijack，只能直接写 HTTP 响应
		clientBuf.WriteString("HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\nupstream connection failed")
		clientBuf.Flush()
		return
	}
	defer upstreamConn.Close()
	logger.Info("上游 101 握手成功", "resp_len", len(upstreamResp))

	// 将上游 101 响应原样转发给客户端
	if _, err := clientBuf.Write(upstreamResp); err != nil {
		logger.Error("转发上游 101 响应失败", "err", err)
		return
	}
	if err := clientBuf.Flush(); err != nil {
		logger.Error("刷新响应缓冲区失败", "err", err)
		return
	}

	logger.Info("WebRTC 代理连接已建立，开始双向转发")

	// 双向数据转发
	done := make(chan struct{}, 2)

	// 上游 → 客户端
	go func() {
		defer func() { done <- struct{}{} }()
		buf := make([]byte, 64*1024)
		var total int64
		for {
			n, err := upstreamConn.Read(buf)
			if n > 0 {
				total += int64(n)
				// 尝试解码 WebSocket 文本帧，打印 offer/candidate 内容
				if n > 2 && (buf[0] == 0x81 || buf[0] == 0x82) {
					payload := decodeWSPayload(buf[:n])
					if len(payload) > 0 {
						logger.Info("上游→客户端 WS帧", "bytes", n, "total", total,
							"payload_len", len(payload),
							"preview", string(payload[:min(len(payload), 500)]))
					}
				} else if total <= 512 {
					logger.Info("上游→客户端 数据", "bytes", n, "total", total,
						"hex_head", hex.EncodeToString(buf[:min(n, 32)]))
				}
				if _, wErr := clientConn.Write(buf[:n]); wErr != nil {
					logger.Info("上游→客户端 写入失败", "total", total, "err", wErr)
					return
				}
			}
			if err != nil {
				logger.Info("上游→客户端 读取结束", "total", total, "err", err)
				return
			}
		}
	}()

	// 客户端 → 上游
	go func() {
		defer func() { done <- struct{}{} }()
		buf := make([]byte, 64*1024)
		var total int64
		for {
			n, err := clientConn.Read(buf)
			if n > 0 {
				total += int64(n)
				if total <= 512 {
					logger.Info("客户端→上游 数据", "bytes", n, "total", total,
						"hex_head", hex.EncodeToString(buf[:min(n, 32)]))
				}
				// 尝试解码客户端 WebSocket 帧（masked）
				if n > 6 && (buf[0] == 0x81) {
					payload := decodeWSMaskedPayload(buf[:n])
					if len(payload) > 0 {
						logger.Info("客户端→上游 WS帧", "payload_len", len(payload),
							"preview", string(payload[:min(len(payload), 500)]))
					}
				}
				if _, wErr := upstreamConn.Write(buf[:n]); wErr != nil {
					logger.Info("客户端→上游 写入失败", "total", total, "err", wErr)
					return
				}
			}
			if err != nil {
				logger.Info("客户端→上游 读取结束", "total", total, "err", err)
				return
			}
		}
	}()

	<-done
	logger.Info("WebRTC 代理连接关闭", "instance_id", instanceID)
	upstreamConn.Close()
	clientConn.Close()
	<-done
}

// dialDeviceWebSocket 建立到 debian_screen_control 设备的 WebSocket 连接。
// 转发客户端的 Sec-WebSocket-Key，使上游 101 响应可直接转发给客户端。
// 认证通过 URL query 参数 token 和 token header 完成。
func dialDeviceWebSocket(wsURL, deviceToken, clientKey string) (net.Conn, []byte, error) {
	parsed, err := url.Parse(wsURL)
	if err != nil {
		return nil, nil, fmt.Errorf("解析 URL 失败: %w", err)
	}

	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		port = "80"
	}
	addr := net.JoinHostPort(host, port)

	conn, err := net.DialTimeout("tcp", addr, 15*time.Second)
	if err != nil {
		return nil, nil, fmt.Errorf("TCP 连接失败: %w", err)
	}

	// 构建升级请求
	requestURI := parsed.RequestURI()
	upgradeReq := fmt.Sprintf(
		"GET %s HTTP/1.1\r\n"+
			"Host: %s\r\n"+
			"Upgrade: websocket\r\n"+
			"Connection: Upgrade\r\n"+
			"Sec-WebSocket-Version: 13\r\n"+
			"Sec-WebSocket-Key: %s\r\n"+
			"Origin: http://%s\r\n",
		requestURI, addr, clientKey, addr,
	)
	if deviceToken != "" {
		upgradeReq += fmt.Sprintf("token: %s\r\n", deviceToken)
	}
	upgradeReq += "\r\n"

	if _, err := conn.Write([]byte(upgradeReq)); err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("发送升级请求失败: %w", err)
	}

	// 读取 101 响应
	reader := bufio.NewReader(conn)
	conn.SetReadDeadline(time.Now().Add(15 * time.Second))

	var respBuilder strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			conn.Close()
			return nil, nil, fmt.Errorf("读取响应失败: %w", err)
		}
		respBuilder.WriteString(line)
		if line == "\r\n" {
			break
		}
	}
	conn.SetReadDeadline(time.Time{})

	respStr := respBuilder.String()
	if !strings.HasPrefix(respStr, "HTTP/1.1 101") {
		conn.Close()
		return nil, nil, fmt.Errorf("WebSocket 升级失败: %s", respStr)
	}

	// 始终包装 bufferedConn，确保 bufio 缓冲的数据不丢失
	return &bufferedConn{Conn: conn, reader: reader}, []byte(respStr), nil
}

// decodeWSPayload 解码服务端发来的未 mask 的 WebSocket 文本帧
func decodeWSPayload(frame []byte) []byte {
	if len(frame) < 2 {
		return nil
	}
	payloadLen := int(frame[1] & 0x7f)
	offset := 2
	if payloadLen == 126 && len(frame) >= 4 {
		payloadLen = int(frame[2])<<8 | int(frame[3])
		offset = 4
	} else if payloadLen == 127 && len(frame) >= 10 {
		payloadLen = int(frame[6])<<24 | int(frame[7])<<16 | int(frame[8])<<8 | int(frame[9])
		offset = 10
	}
	if offset+payloadLen > len(frame) {
		payloadLen = len(frame) - offset
	}
	if payloadLen <= 0 {
		return nil
	}
	return frame[offset : offset+payloadLen]
}

// decodeWSMaskedPayload 解码客户端发来的 masked WebSocket 文本帧
func decodeWSMaskedPayload(frame []byte) []byte {
	if len(frame) < 6 {
		return nil
	}
	masked := (frame[1] & 0x80) != 0
	payloadLen := int(frame[1] & 0x7f)
	offset := 2
	if payloadLen == 126 && len(frame) >= 4 {
		payloadLen = int(frame[2])<<8 | int(frame[3])
		offset = 4
	} else if payloadLen == 127 && len(frame) >= 10 {
		payloadLen = int(frame[6])<<24 | int(frame[7])<<16 | int(frame[8])<<8 | int(frame[9])
		offset = 10
	}
	var maskKey []byte
	if masked {
		if offset+4 > len(frame) {
			return nil
		}
		maskKey = frame[offset : offset+4]
		offset += 4
	}
	if offset+payloadLen > len(frame) {
		payloadLen = len(frame) - offset
	}
	if payloadLen <= 0 {
		return nil
	}
	payload := make([]byte, payloadLen)
	copy(payload, frame[offset:offset+payloadLen])
	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i%4]
		}
	}
	return payload
}
