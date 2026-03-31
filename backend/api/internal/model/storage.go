package model

// ───────── SharedStorage 文件管理相关类型 ─────────

// StorageInstanceItem 共享存储实例简要信息（来自 /shared-storage/overview）
type StorageInstanceItem struct {
	InstanceID  string  `json:"instance_id"`
	DisplayName string  `json:"display_name"`
	CapacityGB  int     `json:"capacity_gb"`
	UsedPercent float64 `json:"used_percent"`
	AccessMode  string  `json:"access_mode"`
}

// StorageInstanceListResponse 共享存储实例列表响应
type StorageInstanceListResponse struct {
	TotalGB      float64               `json:"total_gb"`
	UsedGB       float64               `json:"used_gb"`
	AvailableGB  float64               `json:"available_gb"`
	UsagePercent float64               `json:"usage_percent"`
	PackageCount int                   `json:"package_count"`
	InstanceCount int                  `json:"instance_count"`
	Instances    []StorageInstanceItem `json:"instances"`
}

// StorageOverview 存储空间概览信息
type StorageOverview struct {
	InstanceID string `json:"instance_id"`
	TotalSize  int64  `json:"total_size"`  // 总容量（字节）
	UsedSize   int64  `json:"used_size"`   // 已使用（字节）
	FileCount  int    `json:"file_count"`  // 文件数量
	FolderCount int   `json:"folder_count"` // 文件夹数量
}

// StorageFileItem 文件/文件夹条目
type StorageFileItem struct {
	Key          string `json:"key"`           // 文件路径/键名
	Name         string `json:"name"`          // 文件名
	Size         int64  `json:"size"`          // 文件大小（字节）
	IsDir        bool   `json:"is_dir"`        // 是否为目录
	ContentType  string `json:"content_type"`  // MIME 类型
	LastModified string `json:"last_modified"` // 最后修改时间
}

// StorageFileListInput 文件列表查询参数
type StorageFileListInput struct {
	Prefix   string // 路径前缀（目录路径）
	Page     int
	PageSize int
}

// ───────── 操作日志相关类型 ─────────

// OpLogEntry 单条操作日志
type OpLogEntry struct {
	ID        uint64 `json:"id"`
	OpType    string `json:"op_type"`    // 操作类型
	OpDesc    string `json:"op_desc"`    // 操作描述
	Status    string `json:"status"`     // success / failed
	Detail    string `json:"detail"`     // 附加信息 JSON
	ErrMsg    string `json:"err_msg"`    // 失败原因
	CreatedAt string `json:"created_at"` // 操作时间
}

// OpLogListResponse 操作日志列表响应
type OpLogListResponse struct {
	Total int          `json:"total"`
	Page  int          `json:"page"`
	List  []OpLogEntry `json:"list"`
}

// StorageFileListResponse 文件列表响应
type StorageFileListResponse struct {
	Total int               `json:"total"`
	List  []StorageFileItem `json:"list"`
}

// StorageCreateFolderInput 创建文件夹请求
type StorageCreateFolderInput struct {
	Path string `json:"path" binding:"required"` // 文件夹路径
}

// StorageCreateFolderResponse 创建文件夹响应
type StorageCreateFolderResponse struct {
	Path    string `json:"path"`
	Success bool   `json:"success"`
}

// StorageDeleteResponse 删除文件/文件夹响应
type StorageDeleteResponse struct {
	Key     string `json:"key"`
	Success bool   `json:"success"`
}
