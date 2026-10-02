package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/search"
)

// fakeMeili answers the stats call with count and records indexed documents.
type fakeMeili struct {
	mu    sync.Mutex
	count int
	docs  []search.NoteDoc
}

func (f *fakeMeili) server(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/indexes/notes/stats":
			_ = json.NewEncoder(w).Encode(map[string]int{"numberOfDocuments": f.count})
		case r.Method == http.MethodPost && r.URL.Path == "/indexes/notes/documents":
			var docs []search.NoteDoc
			_ = json.NewDecoder(r.Body).Decode(&docs)
			f.docs = append(f.docs, docs...)
			w.WriteHeader(http.StatusAccepted)
		default:
			w.WriteHeader(http.StatusAccepted)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// An empty index (lost volume, restore without search data) is rebuilt from
// the database on startup, so the index can stay out of backups (#365).
func TestRebuildSearchIndexIfEmpty(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	notes := repository.NewNoteRepo(pool, fieldcrypttest.Cipher(t))
	vaults := repository.NewVaultRepo(pool, fieldcrypttest.Cipher(t))

	plainVault := seedVault(t, pool)
	e2eeVault := seedVault(t, pool)
	if _, err := pool.Exec(ctx, `UPDATE vaults SET encryption = 'e2ee', encryption_meta = '{}' WHERE id = $1`, e2eeVault); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	plain := &model.Note{ID: uuid.NewString(), VaultID: plainVault, Title: "Plain", Content: "hello #tag", Checksum: "c", CreatedAt: now, UpdatedAt: now}
	cipher := &model.Note{ID: uuid.NewString(), VaultID: e2eeVault, Title: "Secret", Content: "iv:ciphertext", Checksum: "c", CreatedAt: now, UpdatedAt: now}
	for _, n := range []*model.Note{plain, cipher} {
		if err := notes.Create(ctx, n); err != nil {
			t.Fatal(err)
		}
	}

	meili := &fakeMeili{}
	svc := NewSyncService(notes, vaults, repository.NewLinkRepo(pool), repository.NewTagRepo(pool), repository.NewAliasRepo(pool),
		search.NewIndexer(meili.server(t).URL, "k"))

	n, err := svc.RebuildSearchIndexIfEmpty(ctx)
	if err != nil || n != 2 {
		t.Fatalf("rebuild indexed %d (%v), want 2", n, err)
	}
	byID := map[string]search.NoteDoc{}
	for _, d := range meili.docs {
		byID[d.ID] = d
	}
	if d := byID[plain.ID]; d.Content != "hello #tag" || len(d.Tags) != 1 || d.Tags[0] != "tag" {
		t.Fatalf("standard-vault doc = %+v, want content and tags", d)
	}
	if d := byID[cipher.ID]; d.Title != "Secret" || d.Content != "" || len(d.Tags) != 0 {
		t.Fatalf("e2ee-vault doc = %+v, want no content or tags (ciphertext)", d)
	}

	// A populated index is left alone.
	meili.mu.Lock()
	meili.count, meili.docs = 5, nil
	meili.mu.Unlock()
	if n, err := svc.RebuildSearchIndexIfEmpty(ctx); err != nil || n != 0 || len(meili.docs) != 0 {
		t.Fatalf("populated index: indexed %d (%v), want nothing", n, err)
	}
}
