package repository

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// assertSealed fails when the raw column value is readable or not an envelope.
func assertSealed(t *testing.T, pool *pgxpool.Pool, query, id, plaintext string) {
	t.Helper()
	raw := rawColumn(t, pool, query, id)
	if strings.Contains(raw, plaintext) || !fieldcrypt.IsEncrypted(raw) {
		t.Fatalf("%s stores %q readable: %q", query, plaintext, raw)
	}
}

func newUser(t *testing.T, users *UserRepo, displayName string) *model.User {
	t.Helper()
	now := time.Now().UTC()
	u := &model.User{ID: uuid.NewString(), Email: uuid.NewString() + "@test", PasswordHash: "x", DisplayName: displayName, CreatedAt: now, UpdatedAt: now}
	if err := users.Create(context.Background(), u); err != nil {
		t.Fatal(err)
	}
	return u
}

// User display names, vault names, linked files, annotations and device
// names are encrypted at rest (#355).
func TestRepos_EncryptFreeTextFieldsAtRest(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	crypt := testCipher(t)
	users := NewUserRepo(pool, crypt)
	vaults := NewVaultRepo(pool, crypt)
	members := NewVaultMemberRepo(pool, crypt)
	files := NewLinkedFileRepo(pool, crypt)
	devices := NewDeviceRepo(pool, crypt)

	// Users
	owner := newUser(t, users, "Alice Owner")
	assertSealed(t, pool, `SELECT display_name FROM users WHERE id = $1`, owner.ID, "Alice Owner")
	if u, err := users.GetByID(ctx, owner.ID); err != nil || u.DisplayName != "Alice Owner" {
		t.Fatalf("GetByID: %+v, %v", u, err)
	}
	if u, err := users.GetByEmail(ctx, owner.Email); err != nil || u.DisplayName != "Alice Owner" {
		t.Fatalf("GetByEmail: %+v, %v", u, err)
	}

	// Vaults: listed in name order even though the names are ciphertext.
	now := time.Now().UTC()
	var vaultIDs []string
	for _, name := range []string{"zebra", "Apple", "mango"} {
		v := &model.Vault{ID: uuid.NewString(), UserID: owner.ID, Name: name, CreatedAt: now, UpdatedAt: now}
		if err := vaults.Create(ctx, v); err != nil {
			t.Fatal(err)
		}
		if v.Name != name {
			t.Fatal("Create must not overwrite the caller's vault name")
		}
		assertSealed(t, pool, `SELECT name FROM vaults WHERE id = $1`, v.ID, name)
		vaultIDs = append(vaultIDs, v.ID)
	}
	list, err := vaults.ListByUser(ctx, owner.ID)
	if err != nil || len(list) != 3 || list[0].Name != "Apple" || list[1].Name != "mango" || list[2].Name != "zebra" {
		t.Fatalf("ListByUser: %+v, %v", list, err)
	}
	if v, err := vaults.GetByID(ctx, vaultIDs[0]); err != nil || v.Name != "zebra" {
		t.Fatalf("GetByID: %+v, %v", v, err)
	}
	if err := vaults.Update(ctx, &model.Vault{ID: vaultIDs[0], UserID: owner.ID, Name: "zebra renamed", UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	assertSealed(t, pool, `SELECT name FROM vaults WHERE id = $1`, vaultIDs[0], "zebra renamed")
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	v, err := vaults.GetByIDTx(ctx, tx, vaultIDs[0])
	_ = tx.Rollback(ctx)
	if err != nil || v.Name != "zebra renamed" {
		t.Fatalf("GetByIDTx: %+v, %v", v, err)
	}

	// Members see the shared vault's name and each other's display names.
	member := newUser(t, users, "Bob Member")
	if err := members.Add(ctx, vaultIDs[1], member.ID, model.VaultRoleEditor, owner.ID); err != nil {
		t.Fatal(err)
	}
	shared, err := members.ListSharedVaults(ctx, member.ID)
	if err != nil || len(shared) != 1 || shared[0].Name != "Apple" {
		t.Fatalf("ListSharedVaults: %+v, %v", shared, err)
	}
	ms, err := members.List(ctx, vaultIDs[1])
	if err != nil || len(ms) != 1 || ms[0].DisplayName != "Bob Member" {
		t.Fatalf("members List: %+v, %v", ms, err)
	}

	// Linked files and annotations.
	lf := &model.LinkedFile{VaultID: vaultIDs[1], DisplayName: "Spec", SourceType: model.LinkedSourceURL, SourceRef: "https://example.com/private-spec.md"}
	if err := files.Create(ctx, lf); err != nil {
		t.Fatal(err)
	}
	assertSealed(t, pool, `SELECT display_name FROM linked_files WHERE id = $1`, lf.ID, "Spec")
	assertSealed(t, pool, `SELECT source_ref FROM linked_files WHERE id = $1`, lf.ID, "private-spec")
	if got, err := files.GetByID(ctx, lf.ID); err != nil || got.DisplayName != "Spec" || got.SourceRef != lf.SourceRef {
		t.Fatalf("linked GetByID: %+v, %v", got, err)
	}
	lf2 := &model.LinkedFile{VaultID: vaultIDs[1], DisplayName: "Appendix", SourceType: model.LinkedSourceURL, SourceRef: "https://example.com/a"}
	if err := files.Create(ctx, lf2); err != nil {
		t.Fatal(err)
	}
	lfs, err := files.ListByVault(ctx, vaultIDs[1])
	if err != nil || len(lfs) != 2 || lfs[0].DisplayName != "Appendix" || lfs[1].DisplayName != "Spec" {
		t.Fatalf("linked ListByVault: %+v, %v", lfs, err)
	}
	if err := files.UpsertAnnotation(ctx, lf.ID, owner.ID, "my private remark"); err != nil {
		t.Fatal(err)
	}
	var rawAnn string
	if err := pool.QueryRow(ctx, `SELECT content FROM linked_file_annotations WHERE linked_file_id = $1`, lf.ID).Scan(&rawAnn); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(rawAnn, "private remark") || !fieldcrypt.IsEncrypted(rawAnn) {
		t.Fatalf("annotation stored readable: %q", rawAnn)
	}
	if ann, err := files.GetAnnotation(ctx, lf.ID, owner.ID); err != nil || ann != "my private remark" {
		t.Fatalf("GetAnnotation: %q, %v", ann, err)
	}

	// Devices.
	deviceID := uuid.NewString()
	if err := devices.Upsert(ctx, deviceID, owner.ID, "Alice's laptop", "windows"); err != nil {
		t.Fatal(err)
	}
	assertSealed(t, pool, `SELECT name FROM devices WHERE id = $1`, deviceID, "Alice")
	ds, err := devices.ListByUser(ctx, owner.ID)
	if err != nil || len(ds) != 1 || ds[0].Name != "Alice's laptop" {
		t.Fatalf("devices ListByUser: %+v, %v", ds, err)
	}
}

// Email addresses are encrypted at rest and found through a blind index (#356).
func TestUserRepo_EncryptsEmailWithBlindIndex(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	crypt := testCipher(t)
	users := NewUserRepo(pool, crypt)
	now := time.Now().UTC()

	u := &model.User{ID: uuid.NewString(), Email: "Alice@Example.com", PasswordHash: "x", CreatedAt: now, UpdatedAt: now}
	if err := users.Create(ctx, u); err != nil {
		t.Fatal(err)
	}
	assertSealed(t, pool, `SELECT email FROM users WHERE id = $1`, u.ID, "lice@")
	if idx := rawColumn(t, pool, `SELECT email_index FROM users WHERE id = $1`, u.ID); idx == "" || strings.Contains(strings.ToLower(idx), "example") {
		t.Fatalf("email_index = %q, want an opaque token", idx)
	}

	got, err := users.GetByEmail(ctx, "  alice@example.COM ")
	if err != nil || got.ID != u.ID || got.Email != "Alice@Example.com" {
		t.Fatalf("GetByEmail (other case, spaces): %+v, %v", got, err)
	}
	if got, err := users.GetByID(ctx, u.ID); err != nil || got.Email != "Alice@Example.com" {
		t.Fatalf("GetByID: %+v, %v", got, err)
	}
	if _, err := users.GetByEmail(ctx, "bob@example.com"); err != ErrUserNotFound {
		t.Fatalf("unknown email: err = %v, want ErrUserNotFound", err)
	}

	dup := &model.User{ID: uuid.NewString(), Email: "ALICE@example.com", PasswordHash: "x", CreatedAt: now, UpdatedAt: now}
	if err := users.Create(ctx, dup); err != ErrDuplicateEmail {
		t.Fatalf("same address in another case: err = %v, want ErrDuplicateEmail", err)
	}

	// A row written before encryption at rest (plaintext, no index) is still
	// found, and still blocks a second account with its address.
	legacyID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, password_hash) VALUES ($1, 'Legacy@Example.com', 'x')`, legacyID); err != nil {
		t.Fatal(err)
	}
	if got, err := users.GetByEmail(ctx, "legacy@example.com"); err != nil || got.ID != legacyID || got.Email != "Legacy@Example.com" {
		t.Fatalf("legacy GetByEmail: %+v, %v", got, err)
	}
	again := &model.User{ID: uuid.NewString(), Email: "legacy@example.com", PasswordHash: "x", CreatedAt: now, UpdatedAt: now}
	if err := users.Create(ctx, again); err != ErrDuplicateEmail {
		t.Fatalf("legacy duplicate: err = %v, want ErrDuplicateEmail", err)
	}

	// Members list the decrypted address.
	vaults := NewVaultRepo(pool, crypt)
	members := NewVaultMemberRepo(pool, crypt)
	v := &model.Vault{ID: uuid.NewString(), UserID: legacyID, Name: "v", CreatedAt: now, UpdatedAt: now}
	if err := vaults.Create(ctx, v); err != nil {
		t.Fatal(err)
	}
	if err := members.Add(ctx, v.ID, u.ID, model.VaultRoleViewer, legacyID); err != nil {
		t.Fatal(err)
	}
	ms, err := members.List(ctx, v.ID)
	if err != nil || len(ms) != 1 || ms[0].Email != "Alice@Example.com" {
		t.Fatalf("members List: %+v, %v", ms, err)
	}
}

// After a key rotation, accounts indexed under the old key still sign in and
// still block duplicates.
func TestUserRepo_EmailLookupSurvivesKeyRotation(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	before := NewUserRepo(pool, testCipher(t))
	u := &model.User{ID: uuid.NewString(), Email: "rot@example.com", PasswordHash: "x", CreatedAt: now, UpdatedAt: now}
	if err := before.Create(ctx, u); err != nil {
		t.Fatal(err)
	}

	rotated, err := fieldcrypt.New("1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100", []string{fieldcrypttest.Key})
	if err != nil {
		t.Fatal(err)
	}
	after := NewUserRepo(pool, rotated)
	if got, err := after.GetByEmail(ctx, "rot@example.com"); err != nil || got.ID != u.ID || got.Email != "rot@example.com" {
		t.Fatalf("GetByEmail after rotation: %+v, %v", got, err)
	}
	dup := &model.User{ID: uuid.NewString(), Email: "ROT@example.com", PasswordHash: "x", CreatedAt: now, UpdatedAt: now}
	if err := after.Create(ctx, dup); err != ErrDuplicateEmail {
		t.Fatalf("duplicate after rotation: err = %v, want ErrDuplicateEmail", err)
	}
}

// Renaming a vault that does not exist or is not the caller's is not a
// success (#384).
func TestVaultRepo_UpdateReportsNoMatch(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	repo := NewVaultRepo(pool, testCipher(t))
	vaultID := seedVault(t, pool)
	now := time.Now().UTC()
	err := repo.Update(ctx, &model.Vault{ID: vaultID, UserID: "someone-else", Name: "x", UpdatedAt: now})
	if err != ErrVaultNotFound {
		t.Fatalf("not the owner: err = %v, want ErrVaultNotFound", err)
	}
	if err := repo.Update(ctx, &model.Vault{ID: uuid.NewString(), UserID: "x", Name: "x", UpdatedAt: now}); err != ErrVaultNotFound {
		t.Fatalf("unknown vault: err = %v, want ErrVaultNotFound", err)
	}
}
