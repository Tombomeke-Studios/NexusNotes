package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func serveNoStore(t *testing.T, path string, h http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	NoStore(h).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

// #553: API responses are not kept by browser or proxy caches by default.
func TestNoStore_DefaultsOnAPIResponses(t *testing.T) {
	for _, path := range []string{"/api/vaults", "/api/notes/n1", "/api/auth/login"} {
		rec := serveNoStore(t, path, func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{}`))
		})
		if got := rec.Header().Get("Cache-Control"); got != "private, no-store" {
			t.Errorf("%s: Cache-Control = %q, want private, no-store", path, got)
		}
	}
}

func TestNoStore_CoversErrorResponses(t *testing.T) {
	rec := serveNoStore(t, "/api/notes/n1", func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "nope", http.StatusForbidden)
	})
	if got := rec.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q on an error", got)
	}
}

// A handler that sets its own policy (attachment bytes are immutable) keeps it.
func TestNoStore_HandlerOverrides(t *testing.T) {
	rec := serveNoStore(t, "/api/attachments/a1", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		_, _ = w.Write([]byte("bytes"))
	})
	if got := rec.Header().Get("Cache-Control"); got != "private, max-age=31536000, immutable" {
		t.Fatalf("Cache-Control = %q, want the handler's own", got)
	}
}

func TestNoStore_LeavesOtherPathsAlone(t *testing.T) {
	for _, path := range []string{"/health", "/ready", "/ws", "/apiary"} {
		rec := serveNoStore(t, path, func(w http.ResponseWriter, _ *http.Request) {})
		if got := rec.Header().Get("Cache-Control"); got != "" {
			t.Errorf("%s: Cache-Control = %q, want none", path, got)
		}
	}
}
