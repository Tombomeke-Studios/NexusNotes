package middleware

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

func TestRequestID_GeneratesAndEchoes(t *testing.T) {
	var seen string
	h := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = GetRequestID(r.Context())
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/x", nil))

	if !regexp.MustCompile(`^[0-9a-f]{16}$`).MatchString(seen) {
		t.Fatalf("expected a generated hex id, got %q", seen)
	}
	if got := rec.Header().Get("X-Request-ID"); got != seen {
		t.Fatalf("response header %q does not match context id %q", got, seen)
	}
}

func TestRequestID_HonoursInboundHeader(t *testing.T) {
	var seen string
	h := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = GetRequestID(r.Context())
	}))

	req := httptest.NewRequest("GET", "/x", nil)
	req.Header.Set("X-Request-ID", "proxy-abc-123")
	h.ServeHTTP(httptest.NewRecorder(), req)

	if seen != "proxy-abc-123" {
		t.Fatalf("expected inbound id to be honoured, got %q", seen)
	}
}

func TestRequestID_RejectsOversizedInboundHeader(t *testing.T) {
	var seen string
	h := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = GetRequestID(r.Context())
	}))

	req := httptest.NewRequest("GET", "/x", nil)
	req.Header.Set("X-Request-ID", strings.Repeat("a", 65))
	h.ServeHTTP(httptest.NewRecorder(), req)

	if len(seen) != 16 {
		t.Fatalf("oversized inbound id must be replaced with a generated one, got %q", seen)
	}
}

func TestGetRequestID_EmptyOutsideRequest(t *testing.T) {
	if got := GetRequestID(httptest.NewRequest("GET", "/", nil).Context()); got != "" {
		t.Fatalf("expected empty id outside the middleware, got %q", got)
	}
}

func TestRouteLabel_NormalizesIds(t *testing.T) {
	cases := map[string]string{
		"/api/notes/0bb90c0a-1234-4abc-9def-0123456789ab/star": "/api/notes/:id/star",
		"/api/vaults/ba8b3b7b-9703-4833-ba60-2c744061b3e7/notes": "/api/vaults/:id/notes",
		"/api/vaults":  "/api/vaults",
		"/health":      "/health",
	}
	for in, want := range cases {
		if got := RouteLabel(in); got != want {
			t.Fatalf("RouteLabel(%q) = %q, want %q", in, got, want)
		}
	}
}
