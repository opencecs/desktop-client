package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"device-control-center/backend/api/internal/model"
	"device-control-center/backend/api/internal/service"
)

// ───────── SharedStorage 文件管理处理器 ─────────

// listStorageInstancesHandler 获取用户共享存储实例列表
func listStorageInstancesHandler(c *gin.Context, console *service.ConsoleService) {
	slog.Default().Info("处理存储实例列表请求", "component", "httpapi")
	resp, err := console.GetStorageInstances(c.Request.Context(), extractBearer(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

// storageOverviewHandler 获取实例存储空间概览
func storageOverviewHandler(c *gin.Context, console *service.ConsoleService) {
	instanceID := c.Param("id")
	slog.Default().Info("处理存储概览请求", "component", "httpapi", "instance_id", instanceID)

	resp, err := console.GetStorageOverview(c.Request.Context(), extractBearer(c), instanceID)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

// listStorageFilesHandler 列出存储文件列表
func listStorageFilesHandler(c *gin.Context, console *service.ConsoleService) {
	instanceID := c.Param("id")
	prefix := c.Query("prefix")
	slog.Default().Info("处理存储文件列表请求", "component", "httpapi", "instance_id", instanceID, "prefix", prefix)

	resp, err := console.ListStorageFiles(c.Request.Context(), extractBearer(c), instanceID, model.StorageFileListInput{
		Prefix:   prefix,
		Page:     parseQueryInt(c.Query("page"), 1),
		PageSize: parseQueryInt(c.Query("page_size"), 50),
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

// createStorageFolderHandler 创建文件夹
func createStorageFolderHandler(c *gin.Context, console *service.ConsoleService) {
	instanceID := c.Param("id")
	var req model.StorageCreateFolderInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	slog.Default().Info("处理创建文件夹请求", "component", "httpapi", "instance_id", instanceID, "path", req.Path)

	resp, err := console.CreateStorageFolder(c.Request.Context(), extractBearer(c), instanceID, req)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

// deleteStorageFileHandler 删除文件或文件夹
func deleteStorageFileHandler(c *gin.Context, console *service.ConsoleService) {
	instanceID := c.Param("id")
	// 使用 *key 通配符捕获带斜杠的文件路径
	key := c.Param("key")
	key = strings.TrimPrefix(key, "/")
	slog.Default().Info("处理删除文件请求", "component", "httpapi", "instance_id", instanceID, "key", key)

	resp, err := console.DeleteStorageFile(c.Request.Context(), extractBearer(c), instanceID, key)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

// uploadStorageFileHandler 上传文件 — 流式代理到上游
func uploadStorageFileHandler(c *gin.Context, console *service.ConsoleService) {
	instanceID := c.Param("id")
	key := c.Param("key")
	key = strings.TrimPrefix(key, "/")
	bearer := extractBearer(c)

	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "文件路径不能为空"})
		return
	}

	slog.Default().Info("处理文件上传请求", "component", "httpapi", "instance_id", instanceID, "key", key, "content_length", c.Request.ContentLength)

	// 获取上游上传地址
	upstreamURL := console.GetUploadURL(c.Request.Context(), bearer, instanceID, key)

	// 创建上游请求，将请求体流式转发
	upstreamReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPut, upstreamURL, c.Request.Body)
	if err != nil {
		slog.Default().Warn("创建上游上传请求失败", "component", "httpapi", "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"message": "创建上传请求失败"})
		return
	}
	// 转发请求头
	if ct := c.GetHeader("Content-Type"); ct != "" {
		upstreamReq.Header.Set("Content-Type", ct)
	}
	if cl := c.Request.ContentLength; cl > 0 {
		upstreamReq.ContentLength = cl
	}
	if bearer != "" {
		upstreamReq.Header.Set("Authorization", bearer)
	}

	// 执行上游请求
	client := &http.Client{}
	upstreamResp, err := client.Do(upstreamReq)
	if err != nil {
		slog.Default().Warn("上游上传请求失败", "component", "httpapi", "err", err)
		c.JSON(http.StatusBadGateway, gin.H{"message": "上传到上游失败"})
		return
	}
	defer upstreamResp.Body.Close()

	// 将上游响应透传回客户端
	body, _ := io.ReadAll(upstreamResp.Body)
	w := c.Writer
	if ct := upstreamResp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.WriteHeader(upstreamResp.StatusCode)
	_, _ = w.Write(body)
}

// downloadStorageFileHandler 下载文件 — 流式代理到上游
func downloadStorageFileHandler(c *gin.Context, console *service.ConsoleService) {
	instanceID := c.Param("id")
	key := c.Param("key")
	key = strings.TrimPrefix(key, "/")
	bearer := extractBearer(c)

	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "文件路径不能为空"})
		return
	}

	slog.Default().Info("处理文件下载请求", "component", "httpapi", "instance_id", instanceID, "key", key)

	// 获取上游下载地址
	upstreamURL := console.GetDownloadURL(c.Request.Context(), bearer, instanceID, key)

	// 创建上游请求
	upstreamReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, upstreamURL, nil)
	if err != nil {
		slog.Default().Warn("创建上游下载请求失败", "component", "httpapi", "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"message": "创建下载请求失败"})
		return
	}
	if bearer != "" {
		upstreamReq.Header.Set("Authorization", bearer)
	}

	// 执行上游请求
	client := &http.Client{}
	upstreamResp, err := client.Do(upstreamReq)
	if err != nil {
		slog.Default().Warn("上游下载请求失败", "component", "httpapi", "err", err)
		c.JSON(http.StatusBadGateway, gin.H{"message": "从上游下载失败"})
		return
	}
	defer upstreamResp.Body.Close()

	w := c.Writer

	if upstreamResp.StatusCode >= http.StatusBadRequest {
		body, _ := io.ReadAll(upstreamResp.Body)
		if ct := upstreamResp.Header.Get("Content-Type"); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		w.WriteHeader(upstreamResp.StatusCode)
		_, _ = w.Write(body)
		return
	}

	// 设置下载响应头
	if cd := upstreamResp.Header.Get("Content-Disposition"); cd != "" {
		w.Header().Set("Content-Disposition", cd)
	} else {
		// 从 key 中提取文件名
		parts := strings.Split(key, "/")
		filename := parts[len(parts)-1]
		w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	}
	if ct := upstreamResp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if cl := upstreamResp.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}

	// 流式传输文件内容到客户端
	w.WriteHeader(upstreamResp.StatusCode)
	if _, err := io.Copy(w, upstreamResp.Body); err != nil {
		slog.Default().Warn("文件下载流式传输失败", "component", "httpapi", "instance_id", instanceID, "key", key, "err", err)
	}
}

// ───────── 操作日志处理器 ─────────

// listOpLogsHandler 获取实例操作日志列表
func listOpLogsHandler(c *gin.Context, console *service.ConsoleService) {
	instanceID := c.Param("id")
	page := 1
	pageSize := 20
	if v := c.Query("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}
	if v := c.Query("page_size"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 50 {
			pageSize = n
		}
	}
	slog.Default().Info("处理操作日志请求", "component", "httpapi", "instance_id", instanceID, "page", page)
	resp, err := console.GetOpLogs(c.Request.Context(), extractBearer(c), instanceID, page, pageSize)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

// ───────── 确保 model 包中的占位符不会被编译器优化掉 ─────────
var _ = model.OpLogEntry{}
