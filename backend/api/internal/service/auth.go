package service

import (
	"context"

	"device-control-center/backend/api/internal/model"
	"device-control-center/backend/api/internal/upstream"
)

type AuthService struct {
	client upstream.Provider
}

func NewAuthService(client upstream.Provider) *AuthService {
	return &AuthService{client: client}
}

func (s *AuthService) Login(ctx context.Context, input model.LoginInput) (model.AuthResponse, error) {
	return s.client.Login(ctx, input)
}

func (s *AuthService) Refresh(ctx context.Context, token, bearer string) (model.AuthResponse, error) {
	return s.client.Refresh(ctx, token, bearer)
}

func (s *AuthService) Me(ctx context.Context, bearer string) (model.MeResponse, error) {
	return s.client.Me(ctx, bearer)
}

func (s *AuthService) Logout(ctx context.Context, bearer string) error {
	return s.client.Logout(ctx, bearer)
}

// SendSmsCode 发送短信验证码
func (s *AuthService) SendSmsCode(ctx context.Context, input model.SendSmsCodeInput) error {
	return s.client.SendSmsCode(ctx, input)
}

// SendEmailCode 发送邮箱验证码
func (s *AuthService) SendEmailCode(ctx context.Context, input model.SendEmailCodeInput) error {
	return s.client.SendEmailCode(ctx, input)
}

// BindPhone 绑定/换绑手机号
func (s *AuthService) BindPhone(ctx context.Context, bearer string, input model.BindPhoneInput) error {
	return s.client.BindPhone(ctx, bearer, input)
}

// BindEmail 绑定/换绑邮箱
func (s *AuthService) BindEmail(ctx context.Context, bearer string, input model.BindEmailInput) error {
	return s.client.BindEmail(ctx, bearer, input)
}

// ChangePassword 修改密码
func (s *AuthService) ChangePassword(ctx context.Context, bearer string, input model.ChangePasswordInput) error {
	return s.client.ChangePassword(ctx, bearer, input)
}
