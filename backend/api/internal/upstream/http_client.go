package upstream

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"device-control-center/backend/api/internal/config"
	"device-control-center/backend/api/internal/model"
)

type HTTPClient struct {
	baseURL string
	http    *http.Client
	logger  *slog.Logger
}

func NewHTTPClient(cfg config.Config) *HTTPClient {
	return &HTTPClient{
		baseURL: strings.TrimRight(cfg.UpstreamBaseURL, "/"),
		http: &http.Client{
			Timeout: time.Duration(cfg.RequestTimeoutMS) * time.Millisecond,
		},
		logger: slog.Default().With("component", "upstream", "base_url", strings.TrimRight(cfg.UpstreamBaseURL, "/")),
	}
}

func (c *HTTPClient) Login(ctx context.Context, input model.LoginInput) (model.AuthResponse, error) {
	var resp model.AuthResponse
	return resp, c.doJSON(ctx, http.MethodPost, "/auth/login/account", "", input, &resp)
}

func (c *HTTPClient) Refresh(ctx context.Context, token, bearer string) (model.AuthResponse, error) {
	var resp model.AuthResponse
	payload := map[string]string{"token": token}
	return resp, c.doJSON(ctx, http.MethodPost, "/user/token/refresh", bearer, payload, &resp)
}

func (c *HTTPClient) Me(ctx context.Context, bearer string) (model.MeResponse, error) {
	var resp model.MeResponse
	return resp, c.doJSON(ctx, http.MethodGet, "/user/info", bearer, nil, &resp)
}

func (c *HTTPClient) Logout(ctx context.Context, bearer string) error {
	return c.doJSON(ctx, http.MethodPost, "/user/logout", bearer, nil, nil)
}

// SendSmsCode 发送短信验证码（无需登录）
func (c *HTTPClient) SendSmsCode(ctx context.Context, input model.SendSmsCodeInput) error {
	return c.doJSON(ctx, http.MethodPost, "/auth/sms/send", "", input, nil)
}

// SendEmailCode 发送邮箱验证码（无需登录）
func (c *HTTPClient) SendEmailCode(ctx context.Context, input model.SendEmailCodeInput) error {
	return c.doJSON(ctx, http.MethodPost, "/auth/email/send", "", input, nil)
}

// BindPhone 绑定/换绑手机号
func (c *HTTPClient) BindPhone(ctx context.Context, bearer string, input model.BindPhoneInput) error {
	return c.doJSON(ctx, http.MethodPost, "/user/bind/phone", bearer, input, nil)
}

// BindEmail 绑定/换绑邮箱
func (c *HTTPClient) BindEmail(ctx context.Context, bearer string, input model.BindEmailInput) error {
	return c.doJSON(ctx, http.MethodPost, "/user/bind/email", bearer, input, nil)
}

// ChangePassword 修改密码
func (c *HTTPClient) ChangePassword(ctx context.Context, bearer string, input model.ChangePasswordInput) error {
	return c.doJSON(ctx, http.MethodPost, "/user/change/password", bearer, input, nil)
}

func (c *HTTPClient) ListInstances(ctx context.Context, bearer string, input model.ListInstancesInput) (model.InstanceListResponse, error) {
	params := url.Values{}
	if input.Page > 0 {
		params.Set("page", fmt.Sprintf("%d", input.Page))
	}
	if input.PageSize > 0 {
		params.Set("page_size", fmt.Sprintf("%d", input.PageSize))
	}
	if input.Status != "" {
		params.Set("status", input.Status)
	}
	if input.Search != "" {
		params.Set("search", input.Search)
	}
	path := "/cecs/instances"
	if encoded := params.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var resp model.InstanceListResponse
	return resp, c.doJSON(ctx, http.MethodGet, path, bearer, nil, &resp)
}

func (c *HTTPClient) GetInstance(ctx context.Context, bearer, instanceID string) (model.InstanceDetail, error) {
	var resp model.InstanceDetail
	return resp, c.doJSON(ctx, http.MethodGet, "/cecs/instances/"+instanceID, bearer, nil, &resp)
}

func (c *HTTPClient) GetPortMappingOverview(ctx context.Context, bearer, instanceID string) (model.PortMappingOverview, error) {
	var resp model.PortMappingOverview
	path := fmt.Sprintf("/cecs/instances/%s/port-mappings/overview", instanceID)
	return resp, c.doJSON(ctx, http.MethodGet, path, bearer, nil, &resp)
}

