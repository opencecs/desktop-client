package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type HTTPServer struct {
	Engine           *gin.Engine
	Address          string
	ReadHeaderTimeout time.Duration
}

func (s *HTTPServer) Run() error {
	server := &http.Server{
		Addr:              s.Address,
		Handler:           s.Engine,
		ReadHeaderTimeout: s.ReadHeaderTimeout,
	}
	return server.ListenAndServe()
}

func shutdownServer(server *http.Server) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return server.Shutdown(ctx)
}
