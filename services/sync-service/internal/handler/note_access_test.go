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
	if err := repository.NewUserRepo(pool).Create(context.Background(), u); err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u.ID
}

func seedVaultFor(t *testing.T, pool *pgxpool.Pool, userID string) string {
	t.Helper()
	now := time.Now().UTC()
	v := &model.Vault{ID: uuid.New().String(), UserID: userID, Name: "V", CreatedAt: now, UpdatedAt: now}
	if err := repository.NewVaultRepo(pool).Create(context.Background(), v); err != nil {
		t.Fatalf("create vault: %v", err)
	}
	return v.ID
}

func newNoteAccessFixture(t *testing.T) *noteAccessFixture {
	t.Helper()
	pool := newIsolatedDB(t)
	ctx := context.Background()

	vaultRepo := repository.NewVaultRepo(pool)
	memberRepo := repository.NewVaultMemberRepo(pool)
	svc := service.NewSyncService(
		repository.NewNoteRepo(pool), vaultRepo,
		repository.NewLinkRepo(pool), repository.NewTagRepo(pool), repository.NewAliasRepo(pool),
		nil, // no search indexer
	)

	f := &noteAccessFixture{
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
		if len(versions) < 2 {
			t.Fatalf("got %d versions, want the initial version plus the edit", len(versions))
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