func (c *HTTPClient) ListPortMappings(ctx context.Context, bearer, instanceID string, input model.ListPortMappingsInput) (model.PortMappingListResponse, error) {
	params := url.Values{}
	if input.Protocol != "" {
		params.Set("protocol", input.Protocol)
	}
	if input.Page > 0 {
		params.Set("page", fmt.Sprintf("%d", input.Page))
	}
	if input.PageSize > 0 {
		params.Set("page_size", fmt.Sprintf("%d", input.PageSize))
	}
	path := fmt.Sprintf("/cecs/instances/%s/port-mappings", instanceID)
	if encoded := params.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var resp model.PortMappingListResponse
	return resp, c.doJSON(ctx, http.MethodGet, path, bearer, nil, &resp)
}

func (c *HTTPClient) CreatePortMapping(ctx context.Context, bearer, instanceID string, input model.CreatePortMappingInput) (model.PortMappingRule, error) {
	var resp model.PortMappingRule
	path := fmt.Sprintf("/cecs/instances/%s/port-mappings", instanceID)
	return resp, c.doJSON(ctx, http.MethodPost, path, bearer, input, &resp)
}

func (c *HTTPClient) UpdatePortMapping(ctx context.Context, bearer, instanceID, mappingID string, input model.UpdatePortMappingInput) (model.PortMappingRule, error) {
	var resp model.PortMappingRule
	path := fmt.Sprintf("/cecs/instances/%s/port-mappings/%s", instanceID, mappingID)
	return resp, c.doJSON(ctx, http.MethodPatch, path, bearer, input, &resp)
}

func (c *HTTPClient) DeletePortMapping(ctx context.Context, bearer, instanceID, mappingID string) error {
	path := fmt.Sprintf("/cecs/instances/%s/port-mappings/%s", instanceID, mappingID)
	return c.doJSON(ctx, http.MethodDelete, path, bearer, nil, nil)
}

func (c *HTTPClient) BatchCreatePortMappings(ctx context.Context, bearer, instanceID string, input model.BatchCreatePortMappingsInput) (model.BatchPortMappingResponse, error) {
	var resp model.BatchPortMappingResponse
	path := fmt.Sprintf("/cecs/instances/%s/port-mappings/batch", instanceID)
	return resp, c.doJSON(ctx, http.MethodPost, path, bearer, input, &resp)
}

func (c *HTTPClient) BatchDeletePortMappings(ctx context.Context, bearer, instanceID string, input model.BatchDeletePortMappingsInput) (model.BatchPortMappingResponse, error) {
	var resp model.BatchPortMappingResponse
	path := fmt.Sprintf("/cecs/instances/%s/port-mappings/batch", instanceID)
	return resp, c.doJSON(ctx, http.MethodDelete, path, bearer, input, &resp)
}

func (c *HTTPClient) RunAction(ctx context.Context, bearer, instanceID string, action model.InstanceAction) (model.ActionResponse, error) {
	var resp model.ActionResponse
	return resp, c.doJSON(ctx, http.MethodPost, fmt.Sprintf("/cecs/instances/%s/%s", instanceID, action), bearer, nil, &resp)
}

func (c *HTTPClient) GetConsoleURL(ctx context.Context, bearer, instanceID string) (model.ConsoleURLResponse, error) {
	var resp model.ConsoleURLResponse
	return resp, c.doJSON(ctx, http.MethodGet, fmt.Sprintf("/cecs/instances/%s/console", instanceID), bearer, nil, &resp)
}

// ───────── SharedStorage 文件管理 ─────────

// GetStorageInstances 获取用户的共享存储实例列表（来自 /shared-storage/overview）
func (c *HTTPClient) GetStorageInstances(ctx context.Context, bearer string) (model.StorageInstanceListResponse, error) {
	var resp model.StorageInstanceListResponse
	return resp, c.doJSON(ctx, http.MethodGet, "/shared-storage/overview", bearer, nil, &resp)
}

