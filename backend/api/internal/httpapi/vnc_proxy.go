package httpapi

import (
"fmt"
"io"
"log/slog"
"net/http"

"github.com/gin-gonic/gin"

"device-control-center/backend/api/internal/config"
"device-control-center/backend/api/internal/observability"
"device-control-center/backend/api/internal/service"
)

// vncProxyHandler 将前端 VNC WebSocket 请求透明代理到上游 Console WebSocket 服务。
// 工作流程：
//  1. 通过 ConsoleService 获取实例的 Console URL（WSS 地址）
//  2. 劫持客户端 HTTP 连接（Hijack）
//  3. 向上游 Console URL 建立 WebSocket 连接
//  4. 双向转发数据直到任一端关闭连接
func vncProxyHandler(c *gin.Context, cfg config.Config, console *service.ConsoleService) {
instanceID := c.Param("id")
token := c.Query("token")

logger := slog.Default().With(
"component", "vnc-proxy",
"instance_id", instanceID,
"client_ip", observability.ClientIP(c.Request),
)

// 验证 token 参数
if token == "" {
logger.Warn("VNC 代理请求缺少 token")
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

// 获取实例的 Console URL（上游 VNC WebSocket 地址）
logger.Info("获取实例 Console URL", "instance_id", instanceID)
consoleResult, err := console.GetConsoleURL(c.Request.Context(), token, instanceID)
if err != nil {
logger.Error("获取 Console URL 失败", "err", err)
c.JSON(http.StatusBadGateway, gin.H{"message": fmt.Sprintf("failed to get console URL: %v", err)})
return
}

consoleURL := consoleResult.ConsoleURL
if consoleURL == "" {
logger.Warn("Console URL 为空")
c.JSON(http.StatusNotFound, gin.H{"message": "console URL not available"})
return
}

logger.Info("开始 VNC WebSocket 代理", "upstream_url", consoleURL)

// 向上游 Console URL 建立 WebSocket 连接
upstreamConn, upstreamRespBytes, err := dialUpstreamWebSocket(consoleURL, token, clientKey)
if err != nil {
logger.Error("连接上游 VNC WebSocket 失败", "err", err)
c.JSON(http.StatusBadGateway, gin.H{"message": fmt.Sprintf("upstream VNC connection failed: %v", err)})
return
}
defer upstreamConn.Close()

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
logger.Error("转发上游 VNC 101 响应失败", "err", err)
return
}
if err := clientBuf.Flush(); err != nil {
logger.Error("刷新 VNC 响应缓冲区失败", "err", err)
return
}

logger.Info("VNC WebSocket 代理连接已建立，开始双向转发")

// 双向数据转发
done := make(chan struct{}, 2)

// 上游 → 客户端
go func() {
defer func() { done <- struct{}{} }()
n, err := io.Copy(clientConn, upstreamConn)
logger.Info("VNC 上游→客户端 转发结束", "bytes", n, "err", err)
}()

// 客户端 → 上游
go func() {
defer func() { done <- struct{}{} }()
n, err := io.Copy(upstreamConn, clientConn)
logger.Info("VNC 客户端→上游 转发结束", "bytes", n, "err", err)
}()

// 等待任一方向结束
<-done
logger.Info("VNC WebSocket 代理连接关闭")
}
