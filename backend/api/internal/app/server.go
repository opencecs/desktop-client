package app

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"

	"device-control-center/backend/api/internal/config"
	"device-control-center/backend/api/internal/httpapi"
	"device-control-center/backend/api/internal/observability"
	"device-control-center/backend/api/internal/service"
	"device-control-center/backend/api/internal/upstream"
)

type Server struct {
	engine *gin.Engine
	cfg    config.Config
}

func NewServer() (*Server, error) {
	cfg := config.Load()
	client := upstream.NewProvider(cfg)
	classifier, err := service.NewDesktopClassifier(cfg.DesktopRulesPath)
	if err != nil {
		return nil, err
	}
	// Keep the bootstrap log compact so local runs still show the important knobs.
	slog.Default().Info(
		"backend initialized",
		"component", "bootstrap",
		"address", cfg.Address,
		"upstream_base_url", cfg.UpstreamBaseURL,
		"desktop_rules_path", cfg.DesktopRulesPath,
	)
	consoleService := service.NewConsoleService(client, classifier)
	authService := service.NewAuthService(client)

	engine := gin.New()
	engine.Use(observability.RequestLogger(), observability.RecoveryLogger())
	engine.MaxMultipartMemory = 8 << 20

	httpapi.RegisterRoutes(engine, cfg, authService, consoleService)

	return &Server{engine: engine, cfg: cfg}, nil
}

func (s *Server) Run() error {
	srv := &httpapi.HTTPServer{
		Engine:            s.engine,
		Address:           s.cfg.Address,
		ReadHeaderTimeout: 5 * time.Second,
	}
	return srv.Run()
}
