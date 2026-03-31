package service

import (
	"context"
	"log/slog"
	"sort"
	"strconv"
	"strings"

	"device-control-center/backend/api/internal/model"
	"device-control-center/backend/api/internal/upstream"
)

type ConsoleService struct {
	client     upstream.Provider
	classifier *DesktopClassifier
}

func NewConsoleService(client upstream.Provider, classifier *DesktopClassifier) *ConsoleService {
	return &ConsoleService{client: client, classifier: classifier}
}

func (s *ConsoleService) ListInstances(ctx context.Context, bearer string, input model.ListInstancesInput) (model.InstanceListResponse, error) {
	upstreamResp, err := s.client.ListInstances(ctx, bearer, input)
	if err != nil {
		return model.InstanceListResponse{}, err
	}

	// Filter before pagination so the visible set matches the desktop-only product rule.
	filtered := make([]model.InstanceListItem, 0, len(upstreamResp.List))
	for _, item := range upstreamResp.List {
		classification := s.classifier.Classify(item.InstanceID, item.InstanceName, item.BoardType, item.ImageName, item.IsDesktop)

		// 优先使用上游 is_desktop 字段；未提供时按 image_name 以 "Debian" 开头过滤
		if item.IsDesktop != nil {
			if !*item.IsDesktop {
				continue
			}
		} else if !strings.HasPrefix(item.ImageName, "Debian") {
			continue
		}

		if input.Status != "" && !strings.EqualFold(item.Status, input.Status) {
			continue
		}
		if input.Search != "" && !matchesSearch(item, input.Search) {
			continue
		}
		filtered = append(filtered, toListItem(item, classification))
	}

	stats := map[string]int{
		"total":   len(filtered),
		"desktop": len(filtered),
		"running": 0,
		"stopped": 0,
		"expired": 0,
	}
	for _, item := range filtered {
		stats[strings.ToLower(item.Status)]++
	}

	paginated := paginate(filtered, input.Page, input.PageSize)
	return model.InstanceListResponse{
		Total: len(filtered),
		List:  paginated,
		Stats: stats,
	}, nil
}

func (s *ConsoleService) GetInstance(ctx context.Context, bearer, instanceID string) (model.InstanceDetail, error) {
	item, err := s.client.GetInstance(ctx, bearer, instanceID)
	if err != nil {
		return model.InstanceDetail{}, err
	}
	// Keep list/detail classification consistent even when the upstream shape differs.
	classification := s.classifier.Classify(item.InstanceID, item.InstanceName, item.BoardType, item.ImageName, item.IsDesktop)
	item.IsDesktopSystem = classification.IsDesktopSystem
	item.OSName = classification.OSName
	item.DesktopEnv = classification.DesktopEnv
	item.DesktopStatus = classification.DesktopStatus
	return item, nil
}

// Port-mapping reads stay read-only in V1 so the client can inspect exposure without mutating NAT rules yet.
func (s *ConsoleService) GetPortMappingOverview(ctx context.Context, bearer, instanceID string) (model.PortMappingOverview, error) {
	return s.client.GetPortMappingOverview(ctx, bearer, instanceID)
}

func (s *ConsoleService) ListPortMappings(ctx context.Context, bearer, instanceID string, input model.ListPortMappingsInput) (model.PortMappingListResponse, error) {
	slog.Default().Info(
		"list port mappings requested",
		"component", "console",
		"instance_id", instanceID,
		"protocol", input.Protocol,
		"page", input.Page,
		"page_size", input.PageSize,
	)
	return s.client.ListPortMappings(ctx, bearer, instanceID, input)
}

// CreatePortMapping keeps the write path thin so future validation can live in one service boundary.
func (s *ConsoleService) CreatePortMapping(ctx context.Context, bearer, instanceID string, input model.CreatePortMappingInput) (model.PortMappingRule, error) {
	slog.Default().Info(
		"create port mapping requested",
		"component", "console",
		"instance_id", instanceID,
		"protocol", input.Protocol,
		"private_port", input.PrivatePort,
	)
	return s.client.CreatePortMapping(ctx, bearer, instanceID, input)
}

// UpdatePortMapping logs the rule identifier because the upstream may rotate IDs after edits.
func (s *ConsoleService) UpdatePortMapping(ctx context.Context, bearer, instanceID, mappingID string, input model.UpdatePortMappingInput) (model.PortMappingRule, error) {
	slog.Default().Info(
		"update port mapping requested",
		"component", "console",
		"instance_id", instanceID,
		"mapping_id", mappingID,
		"private_port_set", input.PrivatePort != nil,
		"remark_set", strings.TrimSpace(input.Remark) != "",
	)
	return s.client.UpdatePortMapping(ctx, bearer, instanceID, mappingID, input)
}

func (s *ConsoleService) DeletePortMapping(ctx context.Context, bearer, instanceID, mappingID string) error {
	slog.Default().Info(
		"delete port mapping requested",
		"component", "console",
		"instance_id", instanceID,
		"mapping_id", mappingID,
	)
	return s.client.DeletePortMapping(ctx, bearer, instanceID, mappingID)
}

func (s *ConsoleService) BatchCreatePortMappings(ctx context.Context, bearer, instanceID string, input model.BatchCreatePortMappingsInput) (model.BatchPortMappingResponse, error) {
	slog.Default().Info(
		"batch create port mappings requested",
		"component", "console",
		"instance_id", instanceID,
		"rule_count", len(input.Rules),
	)
	return s.client.BatchCreatePortMappings(ctx, bearer, instanceID, input)
}

