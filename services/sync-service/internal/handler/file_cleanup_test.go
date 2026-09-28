package handler

import (
	"context"
	"net/http"
	"reflect"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
)

// fakeFileCleanup records which attachment files a handler asked to remove.
type fakeFileCleanup struct {
	vaults []string
	keys   []string
}

func (f *fakeFileCleanup) RemoveVaultFiles(_ context.Context, vaultIDs ...string) {
	f.vaults = append(f.vaults, vaultIDs...)
}

func (f *fakeFileCleanup) NoteFiles(_ context.Context, _ string) []string {
	return []string{"v/a.png", "v/b.pdf"}
}

func (f *fakeFileCleanup) RemoveFiles(_ context.Context, keys []string) {
	f.keys = append(f.keys, keys...)
}

// Deleting a vault you do not own must be a 404 and, above all, must never
// remove the owner's attachment files.
func TestVaultDelete_OnlyTheOwnerDeletesAndOnlyThenAreFilesRemoved(t *testing.T) {
	pool := newIsolatedDB(t)
	owner, other := seedUser(t, pool), seedUser(t, pool)
	vaultID := seedVaultFor(t, pool, owner)
	vaultRepo := repository.NewVaultRepo(pool)
	h := NewVaultHandler(vaultRepo, repository.NewUserRepo(pool), repository.NewVaultMemberRepo(pool), false)
	files := &fakeFileCleanup{}
	h.SetFileCleanup(files)

	rec := call(h.Delete, http.MethodDelete, other, map[string]string{"id": vaultID})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-owner delete status = %d, want 404", rec.Code)
	}
	if len(files.vaults) != 0 {
		t.Fatalf("a non-owner delete removed files: %v", files.vaults)
	}
	if _, err := vaultRepo.GetByID(context.Background(), vaultID); err != nil {
		t.Fatalf("vault should still exist: %v", err)
	}

	rec = call(h.Delete, http.MethodDelete, owner, map[string]string{"id": vaultID})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("owner delete status = %d, want 204", rec.Code)
	}
	if !reflect.DeepEqual(files.vaults, []string{vaultID}) {
		t.Fatalf("removed vault files = %v, want [%s]", files.vaults, vaultID)
	}
}

func TestNoteDelete_RemovesTheNotesFilesOnlyAfterASuccessfulDelete(t *testing.T) {
	f := newNoteAccessFixture(t)
	files := &fakeFileCleanup{}
	f.h.SetFileCleanup(files)

	rec := call(f.h.Delete, http.MethodDelete, f.viewer, map[string]string{
		"vaultId": f.ownerVault, "noteId": f.note.ID,
	})
	if rec.Code != http.StatusForbidden || len(files.keys) != 0 {
		t.Fatalf("viewer delete: status %d, removed %v; want 403 and nothing removed", rec.Code, files.keys)
	}

	rec = call(f.h.Delete, http.MethodDelete, f.owner, map[string]string{
		"vaultId": f.ownerVault, "noteId": f.note.ID,
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("owner delete status = %d, want 204", rec.Code)
	}
	if !reflect.DeepEqual(files.keys, []string{"v/a.png", "v/b.pdf"}) {
		t.Fatalf("removed keys = %v", files.keys)
	}
}

// recordingStore stands in for object storage and records what was deleted.
type recordingStore struct{ deleted []string }

func (r *recordingStore) Delete(_ context.Context, key string) error {
	r.deleted = append(r.deleted, key)
	return nil
}

func (r *recordingStore) DeletePrefix(context.Context, string) error { return nil }

// With the real cleanup and a real attachment row: the note's storage keys
// must be read before the delete, because the attachment rows cascade away
// with the note.
func TestNoteDelete_ReadsTheFileKeysBeforeTheRowsCascadeAway(t *testing.T) {
	f := newNoteAccessFixture(t)
	ctx := context.Background()
	attachRepo := repository.NewAttachmentRepo(f.pool)
	att := &model.Attachment{
		NoteID: f.note.ID, VaultID: f.ownerVault, Filename: "a.png",
		MimeType: "image/png", SizeBytes: 1, StoragePath: f.ownerVault + "/a.png",
	}
	if err := attachRepo.Create(ctx, att); err != nil {
		t.Fatalf("seed attachment: %v", err)
	}
	store := &recordingStore{}
	f.h.SetFileCleanup(service.NewFileCleanup(store, attachRepo))

	rec := call(f.h.Delete, http.MethodDelete, f.owner, map[string]string{
		"vaultId": f.ownerVault, "noteId": f.note.ID,
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("owner delete status = %d, want 204", rec.Code)
	}
	if !reflect.DeepEqual(store.deleted, []string{f.ownerVault + "/a.png"}) {
		t.Fatalf("deleted objects = %v, want the seeded attachment's key", store.deleted)
	}
}
