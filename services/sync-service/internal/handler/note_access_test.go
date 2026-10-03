package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/ws"
)

// newIsolatedDB connects to DATABASE_URL and returns a pool whose search_path
// points at a throwaway schema with all migrations applied, so the test never
// touches real data. Skipped when no database is configured (plain `go test`).
func newIsolatedDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping database integration test")
	}
	ctx := context.Background()

	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := admin.Ping(ctx); err != nil {
		admin.Close()
		t.Skipf("database not reachable: %v", err)
	}

	schema := "t_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatalf("create schema: %v", err)
	}

	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		admin.Close()
		t.Fatalf("parse config: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		admin.Close()
		t.Fatalf("connect to schema: %v", err)
	}

	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})

	if err := repository.RunMigrations(ctx, pool, "../../migrations"); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return pool
}

// noteAccessFixture is two users, each owning one vault, plus a viewer who is
// a member of the first user's vault, and one note in that vault.
type noteAccessFixture struct {
	pool                      *pgxpool.Pool
	h                         *NoteHandler
	svc                       *service.SyncService
	owner, outsider, viewer   string
	ownerVault, outsiderVault string
	note                      *model.Note
}

func seedUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	now := time.Now().UTC()
	u := &model.User{
		ID: uuid.New().String(), Email: uuid.New().String() + "@nexus.test",
		PasswordHash: "x", DisplayName: "Test", CreatedAt: now, UpdatedAt: now,
	}
	if err := repository.NewUserRepo(pool, fieldcrypttest.Cipher(t)).Create(context.Background(), u); err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u.ID
}

func seedVaultFor(t *testing.T, pool *pgxpool.Pool, userID string) string {
	t.Helper()
	now := time.Now().UTC()
	v := &model.Vault{ID: uuid.New().String(), UserID: userID, Name: "V", CreatedAt: now, UpdatedAt: now}
	if err := repository.NewVaultRepo(pool, fieldcrypttest.Cipher(t)).Create(context.Background(), v); err != nil {
		t.Fatalf("create vault: %v", err)
	}
	return v.ID
}

func newNoteAccessFixture(t *testing.T) *noteAccessFixture {
	t.Helper()
	pool := newIsolatedDB(t)
	ctx := context.Background()

	vaultRepo := repository.NewVaultRepo(pool, fieldcrypttest.Cipher(t))
	memberRepo := repository.NewVaultMemberRepo(pool, fieldcrypttest.Cipher(t))
	svc := service.NewSyncService(
		repository.NewNoteRepo(pool, fieldcrypttest.Cipher(t)), vaultRepo,
		repository.NewLinkRepo(pool), repository.NewTagRepo(pool), repository.NewAliasRepo(pool),
		repository.NewLinkedFileRepo(pool, fieldcrypttest.Cipher(t)),
		nil, // no search indexer
	)

	f := &noteAccessFixture{
		pool:     pool,
		h:        NewNoteHandler(svc, vaultRepo, memberRepo, ws.NewHub()),
		svc:      svc,
		owner:    seedUser(t, pool),
		outsider: seedUser(t, pool),
		viewer:   seedUser(t, pool),
	}
	f.ownerVault = seedVaultFor(t, pool, f.owner)
	f.outsiderVault = seedVaultFor(t, pool, f.outsider)
	if err := memberRepo.Add(ctx, f.ownerVault, f.viewer, model.VaultRoleViewer, f.owner); err != nil {
		t.Fatalf("add member: %v", err)
	}

	note, err := svc.CreateNote(ctx, f.ownerVault, "Secret", "secret.md", "first draft", "dev", "")
	if err != nil {
		t.Fatalf("create note: %v", err)
	}
	if _, _, err := svc.UpdateNote(ctx, service.NoteUpdate{
		NoteID: note.ID, Title: note.Title, Path: note.Path, Content: "second draft",
		PrevChecksum: note.Checksum, DeviceID: "dev",
	}); err != nil {
		t.Fatalf("update note: %v", err)
	}
	f.note = note
	return f
}

