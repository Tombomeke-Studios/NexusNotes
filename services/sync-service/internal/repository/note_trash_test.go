package repository

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// trashFixture is one vault with a live note and a note trashed at trashedAt.
type trashFixture struct {
	repo           *NoteRepo
	vaultID        string
	live, trashed  *model.Note
	trashedAt      time.Time
	attachmentID   string
	attachmentKeys []string
}

func newTrashFixture(t *testing.T) *trashFixture {
	t.Helper()
	pool := newIsolatedDB(t)
	ctx := context.Background()
	f := &trashFixture{repo: NewNoteRepo(pool, testCipher(t)), vaultID: seedVault(t, pool)}
	now := time.Now().UTC().Truncate(time.Microsecond)
	mk := func(title string) *model.Note {
		n := &model.Note{ID: uuid.NewString(), VaultID: f.vaultID, Title: title, Path: "Folder", Content: title + " text", Checksum: title, CreatedAt: now, UpdatedAt: now}
		if err := f.repo.Create(ctx, n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	f.live, f.trashed = mk("Live"), mk("Binned")
	if err := f.repo.CreateVersion(ctx, &model.NoteVersion{ID: uuid.NewString(), NoteID: f.trashed.ID, Content: "v", Checksum: "v", DeviceID: "d", CreatedAt: now}); err != nil {
		t.Fatal(err)
	}
	att := &model.Attachment{NoteID: f.trashed.ID, VaultID: f.vaultID, Filename: "a.png", MimeType: "image/png", SizeBytes: 3, StoragePath: f.vaultID + "/a.png"}
	if err := NewAttachmentRepo(pool).Create(ctx, att); err != nil {
		t.Fatal(err)
	}
	f.attachmentID, f.attachmentKeys = att.ID, []string{att.StoragePath}

	f.trashedAt = now.Add(-31 * 24 * time.Hour)
	tx, err := f.repo.BeginTx(ctx)
	if err != nil {
		t.Fatal(err)
	}
	moved, err := f.repo.TrashTx(ctx, tx, f.vaultID, []string{f.trashed.ID, "no-such-note"}, f.trashedAt)
	if err != nil || len(moved) != 1 || moved[0].ID != f.trashed.ID || !moved[0].DeletedAt.Equal(f.trashedAt) {
		t.Fatalf("TrashTx = %+v, %v", moved, err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestNoteRepo_TrashedNotesLeaveLiveReads(t *testing.T) {
	f := newTrashFixture(t)
	ctx := context.Background()

	if _, err := f.repo.GetByID(ctx, f.trashed.ID); !errors.Is(err, ErrNoteNotFound) {
		t.Errorf("GetByID: %v, want not found", err)
	}
	list, _ := f.repo.ListByVault(ctx, f.vaultID)
	page, _, _ := f.repo.ListPage(ctx, f.vaultID, 10, NoteCursor{})
	if len(list) != 1 || list[0].ID != f.live.ID || len(page) != 1 || page[0].ID != f.live.ID {
		t.Errorf("lists hold %d / %d notes, want only the live one", len(list), len(page))
	}
	// The search index rebuild reads every note through ForEach.
	var all []string
	_ = f.repo.ForEach(ctx, 10, func(batch []model.Note) error {
		for _, n := range batch {
			all = append(all, n.ID)
		}
		return nil
	})
	if len(all) != 1 || all[0] != f.live.ID {
		t.Errorf("ForEach saw %v, want only the live note", all)
	}
	if hits, _ := f.repo.Search(ctx, f.vaultID, "text"); len(hits) != 1 || hits[0].ID != f.live.ID {
		t.Errorf("Search = %+v, want only the live note", hits)
	}
	live, _ := f.repo.LiveIDs(ctx, f.vaultID, []string{f.live.ID, f.trashed.ID})
	if !live[f.live.ID] || live[f.trashed.ID] {
		t.Errorf("LiveIDs = %v", live)
	}
	if _, err := NewAttachmentRepo(f.repo.pool).GetByID(ctx, f.attachmentID); !errors.Is(err, ErrAttachmentNotFound) {
		t.Errorf("attachment lookup: %v", err)
	}

	// The trash itself, and the export, still see it.
	trash, _ := f.repo.ListTrash(ctx, f.vaultID)
	if len(trash) != 1 || trash[0].ID != f.trashed.ID || trash[0].Path != "Folder" || !trash[0].DeletedAt.Equal(f.trashedAt) {
		t.Errorf("ListTrash = %+v", trash)
	}
	withContent, _ := f.repo.ListTrashedNotes(ctx, f.vaultID)
	if len(withContent) != 1 || withContent[0].Content != "Binned text" {
		t.Errorf("ListTrashedNotes = %+v", withContent)
	}
	if vault, err := f.repo.TrashedVaultID(ctx, f.trashed.ID); err != nil || vault != f.vaultID {
		t.Errorf("TrashedVaultID = %q, %v", vault, err)
	}
	if _, err := f.repo.TrashedVaultID(ctx, f.live.ID); !errors.Is(err, ErrNoteNotFound) {
		t.Errorf("TrashedVaultID of a live note: %v", err)
	}
	stats, _ := f.repo.StorageStats(ctx, f.vaultID)
	if stats.Notes != 2 || stats.TrashedNotes != 1 || stats.Attachments != 1 {
		t.Errorf("stats = %+v, want trashed notes counted and reported", stats)
	}
}

func TestNoteRepo_RestoreBringsTheNoteBack(t *testing.T) {
	f := newTrashFixture(t)
	ctx := context.Background()
	tx, _ := f.repo.BeginTx(ctx)
	n, err := f.repo.RestoreTx(ctx, tx, f.vaultID, f.trashed.ID)
	if err != nil || n.Path != "Folder" || n.Content != "Binned text" {
		t.Fatalf("RestoreTx = %+v, %v", n, err)
	}
	if _, err := f.repo.RestoreTx(ctx, tx, f.vaultID, f.live.ID); !errors.Is(err, ErrNoteNotFound) {
		t.Fatalf("restoring a live note: %v", err)
	}
	_ = tx.Rollback(ctx)
	tx, _ = f.repo.BeginTx(ctx)
	if _, err := f.repo.RestoreTx(ctx, tx, "other-vault", f.trashed.ID); !errors.Is(err, ErrNoteNotFound) {
		t.Fatalf("restoring under another vault: %v", err)
	}
	_ = tx.Rollback(ctx)
}

func TestNoteRepo_PurgeTrashedIsConditional(t *testing.T) {
	f := newTrashFixture(t)
	ctx := context.Background()

	// Trashed after the cutoff: too recent.
	if _, ok, err := f.repo.PurgeTrashed(ctx, f.vaultID, f.trashed.ID, f.trashedAt.Add(-time.Hour)); ok || err != nil {
		t.Fatalf("purged a note trashed after the cutoff (%v)", err)
	}
	// A live note is never purged.
	if _, ok, err := f.repo.PurgeTrashed(ctx, f.vaultID, f.live.ID, time.Time{}); ok || err != nil {
		t.Fatalf("purged a live note (%v)", err)
	}
	if refs, _ := f.repo.ExpiredTrash(ctx, time.Now().Add(-30*24*time.Hour), 10); len(refs) != 1 || refs[0].ID != f.trashed.ID || refs[0].VaultID != f.vaultID {
		t.Fatalf("ExpiredTrash = %+v", refs)
	}
	keys, ok, err := f.repo.PurgeTrashed(ctx, f.vaultID, f.trashed.ID, time.Now().Add(-30*24*time.Hour))
	if !ok || err != nil || len(keys) != 1 || keys[0] != f.attachmentKeys[0] {
		t.Fatalf("PurgeTrashed = %v, %v, %v", keys, ok, err)
	}
	var versions, attachments int
	_ = f.repo.pool.QueryRow(ctx, `SELECT count(*) FROM note_versions WHERE note_id = $1`, f.trashed.ID).Scan(&versions)
	_ = f.repo.pool.QueryRow(ctx, `SELECT count(*) FROM attachments WHERE note_id = $1`, f.trashed.ID).Scan(&attachments)
	if versions != 0 || attachments != 0 {
		t.Fatalf("left %d versions and %d attachment rows", versions, attachments)
	}
	if trash, _ := f.repo.ListTrash(ctx, f.vaultID); len(trash) != 0 {
		t.Fatalf("still in the trash: %+v", trash)
	}
}

func TestNoteRepo_PurgeSkipsANoteRestoredMeanwhile(t *testing.T) {
	f := newTrashFixture(t)
	ctx := context.Background()
	tx, _ := f.repo.BeginTx(ctx)
	if _, err := f.repo.RestoreTx(ctx, tx, f.vaultID, f.trashed.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := f.repo.PurgeTrashed(ctx, f.vaultID, f.trashed.ID, time.Now()); ok || err != nil {
		t.Fatalf("purged a restored note (%v)", err)
	}
	if _, err := f.repo.GetByID(ctx, f.trashed.ID); err != nil {
		t.Fatalf("restored note gone: %v", err)
	}
}

func TestNoteRepo_HasTrashTx(t *testing.T) {
	f := newTrashFixture(t)
	ctx := context.Background()
	has := func() bool {
		t.Helper()
		tx, err := f.repo.BeginTx(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()
		got, err := f.repo.HasTrashTx(ctx, tx, f.vaultID)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	if !has() {
		t.Fatal("a trash with a note reads as empty")
	}
	if _, ok, err := f.repo.PurgeTrashed(ctx, f.vaultID, f.trashed.ID, time.Time{}); !ok || err != nil {
		t.Fatalf("purge: %v %v", ok, err)
	}
	if has() {
		t.Fatal("an emptied trash reads as holding notes")
	}
}

// Only one holder of the purge lock at a time (one server instance purges).
func TestNoteRepo_WithAdvisoryLockIsExclusive(t *testing.T) {
	pool := newIsolatedDB(t)
	repo := NewNoteRepo(pool, testCipher(t))
	ctx := context.Background()
	// Not the real purge lock: other test packages may run at the same time.
	key := time.Now().UnixNano()

	ran, err := repo.WithAdvisoryLock(ctx, key, func(ctx context.Context) error {
		inner, err := repo.WithAdvisoryLock(ctx, key, func(context.Context) error {
			t.Error("ran while another holder had the lock")
			return nil
		})
		if inner || err != nil {
			t.Errorf("second holder: ran %v, err %v", inner, err)
		}
		return nil
	})
	if !ran || err != nil {
		t.Fatalf("first holder: ran %v, err %v", ran, err)
	}
	// Released afterwards.
	again, err := repo.WithAdvisoryLock(ctx, key, func(context.Context) error { return nil })
	if !again || err != nil {
		t.Fatalf("after release: ran %v, err %v", again, err)
	}
}
