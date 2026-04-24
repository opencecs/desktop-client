package upstream

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"device-control-center/backend/api/internal/config"
	"device-control-center/backend/api/internal/model"
)

func TestHTTPClientListInstancesIncludesSearchQuery(t *testing.T) {
	t.Parallel()

	var seenPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.String()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(model.InstanceListResponse{
			List:  []model.InstanceListItem{},
			Stats: map[string]int{},
		})
	}))
	defer server.Close()

	client := &HTTPClient{
		baseURL: server.URL,
		http:    server.Client(),
	}

	_, err := client.ListInstances(context.Background(), "Bearer test", model.ListInstancesInput{
		Page:     2,
		PageSize: 20,
		Status:   "running",
		Search:   "desktop",
	})
	if err != nil {
		t.Fatalf("list instances: %v", err)
	}

	if seenPath != "/cecs/instances?page=2&page_size=20&search=desktop&status=running" &&
		seenPath != "/cecs/instances?page=2&page_size=20&status=running&search=desktop" {
		t.Fatalf("unexpected upstream path: %s", seenPath)
	}
}

func TestHTTPClientListPortMappingsIncludesQuery(t *testing.T) {
	t.Parallel()

	var seenPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.String()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(model.PortMappingListResponse{
			List: []model.PortMappingRule{},
		})
	}))
	defer server.Close()

	client := &HTTPClient{
		baseURL: server.URL,
		http:    server.Client(),
	}

	_, err := client.ListPortMappings(context.Background(), "Bearer test", "ins-1", model.ListPortMappingsInput{
		Protocol: "TCP",
		Page:     1,
		PageSize: 20,
	})
	if err != nil {
		t.Fatalf("list port mappings: %v", err)
	}

	if seenPath != "/cecs/instances/ins-1/port-mappings?page=1&page_size=20&protocol=TCP" &&
		seenPath != "/cecs/instances/ins-1/port-mappings?protocol=TCP&page=1&page_size=20" &&
		seenPath != "/cecs/instances/ins-1/port-mappings?page=1&protocol=TCP&page_size=20" {
		t.Fatalf("unexpected upstream path: %s", seenPath)
	}
}

