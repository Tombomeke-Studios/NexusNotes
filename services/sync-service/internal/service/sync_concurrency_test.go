package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
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
	cfg.MaxConns = 16
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

func newTestSync(pool *pgxpool.Pool) *SyncService {
	return NewSyncService(
		repository.NewNoteRepo(pool),
		repository.NewVaultRepo(pool),
		repository.NewLinkRepo(pool),
		repository.NewTagRepo(pool),
		repository.NewAliasRepo(pool),
		nil, // no search indexer
	)
}

func seedNote(t *testing.T, pool *pgxpool.Pool, svc *SyncService, content string) *model.Note {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	user := &model.User{
		ID: uuid.New().String(), Email: uuid.New().String() + "@nexus.test",
		PasswordHash: "x", DisplayName: "Test", CreatedAt: now, UpdatedAt: now,
	}
	if err := repository.NewUserRepo(pool).Create(ctx, user); err != nil {
		t.Fatalf("create user: %v", err)
	}
	vault := &model.Vault{ID: uuid.New().String(), UserID: user.ID, Name: "V", CreatedAt: now, UpdatedAt: now}
	if err := repository.NewVaultRepo(pool).Create(ctx, vault); err != nil {
		t.Fatalf("create vault: %v", err)
	}
	note, err := svc.CreateNote(ctx, vault.ID, "Note", "note.md", content, "device-a", "")
	if err != nil {
		t.Fatalf("create note: %v", err)
	}
	return note
}

func TestUpdateNote_RejectsStalePrevChecksum(t *testing.T) {
	pool := newIsolatedDB(t)
	svc := newTestSync(pool)
	note := seedNote(t, pool, svc, "v1")

	if _, _, err := svc.UpdateNote(context.Background(), NoteUpdate{
		NoteID: note.ID, Content: "v2", Title: "Note", Path: "note.md", PrevChecksum: note.Checksum, DeviceID: "a",
	}); err != nil {
		t.Fatalf("first update should succeed: %v", err)
	}

	// A second writer still holding the original checksum must get a conflict.
	_, conflict, err := svc.UpdateNote(context.Background(), NoteUpdate{
		NoteID: note.ID, Content: "v2-other", Title: "Note", Path: "note.md", PrevChecksum: note.Checksum, DeviceID: "b",
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("expected ErrConflict, got %v", err)
	}
	if conflict == nil || conflict.ServerContent != "v2" {
		t.Fatalf("conflict should carry the server's current content, got %+v", conflict)
	}
}

// Two saves that both read the same checksum must not both win: the check and
// the write have to be atomic, otherwise the later write silently discards the
// earlier one and no conflict is ever reported.
func TestUpdateNote_ConcurrentSavesWithSamePrevChecksumOnlyOneWins(t *testing.T) {
	pool := newIsolatedDB(t)
	svc := newTestSync(pool)
	note := seedNote(t, pool, svc, "original")

	const writers = 8
	var (
		wg        sync.WaitGroup
		start     = make(chan struct{})
		mu        sync.Mutex
		successes int
		conflicts int
		other     []error
	)
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, _, err := svc.UpdateNote(context.Background(), NoteUpdate{
				NoteID: note.ID, Content: fmt.Sprintf("edit from writer %d", i), Title: "Note",
				Path: "note.md", PrevChecksum: note.Checksum, DeviceID: fmt.Sprintf("dev-%d", i),
			})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				successes++
			case errors.Is(err, ErrConflict):
				conflicts++
			default:
				other = append(other, err)
			}
		}(i)
	}
	close(start)
	wg.Wait()

	if len(other) > 0 {
		t.Fatalf("unexpected errors: %v", other)
	}
	if successes != 1 || conflicts != writers-1 {
		t.Fatalf("got %d successes and %d conflicts, want exactly 1 and %d", successes, conflicts, writers-1)
	}

	versions, err := svc.GetVersions(context.Background(), note.ID)
	if err != nil {
		t.Fatalf("versions: %v", err)
	}
	if len(versions) != 2 { // the initial version plus the single winning edit
		t.Fatalf("expected 2 versions (initial + winner), got %d", len(versions))
	}
}
