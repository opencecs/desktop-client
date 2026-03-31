package model

import "encoding/json"

type LoginInput struct {
	Account    string `json:"account"`
	Password   string `json:"password"`
	RememberMe bool   `json:"remember_me"`
}

type AuthResponse struct {
	UserID     string `json:"user_id"`
	Username   string `json:"username,omitempty"`
	Phone      string `json:"phone,omitempty"`
	Email      string `json:"email,omitempty"`
	Avatar     string `json:"avatar,omitempty"`
	UserType   string `json:"user_type,omitempty"`
	IsVerified *bool  `json:"is_verified,omitempty"`
	Token      string `json:"token"`
	ExpireTime int64  `json:"expire_time"`
}

type MeResponse struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
	Phone    string `json:"phone"`
	Email    string `json:"email"`
	Avatar   string `json:"avatar"`
}

// ───────── 用户资料编辑 ─────────

// SendSmsCodeInput 发送短信验证码请求
type SendSmsCodeInput struct {
	Phone string `json:"phone" binding:"required"`
	Scene string `json:"scene" binding:"required"`
}

// SendEmailCodeInput 发送邮箱验证码请求
type SendEmailCodeInput struct {
	Email string `json:"email" binding:"required"`
	Scene string `json:"scene" binding:"required"`
}

// BindPhoneInput 绑定/换绑手机号请求
type BindPhoneInput struct {
	Phone string `json:"phone" binding:"required"`
	Code  string `json:"code" binding:"required"`
}

// BindEmailInput 绑定/换绑邮箱请求
type BindEmailInput struct {
	Email string `json:"email" binding:"required"`
	Code  string `json:"code" binding:"required"`
}

// ChangePasswordInput 修改密码请求
type ChangePasswordInput struct {
	OldPassword     string `json:"old_password"`
	NewPassword     string `json:"new_password" binding:"required"`
	ConfirmPassword string `json:"confirm_password" binding:"required"`
}

type ListInstancesInput struct {
	Page     int
	PageSize int
	Status   string
	Search   string
}

type InstanceListItem struct {
	InstanceID      string `json:"instance_id"`
	InstanceName    string `json:"instance_name"`
	BoardType       string `json:"board_type"`
	IPAddress       string `json:"ip_address"`
	Status          string `json:"status"`
	BillingMode     string `json:"billing_mode"`
	ExpireAt        string `json:"expire_at"`
	CreatedAt       string `json:"created_at"`
	ImageName       string `json:"image_name,omitempty"`
	IsDesktop       *bool  `json:"is_desktop,omitempty"`
	IsDesktopSystem bool   `json:"is_desktop_system"`
	OSName          string `json:"os_name"`
	DesktopEnv      string `json:"desktop_env"`
	DesktopStatus   string `json:"desktop_status"`
}

type InstanceListResponse struct {
	Total int                `json:"total"`
	List  []InstanceListItem `json:"list"`
	Stats map[string]int     `json:"stats"`
}

