package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/Tombomeke-Studios/NexusNotes/services/mcp-service/internal/nexus"
)

// bearer adds the MCP token to every request, as an AI client configured
// with it does.
type bearer struct {
	token string
	next  http.RoundTripper
}

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.token)
	return b.next.RoundTrip(r)
}

// #552: the whole path an AI client takes over HTTP. It connects over
// Streamable HTTP with its token, lists the vaults and reads a note; the
// server acts on the sync service (a stub) as that token, naming each tool.
func TestFullFlow_StreamableHTTP(t *testing.T) {
	fake := newFake(t)
	api := httptest.NewServer(fake)
	t.Cleanup(api.Close)

	now := func() time.Time { return time.Date(2026, 10, 4, 9, 0, 0, 0, time.UTC) }
	// The same stateless, token-per-request wiring as nexusnotes-mcp --http.
	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok {
			return nil
		}
		return New(nexus.NewClient(api.URL, token), now)
	}, &mcp.StreamableHTTPOptions{Stateless: true})
	mcpSrv := httptest.NewServer(handler)
	t.Cleanup(mcpSrv.Close)

	ctx := context.Background()
	transport := &mcp.StreamableClientTransport{
		Endpoint:             mcpSrv.URL,
		HTTPClient:           &http.Client{Transport: bearer{token: fake.token, next: http.DefaultTransport}},
		DisableStandaloneSSE: true,
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "flow-test"}, nil).Connect(ctx, transport, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = cs.Close() })

	var vaults ListVaultsOut
	if msg := call(t, cs, "list_vaults", nil, &vaults); msg != "" {
		t.Fatalf("list_vaults: %s", msg)
	}
	if len(vaults.Vaults) != 2 || vaults.Vaults[0].ID != "v1" || vaults.Vaults[0].Name != "Work" {
		t.Fatalf("vaults: %+v", vaults.Vaults)
	}

	var note ReadNoteOut
	if msg := call(t, cs, "read_note", map[string]any{"vault_id": vaults.Vaults[0].ID, "path": "Ideas"}, &note); msg != "" {
		t.Fatalf("read_note: %s", msg)
	}
	if note.ID != "n4" || note.Content != "- one" {
		t.Fatalf("note: %+v", note)
	}

	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.tools) < 2 || fake.tools[0] != "list_vaults" || fake.tools[len(fake.tools)-1] != "read_note" {
		t.Fatalf("X-MCP-Tool headers = %q", fake.tools)
	}
}

// Without a token the stub refuses, and the tool says why instead of failing
// the whole session.
func TestFullFlow_WrongTokenIsExplained(t *testing.T) {
	fake := newFake(t)
	api := httptest.NewServer(fake)
	t.Cleanup(api.Close)
	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		token, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		return New(nexus.NewClient(api.URL, token), time.Now)
	}, &mcp.StreamableHTTPOptions{Stateless: true})
	mcpSrv := httptest.NewServer(handler)
	t.Cleanup(mcpSrv.Close)

	transport := &mcp.StreamableClientTransport{
		Endpoint:             mcpSrv.URL,
		HTTPClient:           &http.Client{Transport: bearer{token: "nn_revoked", next: http.DefaultTransport}},
		DisableStandaloneSSE: true,
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "flow-test"}, nil).Connect(context.Background(), transport, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = cs.Close() })
	if msg := call(t, cs, "list_vaults", nil, nil); msg == "" {
		t.Fatal("list_vaults with a wrong token succeeded")
	}
}
