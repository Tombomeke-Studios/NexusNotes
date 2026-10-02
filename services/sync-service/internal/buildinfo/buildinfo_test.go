package buildinfo

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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

func TestReadyHandler(t *testing.T) {
	ok := ReadyHandler(func(context.Context) error { return nil }, time.Second)
	rec := httptest.NewRecorder()
	ok(rec, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ready"`) {
		t.Fatalf("healthy dependency: %d %s", rec.Code, rec.Body.String())
	}

	failing := ReadyHandler(func(context.Context) error {
		return errors.New("dial tcp 10.0.0.5:5432: connection refused")
	}, time.Second)
	rec = httptest.NewRecorder()
	failing(rec, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("failing dependency: status %d, want 503", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "10.0.0.5") {
		t.Fatalf("readiness must not leak connection details: %s", rec.Body.String())
	}
}

// A hanging dependency must not hang the probe.
func TestReadyHandlerTimesOut(t *testing.T) {
	slow := ReadyHandler(func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}, 20*time.Millisecond)
	done := make(chan int, 1)
	go func() {
		rec := httptest.NewRecorder()
		slow(rec, httptest.NewRequest(http.MethodGet, "/ready", nil))
		done <- rec.Code
	}()
	select {
	case code := <-done:
		if code != http.StatusServiceUnavailable {
			t.Fatalf("status %d, want 503", code)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ReadyHandler did not time out")
	}
}
