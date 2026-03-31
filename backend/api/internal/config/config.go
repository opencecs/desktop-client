package config

import (
	"os"
	"strconv"
)

type Config struct {
	Address          string
	UpstreamBaseURL  string
	RequestTimeoutMS int
	DesktopRulesPath string
}

func Load() Config {
	return Config{
		Address:          getEnv("SERVER_ADDR", ":8080"),
		UpstreamBaseURL:  getEnv("UPSTREAM_BASE_URL", "https://www.opencecs.com/api/v1"),
		RequestTimeoutMS: getEnvInt("REQUEST_TIMEOUT_MS", 15000),
		DesktopRulesPath: getEnv("DESKTOP_RULES_PATH", "config/desktop_rules.json"),
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if value := os.Getenv(key); value != "" {
		if out, err := strconv.Atoi(value); err == nil {
			return out
		}
	}
	return fallback
}
