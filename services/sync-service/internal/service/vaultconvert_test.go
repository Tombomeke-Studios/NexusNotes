package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

func vaultOwner(t *testing.T, pool *pgxpool.Pool, vaultID string) string {
	t.Helper()
	var owner string
	if err := pool.QueryRow(context.Background(), `SELECT user_id FROM vaults WHERE id = $1`, vaultID).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	return owner
}

func countRows(t *testing.T, pool *pgxpool.Pool, query, vaultID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), query, vaultID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// Converting a standard vault to e2ee swaps every note's content for the
// client's ciphertext in one transaction and drops the plaintext the server
// still holds about it (#361).
func TestConvertVaultToE2EE(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	svc := newTestSync(t, pool)
	vaultID := seedVault(t, pool)
	owner := vaultOwner(t, pool, vaultID)
	a := seedNoteIn(t, svc, vaultID, "A", "alpha #tag links to [[B]]")
	b := seedNoteIn(t, svc, vaultID, "B", "beta")
	if _, _, err := svc.UpdateNote(ctx, NoteUpdate{NoteID: a.ID, Content: "alpha v2 #tag [[B]]", Title: "A", Path: a.Path, PrevChecksum: a.Checksum}); err != nil {
		t.Fatal(err)
	}
	a, _ = svc.GetNote(ctx, a.ID)
	meta := json.RawMessage(`{"v":1}`)
	full := []ConvertNote{
		{ID: a.ID, Content: "iv:cipher-a", Checksum: "plain-sum-a", BaseChecksum: a.Checksum},
		{ID: b.ID, Content: "iv:cipher-b", Checksum: "plain-sum-b", BaseChecksum: b.Checksum},
	}

	// Refusals leave the vault untouched.
	if err := svc.ConvertVaultToE2EE(ctx, vaultID, "someone-else", meta, full); !errors.Is(err, repository.ErrVaultNotFound) {
		t.Fatalf("not the owner: err = %v, want ErrVaultNotFound", err)
	}
	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, meta, full[:1]); !errors.Is(err, ErrConvertNotesChanged) {
		t.Fatalf("a note missing: err = %v, want ErrConvertNotesChanged", err)
	}
	stale := append([]ConvertNote(nil), full...)
	stale[1].BaseChecksum = "outdated"
	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, meta, stale); !errors.Is(err, ErrConvertNotesChanged) {
		t.Fatalf("a note changed meanwhile: err = %v, want ErrConvertNotesChanged", err)
	}
	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, nil, full); !errors.Is(err, ErrConvertMissingMeta) {
		t.Fatalf("no key material: err = %v, want ErrConvertMissingMeta", err)
	}
	if got, _ := svc.GetNote(ctx, a.ID); got.Content != "alpha v2 #tag [[B]]" {
		t.Fatalf("a refused conversion changed the note: %q", got.Content)
	}

	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, meta, full); err != nil {
		t.Fatalf("convert: %v", err)
	}
	vault, err := repository.NewVaultRepo(pool, fieldcrypttest.Cipher(t)).GetByID(ctx, vaultID)
	if err != nil || vault.Encryption != "e2ee" || string(vault.EncryptionMeta) != `{"v": 1}` && string(vault.EncryptionMeta) != `{"v":1}` {
		t.Fatalf("vault after convert: %+v, %v", vault, err)
	}
	if got, _ := svc.GetNote(ctx, a.ID); got.Content != "iv:cipher-a" || got.Checksum != "plain-sum-a" {
		t.Fatalf("note A after convert: %q / %q", got.Content, got.Checksum)
	}
	for name, q := range map[string]string{
		"versions": `SELECT count(*) FROM note_versions v JOIN notes n ON n.id = v.note_id WHERE n.vault_id = $1`,
		"tags":     `SELECT count(*) FROM note_tags t JOIN notes n ON n.id = t.note_id WHERE n.vault_id = $1`,
		"links":    `SELECT count(*) FROM note_links WHERE vault_id = $1`,
	} {
		if n := countRows(t, pool, q, vaultID); n != 0 {
			t.Errorf("%d %s left: they hold plaintext of an e2ee vault", n, name)
		}
	}

	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, meta, full); !errors.Is(err, ErrConvertNotStandard) {
		t.Fatalf("second conversion: err = %v, want ErrConvertNotStandard", err)
	}
}

func TestConvertVaultToE2EE_RefusesAttachments(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	svc := newTestSync(t, pool)
	vaultID := seedVault(t, pool)
	n := seedNoteIn(t, svc, vaultID, "A", "alpha")
	if _, err := pool.Exec(ctx, `INSERT INTO attachments (note_id, vault_id, filename, mime_type, size_bytes, storage_path) VALUES ($1, $2, 'a.png', 'image/png', 1, 'k')`, n.ID, vaultID); err != nil {
		t.Fatal(err)
	}
	err := svc.ConvertVaultToE2EE(ctx, vaultID, vaultOwner(t, pool, vaultID), json.RawMessage(`{}`),
		[]ConvertNote{{ID: n.ID, Content: "x", Checksum: "y", BaseChecksum: n.Checksum}})
	if !errors.Is(err, ErrConvertHasAttachments) {
		t.Fatalf("err = %v, want ErrConvertHasAttachments", err)
	}
}
