package observability

import (
	"bufio"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const slowRequestThreshold = 750 * time.Millisecond

// Configure installs a JSON logger once at startup so the rest of the code can
// use slog.Default() without wiring logger state through every constructor.
func Configure(level string) *slog.Logger {
	var minLevel slog.LevelVar
	minLevel.Set(parseLevel(level))

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level:     &minLevel,
		AddSource: false,
	}))
	slog.SetDefault(logger)
	return logger
}

// RequestLogger records only slow or failed requests so the logs stay useful.
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		recorder := &statusWriter{ResponseWriter: c.Writer}
		c.Writer = recorder
		start := time.Now()
		c.Next()

		status := recorder.status
		if status == 0 {
			status = http.StatusOK
		}
		elapsed := time.Since(start)
		if status < http.StatusBadRequest && elapsed < slowRequestThreshold {
			return
		}

		fields := []any{
			"component", "http",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", status,
			"duration_ms", elapsed.Milliseconds(),
			"client_ip", ClientIP(c.Request),
		}
		if status >= http.StatusBadRequest {
			slog.Default().Warn("request completed with error", append(fields, "query", c.Request.URL.RawQuery)...)
			return
		}
		slog.Default().Info("request completed slowly", fields...)
	}
}

// RecoveryLogger turns panics into a structured error log instead of a noisy stack trace.
func RecoveryLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.Default().Error(
					"panic recovered",
					"component", "http",
					"method", c.Request.Method,
					"path", c.Request.URL.Path,
					"panic", recovered,
					"stack", string(debug.Stack()),
				)
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"message": "internal server error"})
			}
		}()
		c.Next()
	}
}

// IsExpectedError keeps request handlers from logging auth noise as server faults.
func IsExpectedError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	switch {
	case strings.Contains(message, "token"), strings.Contains(message, "登录"), strings.Contains(message, "认证"), strings.Contains(message, "unauthorized"):
		return true
	case strings.Contains(message, "password"), strings.Contains(message, "账号"), strings.Contains(message, "credential"):
		return true
	case strings.Contains(message, "not found"), strings.Contains(message, "不存在"):
		return true
	case strings.Contains(message, "invalid"), strings.Contains(message, "参数"), strings.Contains(message, "bad request"):
		return true
	default:
		return false
	}
}

func parseLevel(level string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

// Hijack 实现 http.Hijacker 接口，支持 WebSocket 连接升级。
// 将调用委托给底层的 ResponseWriter（标准库的 ResponseWriter 默认支持 Hijack）。
func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("underlying ResponseWriter does not support Hijack")
	}
	return h.Hijack()
}

func ClientIP(r *http.Request) string {
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
		parts := strings.Split(forwarded, ",")
		return strings.TrimSpace(parts[0])
	}
	if realIP := strings.TrimSpace(r.Header.Get("X-Real-IP")); realIP != "" {
		return realIP
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}
