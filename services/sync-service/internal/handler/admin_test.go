package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// The auth gate must reject before any repository access, so a nil repo is
// safe in these tests — a panic would mean the gate leaked through.
func newTestAdmin(token string) *AdminHandler {
	return NewAdminHandler(nil, token, time.Now())
}

func TestAdminStats_RejectsWithoutToken(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestAdmin("secret-token").Stats(rec, httptest.NewRequest("GET", "/api/admin/stats", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 without a token, got %d", rec.Code)
	}
}

func TestAdminStats_RejectsWrongToken(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/admin/stats", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	rec := httptest.NewRecorder()
	newTestAdmin("secret-token").Stats(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 with a wrong token, got %d", rec.Code)
	}
}

func TestAdminStats_DisabledWhenUnconfigured(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/admin/stats", nil)
	// Even presenting an empty bearer must not match an empty configured token.
	req.Header.Set("Authorization", "Bearer ")
	rec := httptest.NewRecorder()
	newTestAdmin("").Stats(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when no admin token is configured, got %d", rec.Code)
	}
}

// The token must come with the Bearer scheme; a bare token in the header is
// not accepted (#328).
func TestAdminAuthorized_RequiresTheBearerScheme(t *testing.T) {
	h := newTestAdmin("secret-token")
	for header, want := range map[string]bool{
		"Bearer secret-token": true,
		"secret-token":        false,
		"bearer secret-token": true,
		"Bearer  secret-token": false,
		"Bearer":              false,
		"Basic secret-token":  false,
	} {
		req := httptest.NewRequest("GET", "/api/admin/stats", nil)
		req.Header.Set("Authorization", header)
		if got := h.authorized(req); got != want {
			t.Errorf("Authorization %q: authorized = %v, want %v", header, got, want)
		}
	}
}
