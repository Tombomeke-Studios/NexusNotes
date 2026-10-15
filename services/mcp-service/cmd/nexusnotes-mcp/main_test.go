package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const initialize = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`

func post(t *testing.T, h http.Handler, origin, auth string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(initialize))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// #556: the HTTP transport validates the Origin header.
func TestHTTP_OriginCheck(t *testing.T) {
	allowed, err := parseOrigins("https://notes.example.com, http://localhost:1420/")
	if err != nil {
		t.Fatal(err)
	}
	h := newHTTPHandler("http://sync.invalid", allowed)
	const token = "Bearer nn_test"

	for _, tc := range []struct {
		name, origin string
		want         int
	}{
		{"no Origin (a non-browser client)", "", http.StatusOK},
		{"allowlisted", "https://notes.example.com", http.StatusOK},
		{"allowlisted, other case and trailing slash", "HTTP://LOCALHOST:1420/", http.StatusOK},
		{"other origin", "https://evil.example", http.StatusForbidden},
		{"other port", "https://notes.example.com:8443", http.StatusForbidden},
		{"opaque origin", "null", http.StatusForbidden},
	} {
		if rec := post(t, h, tc.origin, token); rec.Code != tc.want {
			t.Errorf("%s: status %d, want %d (%s)", tc.name, rec.Code, tc.want, rec.Body.String())
		}
	}

	// A disallowed origin is refused before the token is even looked at.
	if rec := post(t, h, "https://evil.example", ""); rec.Code != http.StatusForbidden {
		t.Errorf("disallowed origin without token: status %d, want 403", rec.Code)
	}
	// An allowed origin still needs a token.
	if rec := post(t, h, "https://notes.example.com", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("allowed origin without token: status %d, want 401", rec.Code)
	}
}

func TestHTTP_NoAllowlistRefusesEveryBrowserOrigin(t *testing.T) {
	h := newHTTPHandler("http://sync.invalid", map[string]bool{})
	if rec := post(t, h, "http://localhost:1420", "Bearer nn_test"); rec.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403", rec.Code)
	}
	if rec := post(t, h, "", "Bearer nn_test"); rec.Code != http.StatusOK {
		t.Fatalf("no Origin: status %d, want 200", rec.Code)
	}
}

func TestParseOrigins(t *testing.T) {
	got, err := parseOrigins(" https://A.example.com/ ,,http://localhost:8080")
	if err != nil || len(got) != 2 || !got["https://a.example.com"] || !got["http://localhost:8080"] {
		t.Fatalf("parseOrigins = %v, %v", got, err)
	}
	for _, bad := range []string{"*", "notes.example.com", "https://notes.example.com/path", "ftp://x.example", "https://"} {
		if _, err := parseOrigins(bad); err == nil {
			t.Errorf("parseOrigins(%q) accepted", bad)
		}
	}
}
