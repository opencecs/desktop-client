package upstream

import (
    "context"

    "device-control-center/backend/api/internal/config"
    "device-control-center/backend/api/internal/model"
)

type Provider interface {
    Register(ctx context.Context, input model.RegisterInput) (model.AuthResponse, error)
    Login(ctx context.Context, input model.LoginInput) (model.AuthResponse, error)
    Refresh(ctx context.Context, token, bearer string) (model.AuthResponse, error)
    Me(ctx context.Context, bearer string) (model.MeResponse, error)
    Logout(ctx context.Context, bearer string) error
    // 用户资料编辑
    SendSmsCode(ctx context.Context, input model.SendSmsCodeInput) error
    SendEmailCode(ctx context.Context, input model.SendEmailCodeInput) error
    BindPhone(ctx context.Context, bearer string, input model.BindPhoneInput) error
    BindEmail(ctx context.Context, bearer string, input model.BindEmailInput) error
    ChangePassword(ctx context.Context, bearer string, input model.ChangePasswordInput) error
    ListInstances(ctx context.Context, bearer string, input model.ListInstancesInput) (model.InstanceListResponse, error)
    GetInstance(ctx context.Context, bearer, instanceID string) (model.InstanceDetail, error)
    GetPortMappingOverview(ctx context.Context, bearer, instanceID string) (model.PortMappingOverview, error)
    ListPortMappings(ctx context.Context, bearer, instanceID string, input model.ListPortMappingsInput) (model.PortMappingListResponse, error)
    CreatePortMapping(ctx context.Context, bearer, instanceID string, input model.CreatePortMappingInput) (model.PortMappingRule, error)
    UpdatePortMapping(ctx context.Context, bearer, instanceID, mappingID string, input model.UpdatePortMappingInput) (model.PortMappingRule, error)
    DeletePortMapping(ctx context.Context, bearer, instanceID, mappingID string) error
    BatchCreatePortMappings(ctx context.Context, bearer, instanceID string, input model.BatchCreatePortMappingsInput) (model.BatchPortMappingResponse, error)
    BatchDeletePortMappings(ctx context.Context, bearer, instanceID string, input model.BatchDeletePortMappingsInput) (model.BatchPortMappingResponse, error)
    RunAction(ctx context.Context, bearer, instanceID string, action model.InstanceAction) (model.ActionResponse, error)
    GetConsoleURL(ctx context.Context, bearer, instanceID string) (model.ConsoleURLResponse, error)
    // SharedStorage 文件管理
    GetStorageInstances(ctx context.Context, bearer string) (model.StorageInstanceListResponse, error)
    GetStorageOverview(ctx context.Context, bearer, instanceID string) (model.StorageOverview, error)
    ListStorageFiles(ctx context.Context, bearer, instanceID string, input model.StorageFileListInput) (model.StorageFileListResponse, error)
    CreateStorageFolder(ctx context.Context, bearer, instanceID string, input model.StorageCreateFolderInput) (model.StorageCreateFolderResponse, error)
    DeleteStorageFile(ctx context.Context, bearer, instanceID, key string) (model.StorageDeleteResponse, error)
    // UploadStorageFile 和 DownloadStorageFile 使用流式传输，不走 doJSON
    UploadStorageFileURL(ctx context.Context, bearer, instanceID, key string) string
    DownloadStorageFileURL(ctx context.Context, bearer, instanceID, key string) string
    // 操作日志
    GetOpLogs(ctx context.Context, bearer, instanceID string, page, pageSize int) (model.OpLogListResponse, error)
}

func NewProvider(cfg config.Config) Provider {
    return NewHTTPClient(cfg)
}
