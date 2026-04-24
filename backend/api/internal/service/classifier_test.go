package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDesktopClassifierByKeyword(t *testing.T) {
	path := writeTestRules(t, `{
		"desktop_keywords": ["desktop", "rk3588", "mytios"],
		"overrides": {}
	}`)

	classifier, err := NewDesktopClassifier(path)
	if err != nil {
		t.Fatalf("new classifier: %v", err)
	}

	result := classifier.Classify("id-1", "My Debian Desktop", "rk3588", "MytIOS 1.0")
	if !result.IsDesktopSystem {
		t.Fatalf("expected default desktop classification to be true")
	}
	if result.OSName == "" {
		t.Fatalf("expected os name")
	}
	if result.DesktopEnv != "" {
		t.Fatalf("expected empty desktop env without upstream field, got %q", result.DesktopEnv)
	}
}

func TestDesktopClassifierOverride(t *testing.T) {
	path := writeTestRules(t, `{
		"desktop_keywords": ["desktop"],
		"overrides": {
			"id-override": {
				"is_desktop_system": true,
				"os_name": "Debian 12",
				"desktop_env": "XFCE",
				"desktop_status": "ready"
			}
		}
	}`)

	classifier, err := NewDesktopClassifier(path)
	if err != nil {
		t.Fatalf("new classifier: %v", err)
	}

	result := classifier.Classify("id-override", "Compute Node", "server", "")
	if !result.IsDesktopSystem {
		t.Fatalf("expected override classification to be true")
	}
	if result.OSName != "Debian 12" {
		t.Fatalf("expected override os name, got %q", result.OSName)
	}
	if result.DesktopEnv != "XFCE" {
		t.Fatalf("expected override desktop env, got %q", result.DesktopEnv)
	}
	if result.DesktopStatus != "ready" {
		t.Fatalf("expected override desktop status, got %q", result.DesktopStatus)
	}
}

func writeTestRules(t *testing.T, content string) string {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "desktop_rules.json")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write rules: %v", err)
	}
	return path
}
