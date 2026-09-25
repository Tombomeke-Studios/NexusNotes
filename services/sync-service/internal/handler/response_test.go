package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func jsonBody(padding int) string {
	return `{"email":"` + strings.Repeat("a", padding) + `"}`
}

func TestDecodeJSON_AcceptsBodyWithinLimit(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(jsonBody(100)))
	var v struct{ Email string }
	if err := decodeJSON(rec, req, &v); err != nil {
		t.Fatalf("unexpected error for a small body: %v", err)
	}
	if len(v.Email) != 100 {
		t.Fatalf("body not decoded, got %d chars", len(v.Email))
	}
}

func TestDecodeJSON_RejectsBodyOverGeneralLimit(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(jsonBody(maxJSONBody+1)))
	var v struct{ Email string }
	err := decodeJSON(rec, req, &v)
	if err == nil || !isBodyTooLarge(err) {
		t.Fatalf("expected a too-large error, got %v", err)
	}
}

func TestDecodeSmallJSON_RejectsBodyOverSmallLimit(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(jsonBody(maxSmallJSONBody+1)))
	var v struct{ Email string }
	err := decodeSmallJSON(rec, req, &v)
	if err == nil || !isBodyTooLarge(err) {
		t.Fatalf("expected a too-large error, got %v", err)
	}
}

func TestWriteBodyError_MapsTooLargeTo413AndOthersTo400(t *testing.T) {
	tooLarge := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(jsonBody(maxSmallJSONBody+1)))
	err := decodeSmallJSON(tooLarge, req, &struct{ Email string }{})
	writeBodyError(tooLarge, err, "invalid request body")
	if tooLarge.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized body: got %d, want 413", tooLarge.Code)
	}

	malformed := httptest.NewRecorder()
	writeBodyError(malformed, errors.New("invalid character"), "invalid request body")
	if malformed.Code != http.StatusBadRequest {
		t.Errorf("malformed body: got %d, want 400", malformed.Code)
	}

	// A nil error means the body decoded but failed validation (e.g. a missing field).
	missing := httptest.NewRecorder()
	writeBodyError(missing, nil, "token is required")
	if missing.Code != http.StatusBadRequest {
		t.Errorf("validation failure: got %d, want 400", missing.Code)
	}
}

// The body is rejected before any service is touched, so nil dependencies are
// safe here — a nil-pointer panic would mean the limit did not fire first.
func TestAuthLogin_OversizedBodyGets413(t *testing.T) {
	h := NewAuthHandler(nil, nil, nil, nil)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(jsonBody(maxSmallJSONBody+1)))
	h.Login(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 for an oversized login body, got %d", rec.Code)
	}
}
