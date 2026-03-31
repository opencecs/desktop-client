package model

import (
	"encoding/json"
	"fmt"
	"strings"
)

func firstStringField(raw map[string]json.RawMessage, keys ...string) string {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok || len(value) == 0 {
			continue
		}
		var text string
		if err := json.Unmarshal(value, &text); err == nil && strings.TrimSpace(text) != "" {
			return text
		}
	}
	return ""
}

func firstBoolField(raw map[string]json.RawMessage, keys ...string) *bool {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok || len(value) == 0 {
			continue
		}
		var flag bool
		if err := json.Unmarshal(value, &flag); err == nil {
			return &flag
		}
	}
	return nil
}

func firstObjectField(raw map[string]json.RawMessage, keys ...string) []byte {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok || len(value) == 0 {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(string(value)), "null") {
			continue
		}
		var probe any
		if err := json.Unmarshal(value, &probe); err == nil {
			switch probe.(type) {
			case map[string]any, []any:
				return value
			}
		}
	}
	return nil
}

func firstStringOrObject(raw map[string]json.RawMessage, keys ...string) ([]byte, string) {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok || len(value) == 0 {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(string(value)), "null") {
			continue
		}
		var text string
		if err := json.Unmarshal(value, &text); err == nil && strings.TrimSpace(text) != "" {
			return nil, text
		}
		var probe any
		if err := json.Unmarshal(value, &probe); err == nil {
			switch probe.(type) {
			case map[string]any, []any:
				return value, ""
			}
		}
	}
	return nil, ""
}

func decodeRawObject(payload []byte) (map[string]json.RawMessage, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func decodeObjectInto(payload []byte, target any) bool {
	if len(payload) == 0 || strings.EqualFold(strings.TrimSpace(string(payload)), "null") {
		return false
	}
	if err := json.Unmarshal(payload, target); err == nil {
		return true
	}
	return false
}

func decodeEnvelopeDataField(raw map[string]json.RawMessage) []byte {
	if candidate := firstObjectField(raw, "data", "result", "instance", "payload", "content"); len(candidate) > 0 {
		return candidate
	}
	if value, ok := raw["data"]; ok && len(value) > 0 {
		return value
	}
	if value, ok := raw["result"]; ok && len(value) > 0 {
		return value
	}
	return nil
}

func wrapDecodeError(target string) error {
	return fmt.Errorf("unable to decode %s", target)
}
