package service

import (
	"encoding/json"
	"log/slog"
	"os"
	"strings"
)

type desktopRules struct {
	DesktopKeywords []string                       `json:"desktop_keywords"`
	Overrides       map[string]desktopRuleOverride `json:"overrides"`
}

type desktopRuleOverride struct {
	IsDesktopSystem bool   `json:"is_desktop_system"`
	OSName          string `json:"os_name"`
	DesktopEnv      string `json:"desktop_env"`
	DesktopStatus   string `json:"desktop_status"`
}

type DesktopClassification struct {
	IsDesktopSystem bool
	OSName          string
	DesktopEnv      string
	DesktopStatus   string
}

type DesktopClassifier struct {
	rules desktopRules
}

func NewDesktopClassifier(path string) (*DesktopClassifier, error) {
	rules := desktopRules{
		DesktopKeywords: []string{
			"desktop",
			"debian desktop",
			"ubuntu desktop",
			"mytios",
			"xfce",
			"gnome",
			"kde",
			"mate",
			"cinnamon",
			"rk3588",
			"rk3588s",
		},
		Overrides: map[string]desktopRuleOverride{},
	}

	data, err := os.ReadFile(path)
	if err == nil {
		if unmarshalErr := json.Unmarshal(data, &rules); unmarshalErr != nil {
			return nil, unmarshalErr
		}
	}

	slog.Default().Info(
		"desktop rules loaded",
		"component", "classifier",
		"keywords", len(rules.DesktopKeywords),
		"overrides", len(rules.Overrides),
		"rules_path", path,
	)

	return &DesktopClassifier{rules: rules}, nil
}

func (c *DesktopClassifier) Classify(instanceID, instanceName, boardType, imageName string, isDesktop *bool) DesktopClassification {
	if override, ok := c.rules.Overrides[instanceID]; ok {
		// Instance overrides win so operators can correct one-off data issues.
		return DesktopClassification{
			IsDesktopSystem: override.IsDesktopSystem,
			OSName:          fallbackString(override.OSName, inferOSName(imageName, boardType)),
			DesktopEnv:      strings.TrimSpace(override.DesktopEnv),
			DesktopStatus:   strings.TrimSpace(override.DesktopStatus),
		}
	}

	// Trust the upstream flag when present; otherwise keep the instance visible by default.
	matched := true
	if isDesktop != nil {
		matched = *isDesktop
	}
	return DesktopClassification{
		IsDesktopSystem: matched,
		OSName:          inferOSName(imageName, boardType),
		DesktopEnv:      "",
		DesktopStatus:   "",
	}
}

func inferOSName(imageName, boardType string) string {
	value := strings.TrimSpace(imageName)
	if value == "" {
		value = strings.TrimSpace(boardType)
	}
	if value == "" {
		return "Unknown"
	}
	return value
}

func fallbackString(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}
