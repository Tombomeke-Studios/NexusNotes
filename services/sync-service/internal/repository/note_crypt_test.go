package repository

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// seedVault inserts a user and a vault directly and returns the vault id.
func seedVault(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	userID, vaultID := uuid.NewString(), uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`, userID, userID+"@test"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO vaults (id, user_id, name) VALUES ($1, $2, 'v')`, vaultID, userID); err != nil {
		t.Fatal(err)
	}
	return vaultID
}

func rawColumn(t *testing.T, pool *pgxpool.Pool, query, id string) string {
	t.Helper()
	var v string
	if err := pool.QueryRow(context.Background(), query, id).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

// Note content and versions are stored encrypted and read back as plaintext (#354).
func TestNoteRepo_EncryptsContentAtRest(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	repo := NewNoteRepo(pool, testCipher(t))
	vaultID := seedVault(t, pool)
	const secret = "my secret diary entry"

	now := time.Now().UTC()
	note := &model.Note{ID: uuid.NewString(), VaultID: vaultID, Title: "Diary", Content: secret, Checksum: "c", CreatedAt: now, UpdatedAt: now}
	if err := repo.Create(ctx, note); err != nil {
		t.Fatal(err)
	}
	if note.Content != secret {
		t.Fatal("Create must not overwrite the caller's plaintext")
	}
	raw := rawColumn(t, pool, `SELECT content FROM notes WHERE id = $1`, note.ID)
	if strings.Contains(raw, secret) || !fieldcrypt.IsEncrypted(raw) {
		t.Fatalf("notes.content is stored readable: %q", raw)
	}

	got, err := repo.GetByID(ctx, note.ID)
	if err != nil || got.Content != secret {
		t.Fatalf("GetByID: %q, %v", got.Content, err)
	}
	list, err := repo.ListByVault(ctx, vaultID)
	if err != nil || len(list) != 1 || list[0].Content != secret {
		t.Fatalf("ListByVault: %+v, %v", list, err)
	}

	note.Content = secret + " v2"
	if err := repo.Update(ctx, note); err != nil {
		t.Fatal(err)
	}
	tx, err := repo.BeginTx(ctx)
	if err != nil {
		t.Fatal(err)
	}
	locked, err := repo.GetForUpdateTx(ctx, tx, note.ID)
	_ = tx.Rollback(ctx)
	if err != nil || locked.Content != secret+" v2" {
		t.Fatalf("GetForUpdateTx: %q, %v", locked.Content, err)
	}

	v := &model.NoteVersion{ID: uuid.NewString(), NoteID: note.ID, Content: secret, Checksum: "c", CreatedAt: now}
	if err := repo.CreateVersion(ctx, v); err != nil {
		t.Fatal(err)
	}
	raw = rawColumn(t, pool, `SELECT content FROM note_versions WHERE id = $1`, v.ID)
	if strings.Contains(raw, secret) || !fieldcrypt.IsEncrypted(raw) {
		t.Fatalf("note_versions.content is stored readable: %q", raw)
	}
	versions, err := repo.ListVersions(ctx, note.ID)
	if err != nil || len(versions) != 1 || versions[0].Content != secret {
		t.Fatalf("ListVersions: %+v, %v", versions, err)
	}
}

// Rows written before encryption at rest still read correctly.
func TestNoteRepo_ReadsLegacyPlaintext(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	repo := NewNoteRepo(pool, testCipher(t))
	vaultID := seedVault(t, pool)
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO notes (id, vault_id, title, content, checksum) VALUES ($1, $2, 't', 'old plaintext', 'c')`, id, vaultID); err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetByID(ctx, id)
	if err != nil || got.Content != "old plaintext" {
		t.Fatalf("legacy row: %q, %v", got.Content, err)
	}
}

// The search fallback still matches on (decrypted) content and returns a
// plaintext snippet.
func TestNoteRepo_SearchMatchesEncryptedContent(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	repo := NewNoteRepo(pool, testCipher(t))
	vaultID := seedVault(t, pool)
	now := time.Now().UTC()
	for i, n := range []struct{ title, content string }{
		{"Groceries", "buy Pineapple and milk"},
		{"Ideas", "nothing relevant"},
		{"Pineapple facts", "tropical"},
	} {
		note := &model.Note{ID: uuid.NewString(), VaultID: vaultID, Title: n.title, Content: n.content, Checksum: "c",
			CreatedAt: now, UpdatedAt: now.Add(time.Duration(i) * time.Second)}
		if err := repo.Create(ctx, note); err != nil {
			t.Fatal(err)
		}
	}

	results, err := repo.Search(ctx, vaultID, "pineapple")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 || results[0].Title != "Pineapple facts" || results[1].Title != "Groceries" {
		t.Fatalf("results = %+v", results)
	}
	if results[1].Snippet != "buy Pineapple and milk" {
		t.Fatalf("snippet = %q, want the plaintext", results[1].Snippet)
	}
}

// ForEach walks every note of every vault in batches, decrypted (#365).
func TestNoteRepo_ForEach(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	repo := NewNoteRepo(pool, testCipher(t))
	now := time.Now().UTC()
	want := map[string]string{}
	for _, vaultID := range []string{seedVault(t, pool), seedVault(t, pool)} {
		for i := 0; i < 3; i++ {
			n := &model.Note{ID: uuid.NewString(), VaultID: vaultID, Title: "t", Content: "secret " + uuid.NewString(), Checksum: "c", CreatedAt: now, UpdatedAt: now}
			if err := repo.Create(ctx, n); err != nil {
				t.Fatal(err)
			}
			want[n.ID] = n.Content
		}
	}

	got := map[string]string{}
	batches := 0
	err := repo.ForEach(ctx, 4, func(notes []model.Note) error {
		batches++
		for _, n := range notes {
			got[n.ID] = n.Content
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if batches != 2 || len(got) != len(want) {
		t.Fatalf("batches = %d, notes = %d; want 2 batches of 6 notes", batches, len(got))
	}
	for id, content := range want {
		if got[id] != content {
			t.Fatalf("note %s: content %q, want the plaintext", id, got[id])
		}
	}
}
