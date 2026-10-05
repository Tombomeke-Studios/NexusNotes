package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
)

type auditEntry struct{ tokenID, tool, summary string }

type fakeMCPAuth struct {
	mu      sync.Mutex
	tokens  map[string]*model.MCPToken
	entries []auditEntry
}

func (f *fakeMCPAuth) Authenticate(_ context.Context, raw string) (*model.MCPToken, error) {
	return f.tokens[raw], nil
}

func (f *fakeMCPAuth) Record(_ context.Context, tokenID, tool, summary string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.entries = append(f.entries, auditEntry{tokenID, tool, summary})
	return nil
}

func newMCPTestServer(t *testing.T, limiter *RateLimiter) (http.Handler, *fakeMCPAuth) {
	t.Helper()
	auth := &fakeMCPAuth{tokens: map[string]*model.MCPToken{
		"nn_reader": {ID: "t-read", UserID: "u1", Scope: model.MCPScopeRead},
		"nn_writer": {ID: "t-write", UserID: "u1", Scope: model.MCPScopeReadWrite},
	}}
	ok := func(w http.ResponseWriter, r *http.Request) {
		if MCPTokenFrom(r.Context()) == nil || GetUserID(r.Context()) != "u1" {
			t.Errorf("handler ran without the token's user on the context")
		}
		_, _ = w.Write([]byte(r.PathValue("noteId")))
	}
	read, write := http.NewServeMux(), http.NewServeMux()
	read.HandleFunc("GET /api/notes/{noteId}", ok)
	write.HandleFunc("GET /api/notes/{noteId}", ok)
	write.HandleFunc("PUT /api/notes/{noteId}", ok)

	full := http.NewServeMux()
	full.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("full api")) })
	authSvc := service.NewAuthService(nil, strings.Repeat("s", 32))
	return Auth(authSvc, MCPAccess{Auth: auth, Read: read, Write: write, Limiter: limiter})(full), auth
}

func do(h http.Handler, method, path, token, tool string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	r.Header.Set("Authorization", "Bearer "+token)
	if tool != "" {
		r.Header.Set("X-MCP-Tool", tool)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestAuth_MCPTokenReachesOnlyItsScopesRoutes(t *testing.T) {
	h, _ := newMCPTestServer(t, nil)

	if w := do(h, http.MethodGet, "/api/notes/n1", "nn_reader", ""); w.Code != http.StatusOK || w.Body.String() != "n1" {
		t.Fatalf("read with read token: %d %q", w.Code, w.Body.String())
	}
	if w := do(h, http.MethodPut, "/api/notes/n1", "nn_reader", ""); w.Code != http.StatusForbidden {
		t.Fatalf("write with read token: %d, want 403", w.Code)
	}
	if w := do(h, http.MethodPut, "/api/notes/n1", "nn_writer", ""); w.Code != http.StatusOK {
		t.Fatalf("write with read-write token: %d", w.Code)
	}
	// Anything outside the allowlist never reaches the full API.
	for _, path := range []string{"/api/mcp-tokens", "/api/auth/me", "/api/devices"} {
		if w := do(h, http.MethodGet, path, "nn_writer", ""); w.Code != http.StatusForbidden || w.Body.String() == "full api" {
			t.Fatalf("GET %s with an MCP token: %d %q, want 403", path, w.Code, w.Body.String())
		}
	}
}

func TestAuth_UnknownMCPTokenIsUnauthorized(t *testing.T) {
	h, _ := newMCPTestServer(t, nil)
	if w := do(h, http.MethodGet, "/api/notes/n1", "nn_revoked", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("unknown token: %d, want 401", w.Code)
	}
}

func TestAuth_MCPRequestsAreAudited(t *testing.T) {
	h, auth := newMCPTestServer(t, nil)
	do(h, http.MethodGet, "/api/notes/n1?q=secret+words", "nn_reader", "read_note")
	do(h, http.MethodGet, "/api/notes/n2", "nn_reader", "Not A Tool!")
	do(h, http.MethodPut, "/api/notes/n3", "nn_reader", "update_note") // refused: not audited

	want := []auditEntry{
		{"t-read", "read_note", "GET /api/notes/n1"},
		{"t-read", "api", "GET /api/notes/n2"},
	}
	if len(auth.entries) != len(want) {
		t.Fatalf("audit = %+v, want %+v", auth.entries, want)
	}
	for i := range want {
		if auth.entries[i] != want[i] {
			t.Fatalf("audit[%d] = %+v, want %+v", i, auth.entries[i], want[i])
		}
	}
}

func TestAuth_MCPTokensAreRateLimitedPerToken(t *testing.T) {
	h, _ := newMCPTestServer(t, NewRateLimiter(60, 2))
	for i := 0; i < 2; i++ {
		if w := do(h, http.MethodGet, "/api/notes/n1", "nn_reader", ""); w.Code != http.StatusOK {
			t.Fatalf("call %d: %d", i, w.Code)
		}
	}
	w := do(h, http.MethodGet, "/api/notes/n1", "nn_reader", "")
	if w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") == "" {
		t.Fatalf("third call: %d (Retry-After %q), want 429", w.Code, w.Header().Get("Retry-After"))
	}
	// Another token has its own budget.
	if w := do(h, http.MethodGet, "/api/notes/n1", "nn_writer", ""); w.Code != http.StatusOK {
		t.Fatalf("other token: %d", w.Code)
	}
}

func TestAuth_MCPTokenWithoutMCPAccessIsRejected(t *testing.T) {
	full := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("full api")) })
	h := Auth(service.NewAuthService(nil, strings.Repeat("s", 32)))(full)
	if w := do(h, http.MethodGet, "/api/notes/n1", "nn_reader", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("MCP token without MCP access configured: %d, want 401", w.Code)
	}
}