// call invokes handler fn as userID with the given path values, bypassing the
// JWT middleware (which only ever sets the user id on the context).
func call(fn http.HandlerFunc, method, userID string, pathValues map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/", nil)
	for k, v := range pathValues {
		req.SetPathValue(k, v)
	}
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	fn(rec, req)
	return rec
}

func TestVersions_AccessControl(t *testing.T) {
	f := newNoteAccessFixture(t)

	t.Run("owner reads the history", func(t *testing.T) {
		rec := call(f.h.Versions, http.MethodGet, f.owner, map[string]string{"noteId": f.note.ID})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
		}
		var versions []model.NoteVersion
		if err := json.Unmarshal(rec.Body.Bytes(), &versions); err != nil {
			t.Fatalf("decode: %v", err)
		}
		// The edit follows the creation on the same device within the
		// snapshot window, so both are one version holding the edit (#413).
		if len(versions) != 1 || versions[0].Checksum == f.note.Checksum {
			t.Fatalf("got %+v, want one snapshot holding the edit", versions)
		}
		// The list carries no content; one version is fetched by id (#414).
		if strings.Contains(rec.Body.String(), "draft") {
			t.Fatalf("the list carries version content: %s", rec.Body.String())
		}
		one := call(f.h.Version, http.MethodGet, f.owner, map[string]string{"noteId": f.note.ID, "versionId": versions[0].ID})
		var v model.NoteVersion
		if one.Code != http.StatusOK || json.Unmarshal(one.Body.Bytes(), &v) != nil || v.Content != "second draft" {
			t.Fatalf("one version: %d %s", one.Code, one.Body.String())
		}
	})

	t.Run("a version is only found under its own note", func(t *testing.T) {
		other, err := f.svc.CreateNote(context.Background(), f.outsiderVault, "Mine", "", "outsider text", "dev", "")
		if err != nil {
			t.Fatal(err)
		}
		list := call(f.h.Versions, http.MethodGet, f.owner, map[string]string{"noteId": f.note.ID})
		var versions []model.NoteVersion
		_ = json.Unmarshal(list.Body.Bytes(), &versions)
		// The outsider names the owner's version under their own note.
		rec := call(f.h.Version, http.MethodGet, f.outsider, map[string]string{"noteId": other.ID, "versionId": versions[0].ID})
		if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "draft") {
			t.Fatalf("status = %d (%s), want 404", rec.Code, rec.Body.String())
		}
		if rec := call(f.h.Version, http.MethodGet, f.outsider, map[string]string{"noteId": f.note.ID, "versionId": versions[0].ID}); rec.Code != http.StatusForbidden {
			t.Fatalf("outsider on the owner's note: status = %d, want 403", rec.Code)
		}
	})

	t.Run("vault member reads the history", func(t *testing.T) {
		rec := call(f.h.Versions, http.MethodGet, f.viewer, map[string]string{"noteId": f.note.ID})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
	})

	t.Run("user without vault access is refused", func(t *testing.T) {
		rec := call(f.h.Versions, http.MethodGet, f.outsider, map[string]string{"noteId": f.note.ID})
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", rec.Code)
		}
		if strings.Contains(rec.Body.String(), "draft") {
			t.Fatalf("refused response leaked version content: %s", rec.Body.String())
		}
	})

	t.Run("unknown note is not found", func(t *testing.T) {
		rec := call(f.h.Versions, http.MethodGet, f.owner, map[string]string{"noteId": uuid.New().String()})
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
	})
}

