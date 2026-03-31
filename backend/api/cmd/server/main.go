package main

import (
	"fmt"
	"os"

	"device-control-center/backend/api/internal/app"
	"device-control-center/backend/api/internal/observability"
)

func main() {
	observability.Configure("info")
	server, err := app.NewServer()
	if err != nil {
		fmt.Fprintf(os.Stderr, "bootstrap server: %v\n", err)
		os.Exit(1)
	}
	if err := server.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "run server: %v\n", err)
		os.Exit(1)
	}
}
