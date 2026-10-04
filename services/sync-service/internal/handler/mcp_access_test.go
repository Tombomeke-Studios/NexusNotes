package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
)

// The whole MCP token flow against a real database (#221): issue a token while
// signed in, use it through the auth middleware, and read the audit log.
func TestMCPTokens_EndToEnd(t *testing.T) {
	f := newNoteAccessFixture(t)
	ctx := context.Background()
	tokens := service.NewMCPTokenService(repository.NewMCPTokenRepo(f.pool, fieldcrypttest.Cipher(t)))
	th := NewMCPTokenHandler(tokens)

	// An e2ee vault of the owner, with one (ciphertext) note.
	now := time.Now().UTC()
	e2ee := &model.Vault{ID: uuid.NewString(), UserID: f.owner, Name: "Locked", Encryption: model.VaultEncryptionE2EE, CreatedAt: now, UpdatedAt: now}
	if err := repository.NewVaultRepo(f.pool, fieldcrypttest.Cipher(t)).Create(ctx, e2ee); err != nil {
		t.Fatal(err)
	}
	locked, err := f.svc.CreateNote(ctx, e2ee.ID, "x", "x.md", "ciphertext", "dev", "sum")
	if err != nil {
		t.Fatal(err)
	}

	issue := func(scope string) string {
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"Claude Desktop","scope":"`+scope+`"}`))
		r = r.WithContext(context.WithValue(r.Context(), middleware.UserIDKey, f.owner))
		w := httptest.NewRecorder()
		th.Create(w, r)
		var body struct {
			ID    string `json:"id"`
			Token string `json:"token"`
			Name  string `json:"name"`
		}
		if w.Code != http.StatusCreated || json.Unmarshal(w.Body.Bytes(), &body) != nil || !strings.HasPrefix(body.Token, "nn_") || body.Name != "Claude Desktop" {
			t.Fatalf("create %s token: %d %s", scope, w.Code, w.Body.String())
		}
		return body.Token
	}
	reader, writer := issue(model.MCPScopeRead), issue(model.MCPScopeReadWrite)

	// The token value and name are not stored readable.
	var hash, name string
	if err := f.pool.QueryRow(ctx, `SELECT token_hash, name FROM mcp_tokens WHERE token_hash = $1`, service.HashMCPToken(reader)).Scan(&hash, &name); err != nil {
		t.Fatalf("stored token: %v", err)
	}
	if strings.Contains(hash, reader) || !fieldcrypt.IsEncrypted(name) {
		t.Fatalf("token stored readable: hash %q name %q", hash, name)
	}

	read, write := http.NewServeMux(), http.NewServeMux()
	read.HandleFunc("GET /api/notes/{noteId}", f.h.Get)
	write.HandleFunc("GET /api/notes/{noteId}", f.h.Get)
	write.HandleFunc("PUT /api/notes/{noteId}", f.h.Update)
	write.HandleFunc("POST /api/vaults/{vaultId}/notes", f.h.Create)
	api := middleware.Auth(service.NewAuthService(nil, strings.Repeat("s", 32)), middleware.MCPAccess{Auth: tokens, Read: read, Write: write})(http.NotFoundHandler())
	do := func(method, path, token, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("X-MCP-Tool", "test_tool")
		w := httptest.NewRecorder()
		api.ServeHTTP(w, r)
		return w
	}

	if w := do(http.MethodGet, "/api/notes/"+f.note.ID, reader, ""); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "second draft") {
		t.Fatalf("read note: %d %s", w.Code, w.Body.String())
	}
	if w := do(http.MethodPost, "/api/vaults/"+f.ownerVault+"/notes", reader, `{"title":"AI","path":"ai.md","content":"hi"}`); w.Code != http.StatusForbidden {
		t.Fatalf("create with a read token: %d, want 403", w.Code)
	}
	if w := do(http.MethodPost, "/api/vaults/"+f.ownerVault+"/notes", writer, `{"title":"AI","path":"ai.md","content":"hi"}`); w.Code != http.StatusCreated {
		t.Fatalf("create with a read-write token: %d %s", w.Code, w.Body.String())
	}
	if w := do(http.MethodPost, "/api/vaults/"+e2ee.ID+"/notes", writer, `{"title":"AI","path":"ai.md","content":"plaintext"}`); w.Code != http.StatusForbidden {
		t.Fatalf("create in an e2ee vault: %d, want 403", w.Code)
	}
	put := `{"title":"x","path":"x.md","content":"plaintext","prev_checksum":"` + locked.Checksum + `"}`
	if w := do(http.MethodPut, "/api/notes/"+locked.ID, writer, put); w.Code != http.StatusForbidden {
		t.Fatalf("update in an e2ee vault: %d, want 403", w.Code)
	}
	if w := do(http.MethodGet, "/api/notes/"+f.note.ID, "nn_not-a-token", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("unknown token: %d, want 401", w.Code)
	}

	// The owner sees the calls in the audit log; another user does not.
	audit := func(user string) []model.MCPAuditEntry {
		r := httptest.NewRequest(http.MethodGet, "/?limit=50", nil)
		r = r.WithContext(context.WithValue(r.Context(), middleware.UserIDKey, user))
		w := httptest.NewRecorder()
		th.Audit(w, r)
		var entries []model.MCPAuditEntry
		if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &entries) != nil {
			t.Fatalf("audit: %d %s", w.Code, w.Body.String())
		}
		return entries
	}
	entries := audit(f.owner)
	if len(entries) != 4 || entries[0].Tool != "test_tool" || !strings.HasPrefix(entries[0].Summary, "PUT /api/notes/") {
		t.Fatalf("owner's audit log: %+v", entries)
	}
	if others := audit(f.outsider); len(others) != 0 {
		t.Fatalf("outsider sees %d audit entries", len(others))
	}

	// Revoking a token stops it at once.
	list, _ := tokens.List(ctx, f.owner)
	for _, tok := range list {
		r := httptest.NewRequest(http.MethodDelete, "/", nil)
		r.SetPathValue("id", tok.ID)
		r = r.WithContext(context.WithValue(r.Context(), middleware.UserIDKey, f.outsider))
		w := httptest.NewRecorder()
		th.Revoke(w, r)
		if w.Code != http.StatusNotFound {
			t.Fatalf("outsider revokes the owner's token: %d, want 404", w.Code)
		}
		if ok, err := tokens.Revoke(ctx, f.owner, tok.ID); !ok || err != nil {
			t.Fatalf("revoke: %v %v", ok, err)
		}
	}
	if w := do(http.MethodGet, "/api/notes/"+f.note.ID, reader, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("revoked token: %d, want 401", w.Code)
	}
}

func TestMCPTokens_CreateValidates(t *testing.T) {
	f := newNoteAccessFixture(t)
	th := NewMCPTokenHandler(service.NewMCPTokenService(repository.NewMCPTokenRepo(f.pool, fieldcrypttest.Cipher(t))))
	create := func(body string) int {
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		r = r.WithContext(context.WithValue(r.Context(), middleware.UserIDKey, f.owner))
		w := httptest.NewRecorder()
		th.Create(w, r)
		return w.Code
	}
	for _, body := range []string{
		`{"name":"","scope":"read"}`,
		`{"name":"` + strings.Repeat("x", 65) + `","scope":"read"}`,
		`{"name":"ok","scope":"admin"}`,
	} {
		if code := create(body); code != http.StatusBadRequest {
			t.Fatalf("%s: %d, want 400", body, code)
		}
	}
	for i := 0; i < service.MaxMCPTokensPerUser; i++ {
		if code := create(`{"name":"t","scope":"read"}`); code != http.StatusCreated {
			t.Fatalf("token %d: %d", i, code)
		}
	}
	if code := create(`{"name":"one too many","scope":"read"}`); code != http.StatusConflict {
		t.Fatalf("over the limit: %d, want 409", code)
	}
}