// GetOpLogs 获取实例操作日志
func (c *HTTPClient) GetOpLogs(ctx context.Context, bearer, instanceID string, page, pageSize int) (model.OpLogListResponse, error) {
	params := url.Values{}
	params.Set("page", fmt.Sprintf("%d", page))
	params.Set("page_size", fmt.Sprintf("%d", pageSize))
	path := fmt.Sprintf("/cecs/instances/%s/op-logs?%s", instanceID, params.Encode())
	var resp model.OpLogListResponse
	return resp, c.doJSON(ctx, http.MethodGet, path, bearer, nil, &resp)
}

// GetStorageOverview 获取实例存储空间概览
func (c *HTTPClient) GetStorageOverview(ctx context.Context, bearer, instanceID string) (model.StorageOverview, error) {
	var resp model.StorageOverview
	path := fmt.Sprintf("/shared-storage/instances/%s/overview", instanceID)
	return resp, c.doJSON(ctx, http.MethodGet, path, bearer, nil, &resp)
}

// ListStorageFiles 列出存储空间中的文件和文件夹
func (c *HTTPClient) ListStorageFiles(ctx context.Context, bearer, instanceID string, input model.StorageFileListInput) (model.StorageFileListResponse, error) {
	params := url.Values{}
	if input.Prefix != "" {
		params.Set("prefix", input.Prefix)
	}
	if input.Page > 0 {
		params.Set("page", fmt.Sprintf("%d", input.Page))
	}
	if input.PageSize > 0 {
		params.Set("page_size", fmt.Sprintf("%d", input.PageSize))
	}
	path := fmt.Sprintf("/shared-storage/instances/%s/files", instanceID)
	if encoded := params.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var resp model.StorageFileListResponse
	return resp, c.doJSON(ctx, http.MethodGet, path, bearer, nil, &resp)
}

// CreateStorageFolder 在存储空间中创建文件夹
func (c *HTTPClient) CreateStorageFolder(ctx context.Context, bearer, instanceID string, input model.StorageCreateFolderInput) (model.StorageCreateFolderResponse, error) {
	var resp model.StorageCreateFolderResponse
	path := fmt.Sprintf("/shared-storage/instances/%s/folders", instanceID)
	return resp, c.doJSON(ctx, http.MethodPost, path, bearer, input, &resp)
}

// DeleteStorageFile 删除存储空间中的文件或文件夹
func (c *HTTPClient) DeleteStorageFile(ctx context.Context, bearer, instanceID, key string) (model.StorageDeleteResponse, error) {
	var resp model.StorageDeleteResponse
	path := fmt.Sprintf("/shared-storage/instances/%s/files/%s", instanceID, key)
	return resp, c.doJSON(ctx, http.MethodDelete, path, bearer, nil, &resp)
}

// UploadStorageFileURL 返回上游文件上传地址（由 handler 层做流式代理）
func (c *HTTPClient) UploadStorageFileURL(ctx context.Context, bearer, instanceID, key string) string {
	return fmt.Sprintf("%s/shared-storage/instances/%s/files/%s", c.baseURL, instanceID, key)
}

// DownloadStorageFileURL 返回上游文件下载地址（由 handler 层做流式代理）
func (c *HTTPClient) DownloadStorageFileURL(ctx context.Context, bearer, instanceID, key string) string {
	return fmt.Sprintf("%s/shared-storage/instances/%s/files/%s/download", c.baseURL, instanceID, key)
}

// maxRetries 是遇到 429 限流时的最大重试次数
const maxRetries = 3

// retryBaseDelay 是重试的基础等待时间，每次重试翻倍（指数退避）
const retryBaseDelay = 500 * time.Millisecond