func TestHTTPClientPortMappingCrudAndBatchRequests(t *testing.T) {
	t.Parallel()

	type testCase struct {
		name         string
		method       string
		path         string
		bodyContains []string
		responseJSON string
		execute      func(t *testing.T, client *HTTPClient)
	}

	cases := []testCase{
		{
			name:         "create",
			method:       http.MethodPost,
			path:         "/cecs/instances/ins-1/port-mappings",
			bodyContains: []string{`"protocol":"TCP"`, `"private_port":22`, `"remark":"SSH"`},
			responseJSON: `{"mapping_id":"pm-9","protocol":"TCP","public_port":40022,"private_port":22,"remark":"SSH","proxy_status":"ok"}`,
			execute: func(t *testing.T, client *HTTPClient) {
				_, err := client.CreatePortMapping(context.Background(), "Bearer test", "ins-1", model.CreatePortMappingInput{
					Protocol:    "TCP",
					PrivatePort: 22,
					Remark:      "SSH",
				})
				if err != nil {
					t.Fatalf("create port mapping: %v", err)
				}
			},
		},
		{
			name:         "update",
			method:       http.MethodPatch,
			path:         "/cecs/instances/ins-1/port-mappings/pm-1",
			bodyContains: []string{`"private_port":2222`, `"remark":"SSH2"`},
			responseJSON: `{"mapping_id":"pm-1","protocol":"TCP","public_port":40222,"private_port":2222,"remark":"SSH2","proxy_status":"ok"}`,
			execute: func(t *testing.T, client *HTTPClient) {
				nextPort := 2222
				_, err := client.UpdatePortMapping(context.Background(), "Bearer test", "ins-1", "pm-1", model.UpdatePortMappingInput{
					PrivatePort: &nextPort,
					Remark:      "SSH2",
				})
				if err != nil {
					t.Fatalf("update port mapping: %v", err)
				}
			},
		},
		{
			name:         "delete",
			method:       http.MethodDelete,
			path:         "/cecs/instances/ins-1/port-mappings/pm-1",
			responseJSON: `{"code":200,"message":"success","data":null}`,
			execute: func(t *testing.T, client *HTTPClient) {
				if err := client.DeletePortMapping(context.Background(), "Bearer test", "ins-1", "pm-1"); err != nil {
					t.Fatalf("delete port mapping: %v", err)
				}
			},
		},
		{
			name:         "batch-create",
			method:       http.MethodPost,
			path:         "/cecs/instances/ins-1/port-mappings/batch",
			bodyContains: []string{`"rules"`, `"protocol":"TCP"`, `"protocol":"UDP"`},
			responseJSON: `{"total":2,"succeeded":2,"failed":0,"results":[{"index":0,"success":true,"mapping_id":"pm-10"},{"index":1,"success":true,"mapping_id":"pm-11"}]}`,
			execute: func(t *testing.T, client *HTTPClient) {
				_, err := client.BatchCreatePortMappings(context.Background(), "Bearer test", "ins-1", model.BatchCreatePortMappingsInput{
					Rules: []model.CreatePortMappingInput{
						{Protocol: "TCP", PrivatePort: 80, Remark: "HTTP"},
						{Protocol: "UDP", PrivatePort: 53, Remark: "DNS"},
					},
				})
				if err != nil {
					t.Fatalf("batch create port mappings: %v", err)
				}
			},
		},
		{
			name:         "batch-delete",
			method:       http.MethodDelete,
			path:         "/cecs/instances/ins-1/port-mappings/batch",
			bodyContains: []string{`"mapping_ids":["pm-10","pm-11"]`},
			responseJSON: `{"total":2,"succeeded":2,"failed":0,"results":[{"mapping_id":"pm-10","success":true},{"mapping_id":"pm-11","success":true}]}`,
			execute: func(t *testing.T, client *HTTPClient) {
				_, err := client.BatchDeletePortMappings(context.Background(), "Bearer test", "ins-1", model.BatchDeletePortMappingsInput{
					MappingIDs: []string{"pm-10", "pm-11"},
				})
				if err != nil {
					t.Fatalf("batch delete port mappings: %v", err)
				}
			},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			var seenMethod string
			var seenPath string
			var seenBody string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				seenMethod = r.Method
				seenPath = r.URL.String()
				payload, _ := io.ReadAll(r.Body)
				seenBody = string(payload)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.responseJSON))
			}))
			defer server.Close()

			client := &HTTPClient{
				baseURL: server.URL,
				http:    server.Client(),
			}

			tc.execute(t, client)

			if seenMethod != tc.method {
				t.Fatalf("unexpected method: %s", seenMethod)
			}
			if seenPath != tc.path {
				t.Fatalf("unexpected path: %s", seenPath)
			}
			for _, want := range tc.bodyContains {
				if !strings.Contains(seenBody, want) {
					t.Fatalf("request body missing %q: %s", want, seenBody)
				}
			}
		})
	}
}

func TestHTTPClientPortMappingMutationsUseExpectedVerbAndPath(t *testing.T) {
	t.Parallel()

	type recorded struct {
		method string
		path   string
		body   string
	}

	var calls []recorded
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		payload, _ := io.ReadAll(r.Body)
		calls = append(calls, recorded{method: r.Method, path: r.URL.String(), body: strings.TrimSpace(string(payload))})
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodPost:
			if strings.Contains(r.URL.Path, "/batch") {
				_ = json.NewEncoder(w).Encode(model.BatchPortMappingResponse{Total: 1, Succeeded: 1, Results: []model.BatchPortMappingResult{{MappingID: "pm-1", Success: true}}})
				return
			}
			_ = json.NewEncoder(w).Encode(model.PortMappingRule{MappingID: "pm-1", Protocol: "TCP", PublicPort: 40222, PrivatePort: 22})
		case http.MethodPatch:
			_ = json.NewEncoder(w).Encode(model.PortMappingRule{MappingID: "pm-2", Protocol: "TCP", PublicPort: 40222, PrivatePort: 8080})
		case http.MethodDelete:
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
		}
	}))
	defer server.Close()

	client := &HTTPClient{baseURL: server.URL, http: server.Client()}
	if _, err := client.CreatePortMapping(context.Background(), "Bearer test", "ins-1", model.CreatePortMappingInput{Protocol: "TCP", PrivatePort: 22, Remark: "SSH"}); err != nil {
		t.Fatalf("create port mapping: %v", err)
	}
	if _, err := client.UpdatePortMapping(context.Background(), "Bearer test", "ins-1", "pm-1", model.UpdatePortMappingInput{PrivatePort: intPtr(8080), Remark: "HTTP"}); err != nil {
		t.Fatalf("update port mapping: %v", err)
	}
	if err := client.DeletePortMapping(context.Background(), "Bearer test", "ins-1", "pm-1"); err != nil {
		t.Fatalf("delete port mapping: %v", err)
	}
	if _, err := client.BatchCreatePortMappings(context.Background(), "Bearer test", "ins-1", model.BatchCreatePortMappingsInput{Rules: []model.CreatePortMappingInput{{Protocol: "UDP", PrivatePort: 51820, Remark: "WG"}}}); err != nil {
		t.Fatalf("batch create port mappings: %v", err)
	}
	if _, err := client.BatchDeletePortMappings(context.Background(), "Bearer test", "ins-1", model.BatchDeletePortMappingsInput{MappingIDs: []string{"pm-1"}}); err != nil {
		t.Fatalf("batch delete port mappings: %v", err)
	}

	if len(calls) != 5 {
		t.Fatalf("expected 5 calls, got %d", len(calls))
	}
	if calls[0].method != http.MethodPost || calls[0].path != "/cecs/instances/ins-1/port-mappings" || !strings.Contains(calls[0].body, "\"private_port\":22") {
		t.Fatalf("unexpected create call: %#v", calls[0])
	}
	if calls[1].method != http.MethodPatch || calls[1].path != "/cecs/instances/ins-1/port-mappings/pm-1" || !strings.Contains(calls[1].body, "\"private_port\":8080") {
		t.Fatalf("unexpected update call: %#v", calls[1])
	}
	if calls[2].method != http.MethodDelete || calls[2].path != "/cecs/instances/ins-1/port-mappings/pm-1" {
		t.Fatalf("unexpected delete call: %#v", calls[2])
	}
	if calls[3].method != http.MethodPost || calls[3].path != "/cecs/instances/ins-1/port-mappings/batch" || !strings.Contains(calls[3].body, "\"protocol\":\"UDP\"") {
		t.Fatalf("unexpected batch create call: %#v", calls[3])
	}
	if calls[4].method != http.MethodDelete || calls[4].path != "/cecs/instances/ins-1/port-mappings/batch" || !strings.Contains(calls[4].body, "\"mapping_ids\":[\"pm-1\"]") {
		t.Fatalf("unexpected batch delete call: %#v", calls[4])
	}
}