func (s *ConsoleService) BatchDeletePortMappings(ctx context.Context, bearer, instanceID string, input model.BatchDeletePortMappingsInput) (model.BatchPortMappingResponse, error) {
	slog.Default().Info(
		"batch delete port mappings requested",
		"component", "console",
		"instance_id", instanceID,
		"mapping_count", len(input.MappingIDs),
	)
	return s.client.BatchDeletePortMappings(ctx, bearer, instanceID, input)
}

func (s *ConsoleService) RunAction(ctx context.Context, bearer, instanceID string, action model.InstanceAction) (model.ActionResponse, error) {
	// Action calls are worth logging because they are sparse and operationally important.
	slog.Default().Info("instance action requested", "component", "console", "instance_id", instanceID, "action", action)
	return s.client.RunAction(ctx, bearer, instanceID, action)
}

func (s *ConsoleService) GetConsoleURL(ctx context.Context, bearer, instanceID string) (model.ConsoleURLResponse, error) {
	slog.Default().Info("console url requested", "component", "console", "instance_id", instanceID)
	return s.client.GetConsoleURL(ctx, bearer, instanceID)
}

// ───────── SharedStorage 文件管理 ─────────

// GetStorageInstances 获取用户的共享存储实例列表
func (s *ConsoleService) GetStorageInstances(ctx context.Context, bearer string) (model.StorageInstanceListResponse, error) {
	slog.Default().Info("storage instances list requested", "component", "console")
	return s.client.GetStorageInstances(ctx, bearer)
}

// GetOpLogs 获取实例操作日志
func (s *ConsoleService) GetOpLogs(ctx context.Context, bearer, instanceID string, page, pageSize int) (model.OpLogListResponse, error) {
	slog.Default().Info("op logs requested", "component", "console", "instance_id", instanceID, "page", page)
	return s.client.GetOpLogs(ctx, bearer, instanceID, page, pageSize)
}

// GetStorageOverview 获取实例存储空间概览
func (s *ConsoleService) GetStorageOverview(ctx context.Context, bearer, instanceID string) (model.StorageOverview, error) {
	slog.Default().Info("storage overview requested", "component", "console", "instance_id", instanceID)
	return s.client.GetStorageOverview(ctx, bearer, instanceID)
}

// ListStorageFiles 列出存储空间中的文件和文件夹
func (s *ConsoleService) ListStorageFiles(ctx context.Context, bearer, instanceID string, input model.StorageFileListInput) (model.StorageFileListResponse, error) {
	slog.Default().Info("storage file list requested", "component", "console", "instance_id", instanceID, "prefix", input.Prefix)
	return s.client.ListStorageFiles(ctx, bearer, instanceID, input)
}

// CreateStorageFolder 在存储空间中创建文件夹
func (s *ConsoleService) CreateStorageFolder(ctx context.Context, bearer, instanceID string, input model.StorageCreateFolderInput) (model.StorageCreateFolderResponse, error) {
	slog.Default().Info("storage folder create requested", "component", "console", "instance_id", instanceID, "path", input.Path)
	return s.client.CreateStorageFolder(ctx, bearer, instanceID, input)
}

// DeleteStorageFile 删除存储空间中的文件或文件夹
func (s *ConsoleService) DeleteStorageFile(ctx context.Context, bearer, instanceID, key string) (model.StorageDeleteResponse, error) {
	slog.Default().Info("storage file delete requested", "component", "console", "instance_id", instanceID, "key", key)
	return s.client.DeleteStorageFile(ctx, bearer, instanceID, key)
}

// GetUploadURL 获取上游文件上传地址
func (s *ConsoleService) GetUploadURL(ctx context.Context, bearer, instanceID, key string) string {
	return s.client.UploadStorageFileURL(ctx, bearer, instanceID, key)
}

// GetDownloadURL 获取上游文件下载地址
func (s *ConsoleService) GetDownloadURL(ctx context.Context, bearer, instanceID, key string) string {
	return s.client.DownloadStorageFileURL(ctx, bearer, instanceID, key)
}

func matchesSearch(item model.InstanceListItem, keyword string) bool {
	searchable := strings.ToLower(strings.Join([]string{
		item.InstanceID,
		item.InstanceName,
		item.BoardType,
		item.IPAddress,
		item.ImageName,
	}, " "))
	return strings.Contains(searchable, strings.ToLower(strings.TrimSpace(keyword)))
}

func toListItem(item model.InstanceListItem, classification DesktopClassification) model.InstanceListItem {
	return model.InstanceListItem{
		InstanceID:      item.InstanceID,
		InstanceName:    item.InstanceName,
		BoardType:       item.BoardType,
		IPAddress:       item.IPAddress,
		Status:          item.Status,
		BillingMode:     item.BillingMode,
		ExpireAt:        item.ExpireAt,
		CreatedAt:       item.CreatedAt,
		ImageName:       item.ImageName,
		IsDesktop:       item.IsDesktop,
		IsDesktopSystem: classification.IsDesktopSystem,
		OSName:          classification.OSName,
		DesktopEnv:      classification.DesktopEnv,
		DesktopStatus:   classification.DesktopStatus,
	}
}

func paginate(items []model.InstanceListItem, page, pageSize int) []model.InstanceListItem {
	if pageSize <= 0 {
		pageSize = 10
	}
	if page <= 0 {
		page = 1
	}
	start := (page - 1) * pageSize
	if start >= len(items) {
		return []model.InstanceListItem{}
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	out := make([]model.InstanceListItem, end-start)
	copy(out, items[start:end])
	return out
}

func SortStats(stats map[string]int) []string {
	keys := make([]string, 0, len(stats))
	for key := range stats {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func parseIntOrDefault(value string, fallback int) int {
	if value == "" {
		return fallback
	}
	out, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return out
}