func (c *HTTPClient) doJSON(ctx context.Context, method, path, bearer string, body any, out any) error {
	start := time.Now()

	// 预先序列化 body，以便重试时可以重复使用
	var bodyData []byte
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyData = data
	}

	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		// 非首次请求时执行指数退避等待
		if attempt > 0 {
			delay := retryBaseDelay * time.Duration(1<<(attempt-1))
			c.logger.Info("upstream 429 rate limited, retrying with backoff",
				"method", method, "path", path,
				"attempt", attempt, "delay_ms", delay.Milliseconds())
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
			}
		}

		var reader io.Reader
		if bodyData != nil {
			reader = bytes.NewReader(bodyData)
		}
		req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		if bearer != "" {
			req.Header.Set("Authorization", bearer)
		}

		resp, err := c.http.Do(req)
		if err != nil {
			c.logger.Warn("upstream request failed", "method", method, "path", path, "err", err)
			return err
		}

		payload, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return err
		}

		// 429 限流：记录错误后继续重试
		if resp.StatusCode == http.StatusTooManyRequests {
			lastErr = fmt.Errorf("upstream %s %s failed: status=429", method, path)
			continue
		}

		if resp.StatusCode >= http.StatusBadRequest {
			err := fmt.Errorf("upstream %s %s failed: status=%d", method, path, resp.StatusCode)
			c.logger.Warn("upstream request returned error status", "method", method, "path", path, "status", resp.StatusCode, "duration_ms", time.Since(start).Milliseconds())
			return err
		}

		// 请求成功，解析响应
		if out == nil {
			// 某些接口只返回信封式成功/失败响应
			if err := decodeEnvelopeStatus(payload); err != nil {
				c.logger.Warn("upstream envelope reported business error", "method", method, "path", path, "err", err, "duration_ms", time.Since(start).Milliseconds())
				return err
			}
			return nil
		}
		if err := decodeResponse(payload, out); err != nil {
			c.logger.Warn("upstream response decode failed", "method", method, "path", path, "err", err, "duration_ms", time.Since(start).Milliseconds())
			return err
		}
		return nil
	}

	// 所有重试均失败，返回最后一次错误
	c.logger.Warn("upstream request exhausted retries", "method", method, "path", path, "retries", maxRetries, "duration_ms", time.Since(start).Milliseconds())
	return lastErr
}

func decodeResponse(payload []byte, out any) error {
	if len(payload) == 0 {
		return nil
	}

	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(payload, &envelope); err == nil {
		if err := decodeEnvelopeBusinessError(envelope); err != nil {
			return err
		}
		for _, candidate := range decodeEnvelopeCandidates(envelope) {
			if decodeObjectInto(candidate, out) {
				return nil
			}
		}
	}

	if decodeObjectInto(payload, out) {
		return nil
	}

	return fmt.Errorf("unable to decode upstream response")
}

func decodeObjectInto(payload []byte, target any) bool {
	if len(payload) == 0 || strings.EqualFold(strings.TrimSpace(string(payload)), "null") {
		return false
	}
	if err := json.Unmarshal(payload, target); err == nil {
		return true
	}
	return false
}

func decodeEnvelopeStatus(payload []byte) error {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil
	}
	return decodeEnvelopeBusinessError(envelope)
}

func decodeEnvelopeBusinessError(envelope map[string]json.RawMessage) error {
	if raw, ok := envelope["code"]; ok && len(raw) > 0 {
		var code int
		if err := json.Unmarshal(raw, &code); err == nil && code != 200 {
			return errors.New(readEnvelopeMessage(envelope, code))
		}
	}
	return nil
}

func readEnvelopeMessage(envelope map[string]json.RawMessage, code int) string {
	message := fmt.Sprintf("upstream business error: code=%d", code)
	if raw, ok := envelope["message"]; ok && len(raw) > 0 {
		var text string
		if err := json.Unmarshal(raw, &text); err == nil && strings.TrimSpace(text) != "" {
			message = text
		}
	}
	return message
}

func decodeEnvelopeCandidates(envelope map[string]json.RawMessage) [][]byte {
	candidates := make([][]byte, 0, 8)
	for _, key := range []string{"data", "result", "instance", "payload", "content"} {
		raw, ok := envelope[key]
		if !ok || len(raw) == 0 {
			continue
		}
		for _, nested := range decodeNestedCandidates(raw) {
			candidates = append(candidates, nested)
		}
		candidates = append(candidates, raw)
	}
	return candidates
}

func decodeNestedCandidates(payload []byte) [][]byte {
	candidates := make([][]byte, 0, 4)
	for _, key := range []string{"instance", "result", "data", "payload", "content"} {
		if nested, ok := decodeNested(payload, key); ok {
			candidates = append(candidates, nested)
		}
	}
	return candidates
}

func decodeNested(payload []byte, key string) ([]byte, bool) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil, false
	}
	raw, ok := envelope[key]
	if !ok || len(raw) == 0 {
		return nil, false
	}
	return raw, true
}