func TestNewHTTPClientTrimsTrailingSlash(t *testing.T) {
	t.Parallel()

	client := NewHTTPClient(config.Config{UpstreamBaseURL: "http://example.com/api/v1///", RequestTimeoutMS: 1})
	if client.baseURL != "http://example.com/api/v1" {
		t.Fatalf("unexpected base url: %s", client.baseURL)
	}
}

func TestDecodeResponseReturnsBusinessErrorFromEnvelope(t *testing.T) {
	t.Parallel()

	var out model.MeResponse
	err := decodeResponse([]byte(`{"code":401,"message":"Token无效","data":null}`), &out)
	if err == nil {
		t.Fatal("expected business error, got nil")
	}
	if !strings.Contains(err.Error(), "Token无效") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDecodeEnvelopeStatusAllowsSuccessEnvelope(t *testing.T) {
	t.Parallel()

	err := decodeEnvelopeStatus([]byte(`{"code":200,"message":"success","data":null}`))
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}

func TestDecodeResponseSupportsNestedInstanceEnvelope(t *testing.T) {
	t.Parallel()

	var out model.InstanceDetail
	err := decodeResponse([]byte(`{"code":200,"message":"success","data":{"instance":{"instance_id":"id-1","instance_name":"Desktop","board_type":"rk3588","image_name":"MytIOS 1.0","status":"running"}}}`), &out)
	if err != nil {
		t.Fatalf("expected nested instance payload to decode, got %v", err)
	}
	if out.InstanceID != "id-1" || out.InstanceName != "Desktop" || out.BoardType != "rk3588" {
		t.Fatalf("unexpected decoded detail: %#v", out)
	}
}

func TestConsoleURLResponseAcceptsStringPayload(t *testing.T) {
	t.Parallel()

	var out model.ConsoleURLResponse
	err := decodeResponse([]byte(`{"code":200,"message":"success","data":"https://console.local/abc?token=xyz"}`), &out)
	if err != nil {
		t.Fatalf("expected string console payload to decode, got %v", err)
	}
	if out.ConsoleURL != "https://console.local/abc?token=xyz" {
		t.Fatalf("unexpected console url: %#v", out)
	}
}

func TestActionResponseAcceptsLooseEnvelope(t *testing.T) {
	t.Parallel()

	var out model.ActionResponse
	err := decodeResponse([]byte(`{"code":200,"message":"success","data":null,"result":{"status":"ok","message":"accepted"}}`), &out)
	if err != nil {
		t.Fatalf("expected loose action payload to decode, got %v", err)
	}
	if out.Status != "ok" || out.Message != "accepted" {
		t.Fatalf("unexpected action response: %#v", out)
	}
}

func intPtr(value int) *int {
	return &value
}
