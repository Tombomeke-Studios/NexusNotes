package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

func TestAttachmentRepo_KnownKeys(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	vaultID := seedVault(t, pool)
	notes := NewNoteRepo(pool, testCipher(t))
	now := time.Now().UTC()
	n := &model.Note{ID: uuid.NewString(), VaultID: vaultID, Title: "t", Content: "c", Checksum: "c", CreatedAt: now, UpdatedAt: now}
	if err := notes.Create(ctx, n); err != nil {
		t.Fatal(err)
	}
	repo := NewAttachmentRepo(pool)
	if err := repo.Create(ctx, &model.Attachment{NoteID: n.ID, VaultID: vaultID, Filename: "a.png", MimeType: "image/png", SizeBytes: 1, StoragePath: vaultID + "/live.png"}); err != nil {
		t.Fatal(err)
	}
	known, err := repo.KnownKeys(ctx, []string{vaultID + "/live.png", vaultID + "/orphan.png"})
	if err != nil {
		t.Fatal(err)
	}
	if !known[vaultID+"/live.png"] || known[vaultID+"/orphan.png"] {
		t.Fatalf("known = %v", known)
	}
}
