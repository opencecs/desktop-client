package httpapi

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"device-control-center/backend/api/internal/config"
	"device-control-center/backend/api/internal/model"
	"device-control-center/backend/api/internal/observability"
	"device-control-center/backend/api/internal/service"
)

func RegisterRoutes(engine *gin.Engine, cfg config.Config, auth *service.AuthService, console *service.ConsoleService) {
	// CORS 中间件 — 允许 Tauri 桌面端（https://tauri.localhost）跨域请求
	engine.Use(corsMiddleware())

	engine.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := engine.Group("/api")
	{
		api.POST("/auth/login", func(c *gin.Context) { loginHandler(c, auth) })
		api.POST("/auth/login/account", func(c *gin.Context) { loginHandler(c, auth) })
		api.POST("/auth/refresh", func(c *gin.Context) { refreshHandler(c, auth) })
		api.POST("/user/token/refresh", func(c *gin.Context) { refreshHandler(c, auth) })
		// 发送验证码（无需登录）
		api.POST("/auth/sms/send", func(c *gin.Context) { sendSmsCodeHandler(c, auth) })
		api.POST("/auth/email/send", func(c *gin.Context) { sendEmailCodeHandler(c, auth) })

		protected := api.Group("/")
		protected.Use(authMiddleware())
		protected.GET("/me", func(c *gin.Context) { meHandler(c, auth) })
		protected.GET("/user/info", func(c *gin.Context) { meHandler(c, auth) })
		protected.POST("/auth/logout", func(c *gin.Context) { logoutHandler(c, auth) })
		protected.POST("/user/logout", func(c *gin.Context) { logoutHandler(c, auth) })
		// 用户资料编辑
		protected.POST("/user/bind/phone", func(c *gin.Context) { bindPhoneHandler(c, auth) })
		protected.POST("/user/bind/email", func(c *gin.Context) { bindEmailHandler(c, auth) })
		protected.POST("/user/change/password", func(c *gin.Context) { changePasswordHandler(c, auth) })
		protected.GET("/console/instances", func(c *gin.Context) { listInstancesHandler(c, console) })
		protected.GET("/console/instances/:id", func(c *gin.Context) { getInstanceHandler(c, console) })
		protected.GET("/console/instances/:id/port-mappings/overview", func(c *gin.Context) { portMappingOverviewHandler(c, console) })
		protected.GET("/console/instances/:id/port-mappings", func(c *gin.Context) { listPortMappingsHandler(c, console) })
		protected.POST("/console/instances/:id/port-mappings", func(c *gin.Context) { createPortMappingHandler(c, console) })
		protected.PATCH("/console/instances/:id/port-mappings/:mapping_id", func(c *gin.Context) { updatePortMappingHandler(c, console) })
		protected.DELETE("/console/instances/:id/port-mappings/:mapping_id", func(c *gin.Context) { deletePortMappingHandler(c, console) })
		protected.POST("/console/instances/:id/port-mappings/batch", func(c *gin.Context) { batchCreatePortMappingsHandler(c, console) })
		protected.DELETE("/console/instances/:id/port-mappings/batch", func(c *gin.Context) { batchDeletePortMappingsHandler(c, console) })
		protected.POST("/console/instances/:id/start", func(c *gin.Context) { actionHandler(c, console, model.ActionStart) })
		protected.POST("/console/instances/:id/stop", func(c *gin.Context) { actionHandler(c, console, model.ActionStop) })
		protected.POST("/console/instances/:id/reboot", func(c *gin.Context) { actionHandler(c, console, model.ActionReboot) })
		protected.GET("/console/instances/:id/console", func(c *gin.Context) { consoleURLHandler(c, console) })
		protected.GET("/console/instances/:id/op-logs", func(c *gin.Context) { listOpLogsHandler(c, console) })

		// SharedStorage 文件管理
		protected.GET("/console/storage/instances", func(c *gin.Context) { listStorageInstancesHandler(c, console) })
		protected.GET("/console/instances/:id/storage/overview", func(c *gin.Context) { storageOverviewHandler(c, console) })
		protected.GET("/console/instances/:id/storage/files", func(c *gin.Context) { listStorageFilesHandler(c, console) })
		protected.POST("/console/instances/:id/storage/folders", func(c *gin.Context) { createStorageFolderHandler(c, console) })
		protected.DELETE("/console/instances/:id/storage/files/*key", func(c *gin.Context) { deleteStorageFileHandler(c, console) })
		protected.PUT("/console/instances/:id/storage/upload/*key", func(c *gin.Context) { uploadStorageFileHandler(c, console) })
		protected.GET("/console/instances/:id/storage/download/*key", func(c *gin.Context) { downloadStorageFileHandler(c, console) })

		// VNC 截图 REST API（不需要 WebSocket，直接返回 JPEG）
		// 注意：放在 protected 组外，因为 img src 无法发 Authorization header，
		// token 通过 query 参数传递（与 WebSocket 终端一致）
		api.GET("/console/instances/:id/screenshot", func(c *gin.Context) { vncScreenshotHandler(c) })

		// WebSocket 终端 — SSH 和 VNC 均为本地桥接实现，串口代理上游
		// token 通过 query 参数传递（WebSocket 不支持自定义 Header）
		api.GET("/instance/:id/ssh", func(c *gin.Context) { sshTerminalHandler(c) })
		api.GET("/instance/:id/serial", func(c *gin.Context) { wsProxyHandler(c, cfg, "serial") })
		api.GET("/instance/:id/vnc", func(c *gin.Context) { vncTerminalHandler(c) })
	}
}

// corsMiddleware 处理跨域请求
// Tauri 2 桌面端前端 origin 为 https://tauri.localhost，
// 直接请求 http://127.0.0.1:8080 时需要 CORS 头
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Writer.Header().Set("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization, Accept")
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
			c.Writer.Header().Set("Access-Control-Max-Age", "86400")
		}

		// 预检请求直接返回 204
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

func authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			// Missing bearer tokens are common in manual testing, so keep one warning here.
			slog.Default().Warn(
				"missing bearer token",
				"component", "auth",
				"method", c.Request.Method,
				"path", c.Request.URL.Path,
				"client_ip", observability.ClientIP(c.Request),
			)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "missing bearer token"})
			return
		}
		c.Next()
	}
}
