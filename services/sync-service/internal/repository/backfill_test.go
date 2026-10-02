package repository

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
)

// legacyRows writes one plaintext row into every encrypted column, the way
// data looked before encryption at rest, and returns the ids involved.
type legacyIDs struct{ user, vault, note, version, file, device string }

func insertLegacyRows(t *testing.T, pool *pgxpool.Pool) legacyIDs {
	t.Helper()
	ctx := context.Background()
	ids := legacyIDs{uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), "", uuid.NewString()}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec(`INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, 'Old@Example.com', 'x', 'Old Name')`, ids.user)
	exec(`INSERT INTO vaults (id, user_id, name) VALUES ($1, $2, 'Old Vault')`, ids.vault, ids.user)
	exec(`INSERT INTO notes (id, vault_id, title, content, checksum) VALUES ($1, $2, 't', 'old content', 'c')`, ids.note, ids.vault)
	exec(`INSERT INTO note_versions (id, note_id, content, checksum) VALUES ($1, $2, 'old version', 'c')`, ids.version, ids.note)
	if err := pool.QueryRow(ctx, `INSERT INTO linked_files (vault_id, display_name, source_type, source_ref) VALUES ($1, 'Old File', 'url', 'https://old.example') RETURNING id`, ids.vault).Scan(&ids.file); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO linked_file_annotations (linked_file_id, user_id, content) VALUES ($1, $2, 'old remark')`, ids.file, ids.user)
	exec(`INSERT INTO devices (id, user_id, name) VALUES ($1, $2, 'Old Laptop')`, ids.device, ids.user)
	return ids
}

// readsBack checks every repository returns the original plaintext.
func readsBack(t *testing.T, pool *pgxpool.Pool, crypt *fieldcrypt.Cipher, ids legacyIDs) {
	t.Helper()
	ctx := context.Background()
	u, err := NewUserRepo(pool, crypt).GetByEmail(ctx, "old@example.com")
	if err != nil || u.ID != ids.user || u.Email != "Old@Example.com" || u.DisplayName != "Old Name" {
		t.Fatalf("user: %+v, %v", u, err)
	}
	if v, err := NewVaultRepo(pool, crypt).GetByID(ctx, ids.vault); err != nil || v.Name != "Old Vault" {
		t.Fatalf("vault: %+v, %v", v, err)
	}
	notes := NewNoteRepo(pool, crypt)
	if n, err := notes.GetByID(ctx, ids.note); err != nil || n.Content != "old content" {
		t.Fatalf("note: %+v, %v", n, err)
	}
	if vs, err := notes.ListVersions(ctx, ids.note); err != nil || len(vs) != 1 || vs[0].Content != "old version" {
		t.Fatalf("versions: %+v, %v", vs, err)
	}
	files := NewLinkedFileRepo(pool, crypt)
	if f, err := files.GetByID(ctx, ids.file); err != nil || f.DisplayName != "Old File" || f.SourceRef != "https://old.example" {
		t.Fatalf("linked file: %+v, %v", f, err)
	}
	if a, err := files.GetAnnotation(ctx, ids.file, ids.user); err != nil || a != "old remark" {
		t.Fatalf("annotation: %q, %v", a, err)
	}
	if ds, err := NewDeviceRepo(pool, crypt).ListByUser(ctx, ids.user); err != nil || len(ds) != 1 || ds[0].Name != "Old Laptop" {
		t.Fatalf("devices: %+v, %v", ds, err)
	}
}

// assertAllSealed fails when any encrypted column still holds a value that is
// not under the cipher's current key, or a user lacks a current email index.
func assertAllSealed(t *testing.T, pool *pgxpool.Pool, crypt *fieldcrypt.Cipher) {
	t.Helper()
	for _, c := range encryptedColumns {
		var n int
		q := `SELECT count(*) FROM ` + c.table + ` WHERE NOT starts_with(` + c.column + `, $1)`
		if err := pool.QueryRow(context.Background(), q, crypt.CurrentPrefix()).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Errorf("%s.%s: %d rows not under the current key", c.table, c.column, n)
		}
	}
	var unindexed int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE email_index IS NULL`).Scan(&unindexed); err != nil {
		t.Fatal(err)
	}
	if unindexed != 0 {
		t.Errorf("%d users without an email index", unindexed)
	}
}

func TestBackfillEncryptsLegacyRows(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	crypt := testCipher(t)
	ids := insertLegacyRows(t, pool)

	n, err := BackfillEncryption(ctx, pool, crypt, 2)
	if err != nil {
		t.Fatal(err)
	}
	if n != 9 {
		t.Errorf("rewrote %d values, want 9 (one per encrypted column)", n)
	}
	assertAllSealed(t, pool, crypt)
	readsBack(t, pool, crypt, ids)

	again, err := BackfillEncryption(ctx, pool, crypt, 2)
	if err != nil || again != 0 {
		t.Fatalf("second run rewrote %d values (%v), want 0", again, err)
	}
}

func TestBackfillReencryptsAfterKeyRotation(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	ids := insertLegacyRows(t, pool)
	if _, err := BackfillEncryption(ctx, pool, testCipher(t), 100); err != nil {
		t.Fatal(err)
	}

	rotated, err := fieldcrypt.New("1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100", []string{fieldcrypttest.Key})
	if err != nil {
		t.Fatal(err)
	}
	n, err := BackfillEncryption(ctx, pool, rotated, 100)
	if err != nil || n != 9 {
		t.Fatalf("rotation rewrote %d values (%v), want 9", n, err)
	}
	assertAllSealed(t, pool, rotated)

	// Readable with only the new key: the old one can now be retired.
	onlyNew, err := fieldcrypt.New("1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100", nil)
	if err != nil {
		t.Fatal(err)
	}
	readsBack(t, pool, onlyNew, ids)
}
