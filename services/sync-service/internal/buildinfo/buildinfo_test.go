package buildinfo

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthHandlerReportsStatusAndVersion(t *testing.T) {
	old := Version
	Version = "1.2.3"
	t.Cleanup(func() { Version = old })

	rec := httptest.NewRecorder()
	HealthHandler(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("content-type = %q, want application/json", ct)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON %q: %v", rec.Body.String(), err)
	}
	if body["status"] != "ok" || body["version"] != "1.2.3" {
		t.Errorf("body = %v, want status ok and version 1.2.3", body)
	}
}

func TestVersionDefaultsToDev(t *testing.T) {
	if Version != "dev" {
		t.Errorf("default Version = %q, want dev (release builds inject it via ldflags)", Version)
	}
}
