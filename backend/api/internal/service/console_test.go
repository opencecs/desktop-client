package service

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"device-control-center/backend/api/internal/model"
)

func boolPtr(value bool) *bool {
	return &value
}

func TestConsoleServiceFiltersDesktopInstances(t *testing.T) {
	classifier := mustClassifier(t, `{
		"desktop_keywords": ["desktop", "rk3588", "mytios", "xfce"],
		"overrides": {}
	}`)
	svc := NewConsoleService(&stubProvider{
		list: model.InstanceListResponse{
			List: []model.InstanceListItem{
				{
					InstanceID:   "desktop-1",
					InstanceName: "Debian Desktop XFCE",
					BoardType:    "rk3588",
					IPAddress:    "10.0.0.1",
					Status:       "running",
					ImageName:    "MytIOS 1.0",
				},
				{
					InstanceID:   "server-1",
					InstanceName: "Compute Node",
					BoardType:    "x86_64",
					IPAddress:    "10.0.0.2",
					Status:       "running",
					ImageName:    "Ubuntu Server 22.04",
					IsDesktop:    boolPtr(false),
				},
				{
					InstanceID:   "desktop-2",
					InstanceName: "Debian Desktop GNOME",
					BoardType:    "rk3588s",
					IPAddress:    "10.0.0.3",
					Status:       "stopped",
					ImageName:    "Debian 12 GNOME",
				},
			},
		},
	}, classifier)

	resp, err := svc.ListInstances(context.Background(), "Bearer test", model.ListInstancesInput{Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("list instances: %v", err)
	}
	if resp.Total != 2 {
		t.Fatalf("expected 2 visible desktop instances, got %d", resp.Total)
	}
	if len(resp.List) != 2 {
		t.Fatalf("expected 2 visible instances, got %d", len(resp.List))
	}
	if !resp.List[0].IsDesktopSystem || !resp.List[1].IsDesktopSystem {
		t.Fatalf("expected desktop flags to be true")
	}
	if resp.Stats["running"] != 1 || resp.Stats["stopped"] != 1 {
		t.Fatalf("unexpected stats: %#v", resp.Stats)
	}
	if resp.Stats["desktop"] != 2 || resp.Stats["total"] != 2 {
		t.Fatalf("unexpected desktop totals: %#v", resp.Stats)
	}
}

func TestConsoleServiceSearchAndPagination(t *testing.T) {
	classifier := mustClassifier(t, `{
		"desktop_keywords": ["desktop", "rk3588", "mytios", "xfce"],
		"overrides": {}
	}`)
	svc := NewConsoleService(&stubProvider{
		list: model.InstanceListResponse{
			List: []model.InstanceListItem{
				{
					InstanceID:   "desktop-1",
					InstanceName: "Debian Desktop XFCE",
					BoardType:    "rk3588",
					IPAddress:    "10.0.0.1",
					Status:       "running",
					ImageName:    "MytIOS 1.0",
				},
				{
					InstanceID:   "desktop-2",
					InstanceName: "Debian Desktop GNOME",
					BoardType:    "rk3588s",
					IPAddress:    "10.0.0.3",
					Status:       "stopped",
					ImageName:    "Debian 12 GNOME",
				},
			},
		},
	}, classifier)

	resp, err := svc.ListInstances(context.Background(), "Bearer test", model.ListInstancesInput{Page: 2, PageSize: 1, Search: "gnome"})
	if err != nil {
		t.Fatalf("list instances: %v", err)
	}
	if resp.Total != 1 {
		t.Fatalf("expected 1 matching instance, got %d", resp.Total)
	}
	if len(resp.List) != 0 {
		t.Fatalf("expected empty page 2 result, got %d", len(resp.List))
	}
}

func TestConsoleServicePortMappingDelegates(t *testing.T) {
	classifier := mustClassifier(t, `{"desktop_keywords":["desktop"],"overrides":{}}`)
	stub := &stubProvider{
		createRule: model.PortMappingRule{
			MappingID:   "pm-new",
			Protocol:    "TCP",
			PublicPort:  40223,
			PrivatePort: 22,
			Remark:      "SSH",
			ProxyStatus: "ok",
		},
		updateRule: model.PortMappingRule{
			MappingID:   "pm-updated",
			Protocol:    "TCP",
			PublicPort:  40223,
			PrivatePort: 8080,
			Remark:      "HTTP",
			ProxyStatus: "ok",
		},
		batchCreateResp: model.BatchPortMappingResponse{
			Total:     1,
			Succeeded: 1,
			Failed:    0,
			Results: []model.BatchPortMappingResult{
				{
					Index:     0,
					MappingID: "pm-new",
					Success:   true,
					Data: &model.PortMappingRule{
						MappingID:   "pm-new",
						Protocol:    "TCP",
						PublicPort:  40223,
						PrivatePort: 22,
						Remark:      "SSH",
						ProxyStatus: "ok",
					},
				},
			},
		},
		batchDeleteResp: model.BatchPortMappingResponse{
			Total:     2,
			Succeeded: 1,
			Failed:    1,
			Results: []model.BatchPortMappingResult{
				{MappingID: "pm-old", Success: true},
				{MappingID: "pm-missing", Success: false, Reason: "not found"},
			},
		},
	}
	svc := NewConsoleService(stub, classifier)

	if _, err := svc.CreatePortMapping(context.Background(), "Bearer test", "ins-1", model.CreatePortMappingInput{Protocol: "tcp", PrivatePort: 22, Remark: "SSH"}); err != nil {
		t.Fatalf("create port mapping: %v", err)
	}
	if stub.createInstanceID != "ins-1" || stub.createInput.PrivatePort != 22 || stub.createInput.Protocol != "tcp" {
		t.Fatalf("unexpected create delegation: %#v %#v", stub.createInstanceID, stub.createInput)
	}

	privatePort := 8080
	if _, err := svc.UpdatePortMapping(context.Background(), "Bearer test", "ins-1", "pm-001", model.UpdatePortMappingInput{PrivatePort: &privatePort, Remark: "HTTP"}); err != nil {
		t.Fatalf("update port mapping: %v", err)
	}
	if stub.updateInstanceID != "ins-1" || stub.updateMappingID != "pm-001" || stub.updateInput.PrivatePort == nil || *stub.updateInput.PrivatePort != 8080 {
		t.Fatalf("unexpected update delegation: %#v %#v %#v", stub.updateInstanceID, stub.updateMappingID, stub.updateInput)
	}

	if err := svc.DeletePortMapping(context.Background(), "Bearer test", "ins-1", "pm-001"); err != nil {
		t.Fatalf("delete port mapping: %v", err)
	}
	if stub.deleteInstanceID != "ins-1" || stub.deleteMappingID != "pm-001" {
		t.Fatalf("unexpected delete delegation: %#v %#v", stub.deleteInstanceID, stub.deleteMappingID)
	}

	if _, err := svc.BatchCreatePortMappings(context.Background(), "Bearer test", "ins-1", model.BatchCreatePortMappingsInput{Rules: []model.CreatePortMappingInput{{Protocol: "UDP", PrivatePort: 51820, Remark: "WG"}}}); err != nil {
		t.Fatalf("batch create port mappings: %v", err)
	}
	if len(stub.batchCreateInput.Rules) != 1 || stub.batchCreateInput.Rules[0].Protocol != "UDP" {
		t.Fatalf("unexpected batch create delegation: %#v", stub.batchCreateInput)
	}

	if _, err := svc.BatchDeletePortMappings(context.Background(), "Bearer test", "ins-1", model.BatchDeletePortMappingsInput{MappingIDs: []string{"pm-old", "pm-missing"}}); err != nil {
		t.Fatalf("batch delete port mappings: %v", err)
	}
	if len(stub.batchDeleteInput.MappingIDs) != 2 {
		t.Fatalf("unexpected batch delete delegation: %#v", stub.batchDeleteInput)
	}
}

type stubProvider struct {
	list            model.InstanceListResponse
	createRule      model.PortMappingRule
	updateRule      model.PortMappingRule
	batchCreateResp model.BatchPortMappingResponse
	batchDeleteResp model.BatchPortMappingResponse

	createInstanceID string
	createInput      model.CreatePortMappingInput
	updateInstanceID string
	updateMappingID  string
	updateInput      model.UpdatePortMappingInput
	deleteInstanceID string
	deleteMappingID  string
	batchCreateInput model.BatchCreatePortMappingsInput
	batchDeleteInput model.BatchDeletePortMappingsInput
}

func (s *stubProvider) Login(ctx context.Context, input model.LoginInput) (model.AuthResponse, error) {
	return model.AuthResponse{}, nil
}

func (s *stubProvider) Refresh(ctx context.Context, token, bearer string) (model.AuthResponse, error) {
	return model.AuthResponse{}, nil
}

func (s *stubProvider) Me(ctx context.Context, bearer string) (model.MeResponse, error) {
	return model.MeResponse{}, nil
}

func (s *stubProvider) Logout(ctx context.Context, bearer string) error {
	return nil
}

func (s *stubProvider) ListInstances(ctx context.Context, bearer string, input model.ListInstancesInput) (model.InstanceListResponse, error) {
	return s.list, nil
}

func (s *stubProvider) GetInstance(ctx context.Context, bearer, instanceID string) (model.InstanceDetail, error) {
	return model.InstanceDetail{}, nil
}

func (s *stubProvider) GetPortMappingOverview(ctx context.Context, bearer, instanceID string) (model.PortMappingOverview, error) {
	return model.PortMappingOverview{}, nil
}

func (s *stubProvider) ListPortMappings(ctx context.Context, bearer, instanceID string, input model.ListPortMappingsInput) (model.PortMappingListResponse, error) {
	return model.PortMappingListResponse{}, nil
}

func (s *stubProvider) CreatePortMapping(ctx context.Context, bearer, instanceID string, input model.CreatePortMappingInput) (model.PortMappingRule, error) {
	s.createInstanceID = instanceID
	s.createInput = input
	return s.createRule, nil
}

func (s *stubProvider) UpdatePortMapping(ctx context.Context, bearer, instanceID, mappingID string, input model.UpdatePortMappingInput) (model.PortMappingRule, error) {
	s.updateInstanceID = instanceID
	s.updateMappingID = mappingID
	s.updateInput = input
	return s.updateRule, nil
}

func (s *stubProvider) DeletePortMapping(ctx context.Context, bearer, instanceID, mappingID string) error {
	s.deleteInstanceID = instanceID
	s.deleteMappingID = mappingID
	return nil
}

func (s *stubProvider) BatchCreatePortMappings(ctx context.Context, bearer, instanceID string, input model.BatchCreatePortMappingsInput) (model.BatchPortMappingResponse, error) {
	s.batchCreateInput = input
	return s.batchCreateResp, nil
}

func (s *stubProvider) BatchDeletePortMappings(ctx context.Context, bearer, instanceID string, input model.BatchDeletePortMappingsInput) (model.BatchPortMappingResponse, error) {
	s.batchDeleteInput = input
	return s.batchDeleteResp, nil
}

func (s *stubProvider) RunAction(ctx context.Context, bearer, instanceID string, action model.InstanceAction) (model.ActionResponse, error) {
	return model.ActionResponse{}, nil
}

func (s *stubProvider) GetConsoleURL(ctx context.Context, bearer, instanceID string) (model.ConsoleURLResponse, error) {
	return model.ConsoleURLResponse{}, nil
}

func (s *stubProvider) SendSmsCode(ctx context.Context, input model.SendSmsCodeInput) error {
	return nil
}

func (s *stubProvider) SendEmailCode(ctx context.Context, input model.SendEmailCodeInput) error {
	return nil
}

func (s *stubProvider) BindPhone(ctx context.Context, bearer string, input model.BindPhoneInput) error {
	return nil
}

func (s *stubProvider) BindEmail(ctx context.Context, bearer string, input model.BindEmailInput) error {
	return nil
}

func (s *stubProvider) ChangePassword(ctx context.Context, bearer string, input model.ChangePasswordInput) error {
	return nil
}

func (s *stubProvider) GetStorageOverview(ctx context.Context, bearer, instanceID string) (model.StorageOverview, error) {
	return model.StorageOverview{}, nil
}

func (s *stubProvider) ListStorageFiles(ctx context.Context, bearer, instanceID string, input model.StorageFileListInput) (model.StorageFileListResponse, error) {
	return model.StorageFileListResponse{}, nil
}

func (s *stubProvider) CreateStorageFolder(ctx context.Context, bearer, instanceID string, input model.StorageCreateFolderInput) (model.StorageCreateFolderResponse, error) {
	return model.StorageCreateFolderResponse{}, nil
}

func (s *stubProvider) DeleteStorageFile(ctx context.Context, bearer, instanceID, key string) (model.StorageDeleteResponse, error) {
	return model.StorageDeleteResponse{}, nil
}

func (s *stubProvider) UploadStorageFileURL(ctx context.Context, bearer, instanceID, key string) string {
	return ""
}

func (s *stubProvider) DownloadStorageFileURL(ctx context.Context, bearer, instanceID, key string) string {
	return ""
}

func mustClassifier(t *testing.T, content string) *DesktopClassifier {
	t.Helper()
	path := filepath.Join(t.TempDir(), "desktop_rules.json")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write rules: %v", err)
	}
	classifier, err := NewDesktopClassifier(path)
	if err != nil {
		t.Fatalf("new classifier: %v", err)
	}
	return classifier
}

func intPtr(value int) *int {
	return &value
}
