package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
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
		{ID: a.ID, Title: "e2ee:title-a", Path: "e2ee:path-a", Content: "iv:cipher-a", Checksum: "plain-sum-a", BaseChecksum: a.Checksum},
		{ID: b.ID, Title: "e2ee:title-b", Path: "e2ee:path-b", Content: "iv:cipher-b", Checksum: "plain-sum-b", BaseChecksum: b.Checksum},
	}

	// Refusals leave the vault untouched.
	if err := svc.ConvertVaultToE2EE(ctx, vaultID, "someone-else", meta, full, nil); !errors.Is(err, repository.ErrVaultNotFound) {
		t.Fatalf("not the owner: err = %v, want ErrVaultNotFound", err)
	}
	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, meta, full[:1], nil); !errors.Is(err, ErrConvertNotesChanged) {
		t.Fatalf("a note missing: err = %v, want ErrConvertNotesChanged", err)
	}
	stale := append([]ConvertNote(nil), full...)
	stale[1].BaseChecksum = "outdated"
	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, meta, stale, nil); !errors.Is(err, ErrConvertNotesChanged) {
		t.Fatalf("a note changed meanwhile: err = %v, want ErrConvertNotesChanged", err)
	}
	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, nil, full, nil); !errors.Is(err, ErrConvertMissingMeta) {
		t.Fatalf("no key material: err = %v, want ErrConvertMissingMeta", err)
	}
	untitled := append([]ConvertNote(nil), full...)
	untitled[0].Title = ""
	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, meta, untitled, nil); !errors.Is(err, ErrConvertMissingTitle) {
		t.Fatalf("a note without its sealed title: err = %v, want ErrConvertMissingTitle", err)
	}
	if got, _ := svc.GetNote(ctx, a.ID); got.Content != "alpha v2 #tag [[B]]" {
		t.Fatalf("a refused conversion changed the note: %q", got.Content)
	}

	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, meta, full, nil); err != nil {
		t.Fatalf("convert: %v", err)
	}
	vault, err := repository.NewVaultRepo(pool, fieldcrypttest.Cipher(t)).GetByID(ctx, vaultID)
	if err != nil || vault.Encryption != "e2ee" || string(vault.EncryptionMeta) != `{"v": 1}` && string(vault.EncryptionMeta) != `{"v":1}` {
		t.Fatalf("vault after convert: %+v, %v", vault, err)
	}
	if got, _ := svc.GetNote(ctx, a.ID); got.Content != "iv:cipher-a" || got.Checksum != "plain-sum-a" ||
		got.Title != "e2ee:title-a" || got.Path != "e2ee:path-a" {
		t.Fatalf("note A after convert: %+v", got)
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

	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, meta, full, nil); !errors.Is(err, ErrConvertNotStandard) {
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
		[]ConvertNote{{ID: n.ID, Title: "t", Content: "x", Checksum: "y", BaseChecksum: n.Checksum}}, nil)
	if !errors.Is(err, ErrConvertHasAttachments) {
		t.Fatalf("err = %v, want ErrConvertHasAttachments", err)
	}
}

// Links that exist when a vault is converted are sealed with it (#410).
func TestConvertVaultToE2EE_SealsLinks(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	svc := newTestSync(t, pool)
	links := repository.NewLinkedFileRepo(pool, fieldcrypttest.Cipher(t))
	vaultID := seedVault(t, pool)
	owner := vaultOwner(t, pool, vaultID)
	n := seedNoteIn(t, svc, vaultID, "A", "alpha")
	lf := &model.LinkedFile{VaultID: vaultID, DisplayName: "Docs", SourceType: model.LinkedSourceURL, SourceRef: "https://example.com", ReadOnly: true}
	if err := links.Create(ctx, lf); err != nil {
		t.Fatal(err)
	}
	notes := []ConvertNote{{ID: n.ID, Title: "e2ee:t", Path: "e2ee:p", Content: "c", Checksum: "s", BaseChecksum: n.Checksum}}
	meta := json.RawMessage(`{}`)

	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, meta, notes, nil); !errors.Is(err, ErrConvertNotesChanged) {
		t.Fatalf("link missing: err = %v, want ErrConvertNotesChanged", err)
	}
	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, meta, notes, []ConvertLink{{ID: lf.ID, DisplayName: "e2ee:n"}}); !errors.Is(err, ErrConvertMissingLinkField) {
		t.Fatalf("link without source: err = %v, want ErrConvertMissingLinkField", err)
	}
	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, meta, notes, []ConvertLink{{ID: "other", DisplayName: "e2ee:n", SourceRef: "e2ee:s"}}); !errors.Is(err, ErrConvertNotesChanged) {
		t.Fatalf("unknown link: err = %v, want ErrConvertNotesChanged", err)
	}
	if got, _ := links.GetByID(ctx, lf.ID); got.SourceRef != "https://example.com" {
		t.Fatalf("a refused conversion changed the link: %+v", got)
	}

	if err := svc.ConvertVaultToE2EE(ctx, vaultID, owner, meta, notes, []ConvertLink{{ID: lf.ID, DisplayName: "e2ee:n", SourceRef: "e2ee:s"}}); err != nil {
		t.Fatalf("convert: %v", err)
	}
	got, err := links.GetByID(ctx, lf.ID)
	if err != nil || got.DisplayName != "e2ee:n" || got.SourceRef != "e2ee:s" {
		t.Fatalf("link after convert: %+v, %v", got, err)
	}
}
