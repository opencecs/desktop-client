package httpapi

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"device-control-center/backend/api/internal/model"
	"device-control-center/backend/api/internal/observability"
	"device-control-center/backend/api/internal/service"
)

type loginRequest struct {
	Account    string `json:"account"`
	Username   string `json:"username"`
	Password   string `json:"password" binding:"required"`
	RememberMe bool   `json:"remember_me"`
}

type refreshRequest struct {
	Token string `json:"token"`
}

type createPortMappingRequest struct {
	Protocol    string `json:"protocol" binding:"required"`
	PrivatePort int    `json:"private_port" binding:"required"`
	Remark      string `json:"remark"`
}

type updatePortMappingRequest struct {
	PrivatePort *int   `json:"private_port,omitempty"`
	Remark      string `json:"remark,omitempty"`
}

type batchCreatePortMappingsRequest struct {
	Rules []createPortMappingRequest `json:"rules" binding:"required"`
}

type batchDeletePortMappingsRequest struct {
	MappingIDs []string `json:"mapping_ids" binding:"required"`
}

type registerRequest struct {
	Phone string `json:"phone" binding:"required"`
	Code  string `json:"code" binding:"required"`
}

func registerHandler(c *gin.Context, auth *service.AuthService) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	resp, err := auth.Register(c.Request.Context(), model.RegisterInput{
		Phone: req.Phone,
		Code:  req.Code,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func loginHandler(c *gin.Context, auth *service.AuthService) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	// Accept either field name so the desktop client can stay compatible with upstream variations.
	account := req.Account
	if account == "" {
		account = req.Username
	}
	if account == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "account or username is required"})
		return
	}
	resp, err := auth.Login(c.Request.Context(), model.LoginInput{
		Account:    account,
		Password:   req.Password,
		RememberMe: req.RememberMe,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func refreshHandler(c *gin.Context, auth *service.AuthService) {
	var req refreshRequest
	_ = c.ShouldBindJSON(&req)
	resp, err := auth.Refresh(c.Request.Context(), req.Token, extractBearer(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func meHandler(c *gin.Context, auth *service.AuthService) {
	resp, err := auth.Me(c.Request.Context(), extractBearer(c))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func logoutHandler(c *gin.Context, auth *service.AuthService) {
	if err := auth.Logout(c.Request.Context(), extractBearer(c)); err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// sendSmsCodeHandler 发送短信验证码
func sendSmsCodeHandler(c *gin.Context, auth *service.AuthService) {
	var req model.SendSmsCodeInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	if err := auth.SendSmsCode(c.Request.Context(), req); err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// sendEmailCodeHandler 发送邮箱验证码
func sendEmailCodeHandler(c *gin.Context, auth *service.AuthService) {
	var req model.SendEmailCodeInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	if err := auth.SendEmailCode(c.Request.Context(), req); err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// bindPhoneHandler 绑定/换绑手机号
func bindPhoneHandler(c *gin.Context, auth *service.AuthService) {
	var req model.BindPhoneInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	if err := auth.BindPhone(c.Request.Context(), extractBearer(c), req); err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// bindEmailHandler 绑定/换绑邮箱
func bindEmailHandler(c *gin.Context, auth *service.AuthService) {
	var req model.BindEmailInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	if err := auth.BindEmail(c.Request.Context(), extractBearer(c), req); err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// changePasswordHandler 修改密码
func changePasswordHandler(c *gin.Context, auth *service.AuthService) {
	var req model.ChangePasswordInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	if err := auth.ChangePassword(c.Request.Context(), extractBearer(c), req); err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func listInstancesHandler(c *gin.Context, console *service.ConsoleService) {
	page := parseQueryInt(c.Query("page"), 1)
	pageSize := parseQueryInt(c.Query("page_size"), 10)
	resp, err := console.ListInstances(c.Request.Context(), extractBearer(c), model.ListInstancesInput{
		Page:     page,
		PageSize: pageSize,
		Status:   c.Query("status"),
		Search:   c.Query("search"),
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func getInstanceHandler(c *gin.Context, console *service.ConsoleService) {
	resp, err := console.GetInstance(c.Request.Context(), extractBearer(c), c.Param("id"))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func portMappingOverviewHandler(c *gin.Context, console *service.ConsoleService) {
	resp, err := console.GetPortMappingOverview(c.Request.Context(), extractBearer(c), c.Param("id"))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func listPortMappingsHandler(c *gin.Context, console *service.ConsoleService) {
	resp, err := console.ListPortMappings(c.Request.Context(), extractBearer(c), c.Param("id"), model.ListPortMappingsInput{
		Protocol: c.Query("protocol"),
		Page:     parseQueryInt(c.Query("page"), 1),
		PageSize: parseQueryInt(c.Query("page_size"), 10),
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func createPortMappingHandler(c *gin.Context, console *service.ConsoleService) {
	var req createPortMappingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	resp, err := console.CreatePortMapping(c.Request.Context(), extractBearer(c), c.Param("id"), model.CreatePortMappingInput{
		Protocol:    req.Protocol,
		PrivatePort: req.PrivatePort,
		Remark:      req.Remark,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func updatePortMappingHandler(c *gin.Context, console *service.ConsoleService) {
	var req updatePortMappingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	resp, err := console.UpdatePortMapping(c.Request.Context(), extractBearer(c), c.Param("id"), c.Param("mapping_id"), model.UpdatePortMappingInput{
		PrivatePort: req.PrivatePort,
		Remark:      req.Remark,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func deletePortMappingHandler(c *gin.Context, console *service.ConsoleService) {
	if err := console.DeletePortMapping(c.Request.Context(), extractBearer(c), c.Param("id"), c.Param("mapping_id")); err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func batchCreatePortMappingsHandler(c *gin.Context, console *service.ConsoleService) {
	var req batchCreatePortMappingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	rules := make([]model.CreatePortMappingInput, 0, len(req.Rules))
	for _, rule := range req.Rules {
		rules = append(rules, model.CreatePortMappingInput{
			Protocol:    rule.Protocol,
			PrivatePort: rule.PrivatePort,
			Remark:      rule.Remark,
		})
	}

	resp, err := console.BatchCreatePortMappings(c.Request.Context(), extractBearer(c), c.Param("id"), model.BatchCreatePortMappingsInput{
		Rules: rules,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func batchDeletePortMappingsHandler(c *gin.Context, console *service.ConsoleService) {
	var req batchDeletePortMappingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	resp, err := console.BatchDeletePortMappings(c.Request.Context(), extractBearer(c), c.Param("id"), model.BatchDeletePortMappingsInput{
		MappingIDs: req.MappingIDs,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func actionHandler(c *gin.Context, console *service.ConsoleService, action model.InstanceAction) {
	resp, err := console.RunAction(c.Request.Context(), extractBearer(c), c.Param("id"), action)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func consoleURLHandler(c *gin.Context, console *service.ConsoleService) {
	resp, err := console.GetConsoleURL(c.Request.Context(), extractBearer(c), c.Param("id"))
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

func writeServiceError(c *gin.Context, err error) {
	if !strings.HasPrefix(strings.ToLower(err.Error()), "upstream ") && !observability.IsExpectedError(err) {
		slog.Default().Warn(
			"request failed",
			"component", "httpapi",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", mapServiceErrorStatus(err),
			"err", err,
		)
	}
	status := mapServiceErrorStatus(err)
	c.JSON(status, gin.H{"message": err.Error()})
}

func mapServiceErrorStatus(err error) int {
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	switch {
	case strings.Contains(message, "token"), strings.Contains(message, "登录"), strings.Contains(message, "认证"), strings.Contains(message, "unauthorized"):
		return http.StatusUnauthorized
	case strings.Contains(message, "password"), strings.Contains(message, "账号"), strings.Contains(message, "credential"):
		return http.StatusUnauthorized
	case strings.Contains(message, "not found"), strings.Contains(message, "不存在"):
		return http.StatusNotFound
	case strings.Contains(message, "invalid"), strings.Contains(message, "参数"), strings.Contains(message, "bad request"):
		return http.StatusBadRequest
	}

	// 上游 HTTP 错误保留原始状态码（如 status=500 → 502, status=503 → 502）
	// 上游业务错误（JSON code != 200）映射为 422 而非 502，避免前端误判为网关故障
	if strings.Contains(message, "upstream") && strings.Contains(message, "status=") {
		return http.StatusBadGateway
	}
	return http.StatusUnprocessableEntity
}

func extractBearer(c *gin.Context) string {
	// The upstream expects the Authorization header to be forwarded as-is.
	return c.GetHeader("Authorization")
}

func parseQueryInt(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