type InstanceDetail struct {
	InstanceID      string `json:"instance_id"`
	InstanceName    string `json:"instance_name"`
	IPAddress       string `json:"ip_address"`
	MACAddress      string `json:"mac_address"`
	Status          string `json:"status"`
	OrderID         string `json:"order_id"`
	RegionName      string `json:"region_name"`
	MonthlyPrice    string `json:"monthly_price"`
	ExpireAt        string `json:"expire_at"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
	BoardType       string `json:"board_type,omitempty"`
	ImageName       string `json:"image_name,omitempty"`
	IsDesktop       *bool  `json:"is_desktop,omitempty"`
	IsDesktopSystem bool   `json:"is_desktop_system"`
	OSName          string `json:"os_name"`
	DesktopEnv      string `json:"desktop_env"`
	DesktopStatus   string `json:"desktop_status"`
}

type ActionResponse struct {
	InstanceID string `json:"instance_id"`
	Status     string `json:"status"`
	Message    string `json:"message"`
}

func (r *ActionResponse) UnmarshalJSON(data []byte) error {
	if len(data) == 0 {
		return nil
	}
	if string(data) == "null" {
		return nil
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err == nil {
		r.InstanceID = firstStringField(raw, "instance_id", "instanceId", "id")
		r.Status = firstStringField(raw, "status", "state", "result")
		r.Message = firstStringField(raw, "message", "msg", "detail")

		if nested := firstObjectField(raw, "data", "result", "instance", "payload", "content"); len(nested) > 0 {
			var nestedResp ActionResponse
			if json.Unmarshal(nested, &nestedResp) == nil {
				if r.InstanceID == "" {
					r.InstanceID = nestedResp.InstanceID
				}
				if r.Status == "" {
					r.Status = nestedResp.Status
				}
				if r.Message == "" {
					r.Message = nestedResp.Message
				}
			}
		}

		if r.Status == "" && r.Message != "" {
			r.Status = "ok"
		}
		return nil
	}

	var text string
	if err := json.Unmarshal(data, &text); err == nil {
		r.Status = "ok"
		r.Message = text
		return nil
	}

	return nil
}

type ConsoleURLResponse struct {
	ConsoleURL string `json:"console_url"`
	ExpireAt   string `json:"expire_at"`
}

func (r *ConsoleURLResponse) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || string(data) == "null" {
		return nil
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err == nil {
		r.ConsoleURL = firstStringField(raw, "console_url", "consoleUrl", "url", "link")
		r.ExpireAt = firstStringField(raw, "expire_at", "expireAt", "expire_time", "expireTime")

		if nested := firstObjectField(raw, "data", "result", "instance", "payload", "content"); len(nested) > 0 {
			var nestedResp ConsoleURLResponse
			if json.Unmarshal(nested, &nestedResp) == nil {
				if r.ConsoleURL == "" {
					r.ConsoleURL = nestedResp.ConsoleURL
				}
				if r.ExpireAt == "" {
					r.ExpireAt = nestedResp.ExpireAt
				}
			}
		}
		return nil
	}

	var text string
	if err := json.Unmarshal(data, &text); err == nil {
		r.ConsoleURL = text
		return nil
	}

	return nil
}

type InstanceAction string

const (
	ActionStart  InstanceAction = "start"
	ActionStop   InstanceAction = "stop"
	ActionReboot InstanceAction = "reboot"
)

type PortMappingStats struct {
	Used        int `json:"used"`
	Quota       int `json:"quota"`
	ActiveCount int `json:"active_count"`
	FailedCount int `json:"failed_count"`
}

type PortMappingOverview struct {
	InstanceID   string           `json:"instance_id"`
	InstanceName string           `json:"instance_name"`
	PrivateIP    string           `json:"private_ip"`
	NATPublicIP  string           `json:"nat_public_ip"`
	TCP          PortMappingStats `json:"tcp"`
	UDP          PortMappingStats `json:"udp"`
}

type ListPortMappingsInput struct {
	Protocol string
	Page     int
	PageSize int
}

type CreatePortMappingInput struct {
	Protocol    string `json:"protocol"`
	PrivatePort int    `json:"private_port"`
	Remark      string `json:"remark"`
}

type UpdatePortMappingInput struct {
	PrivatePort *int   `json:"private_port,omitempty"`
	Remark      string `json:"remark,omitempty"`
}

type BatchCreatePortMappingsInput struct {
	Rules []CreatePortMappingInput `json:"rules"`
}

type BatchDeletePortMappingsInput struct {
	MappingIDs []string `json:"mapping_ids"`
}

type PortMappingRule struct {
	MappingID   string `json:"mapping_id"`
	Protocol    string `json:"protocol"`
	PublicPort  int    `json:"public_port"`
	PrivatePort int    `json:"private_port"`
	Remark      string `json:"remark"`
	ProxyStatus string `json:"proxy_status"`
	FailReason  string `json:"fail_reason"`
	CreatedAt   string `json:"created_at"`
}

type PortMappingListResponse struct {
	Total int               `json:"total"`
	List  []PortMappingRule `json:"list"`
}

type BatchPortMappingResult struct {
	Index     int             `json:"index,omitempty"`
	MappingID string          `json:"mapping_id,omitempty"`
	Success   bool            `json:"success"`
	// Data is only present for successful create/update style responses.
	Data      *PortMappingRule `json:"data,omitempty"`
	Reason    string          `json:"reason,omitempty"`
}

type BatchPortMappingResponse struct {
	Total     int                      `json:"total"`
	Succeeded int                      `json:"succeeded"`
	Failed    int                      `json:"failed"`
	Results   []BatchPortMappingResult `json:"results"`
}