func TestDelete_NoteMustBelongToThePathVault(t *testing.T) {
	f := newNoteAccessFixture(t)
	ctx := context.Background()

	// The outsider has write access to their own vault, but the note lives in
	// someone else's: naming it under their vault must not report success.
	rec := call(f.h.Delete, http.MethodDelete, f.outsider, map[string]string{
		"vaultId": f.outsiderVault, "noteId": f.note.ID,
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-vault delete status = %d, want 404", rec.Code)
	}
	if _, err := f.svc.GetNote(ctx, f.note.ID); err != nil {
		t.Fatalf("note should still exist: %v", err)
	}

	// A viewer of the right vault may read but not delete.
	rec = call(f.h.Delete, http.MethodDelete, f.viewer, map[string]string{
		"vaultId": f.ownerVault, "noteId": f.note.ID,
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("viewer delete status = %d, want 403", rec.Code)
	}

	rec = call(f.h.Delete, http.MethodDelete, f.owner, map[string]string{
		"vaultId": f.ownerVault, "noteId": f.note.ID,
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("owner delete status = %d, want 204", rec.Code)
	}
	if _, err := f.svc.GetNote(ctx, f.note.ID); err == nil {
		t.Fatal("note should be gone after the owner deletes it")
	}
}

// POST /api/notes/{noteId}/versions/{versionId}/restore (#417).
func TestRestoreVersion_HTTP(t *testing.T) {
	f := newNoteAccessFixture(t)
	ctx := context.Background()
	current, err := f.svc.GetNote(ctx, f.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	versions, _ := f.svc.GetVersions(ctx, f.note.ID)
	path := map[string]string{"noteId": f.note.ID, "versionId": versions[0].ID}
	body := map[string]string{"prev_checksum": current.Checksum, "device_id": "dev"}

	if rec := callJSON(f.h.RestoreVersion, f.viewer, path, body); rec.Code != http.StatusForbidden {
		t.Fatalf("viewer: status %d, want 403", rec.Code)
	}
	if rec := callJSON(f.h.RestoreVersion, f.owner, path, map[string]string{"prev_checksum": "stale"}); rec.Code != http.StatusConflict {
		t.Fatalf("stale checksum: status %d, want 409", rec.Code)
	}
	missing := map[string]string{"noteId": f.note.ID, "versionId": uuid.New().String()}
	if rec := callJSON(f.h.RestoreVersion, f.owner, missing, body); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown version: status %d, want 404", rec.Code)
	}
	rec := callJSON(f.h.RestoreVersion, f.owner, path, body)
	var note model.Note
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &note) != nil || note.Content != "second draft" {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body.String())
	}
}

// GET/PUT /api/vaults/{id}/history-settings (#418).
func TestHistorySettings_HTTP(t *testing.T) {
	f := newNoteAccessFixture(t)
	vault := map[string]string{"id": f.ownerVault}

	rec := call(f.h.GetHistorySettings, http.MethodGet, f.viewer, vault)
	var keep model.VersionRetention
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &keep) != nil || keep.KeepCount != 50 || keep.KeepDays != 0 {
		t.Fatalf("defaults: %d %s", rec.Code, rec.Body.String())
	}
	if rec := call(f.h.GetHistorySettings, http.MethodGet, f.outsider, vault); rec.Code != http.StatusForbidden {
		t.Fatalf("outsider reads: status %d, want 403", rec.Code)
	}

	put := func(user string, body any) int {
		r := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(mustJSON(t, body)))
		r.SetPathValue("id", f.ownerVault)
		r = r.WithContext(context.WithValue(r.Context(), middleware.UserIDKey, user))
		w := httptest.NewRecorder()
		f.h.PutHistorySettings(w, r)
		return w.Code
	}
	if code := put(f.viewer, model.VersionRetention{KeepCount: 10}); code != http.StatusForbidden {
		t.Fatalf("member changes it: status %d, want 403", code)
	}
	for _, bad := range []model.VersionRetention{{KeepCount: 0}, {KeepCount: 501}, {KeepCount: 10, KeepDays: -1}, {KeepCount: 10, KeepDays: 4000}} {
		if code := put(f.owner, bad); code != http.StatusBadRequest {
			t.Fatalf("%+v: status %d, want 400", bad, code)
		}
	}
	if code := put(f.owner, model.VersionRetention{KeepCount: 10, KeepDays: 30}); code != http.StatusOK {
		t.Fatalf("owner: status %d", code)
	}
	rec = call(f.h.GetHistorySettings, http.MethodGet, f.owner, vault)
	if json.Unmarshal(rec.Body.Bytes(), &keep) != nil || keep.KeepCount != 10 || keep.KeepDays != 30 {
		t.Fatalf("read back: %s", rec.Body.String())
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
