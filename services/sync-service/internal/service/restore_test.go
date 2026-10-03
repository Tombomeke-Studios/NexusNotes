package service

import (
	"context"
	"errors"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// Restoring copies a version back into the note as a new version, so the
// state it replaces stays in the history (#417).
func TestRestoreVersion(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	svc := newTestSync(t, pool)
	vaultID := seedVault(t, pool)
	a := seedNoteIn(t, svc, vaultID, "A", "first text")
	other := seedNoteIn(t, svc, vaultID, "B", "other note")

	updated, _, err := svc.UpdateNote(ctx, NoteUpdate{NoteID: a.ID, Title: "A", Path: a.Path, Content: "second text", PrevChecksum: a.Checksum, DeviceID: "laptop"})
	if err != nil {
		t.Fatal(err)
	}
	versions, _ := svc.GetVersions(ctx, a.ID)
	oldest := versions[len(versions)-1]

	if _, _, err := svc.RestoreVersion(ctx, a.ID, oldest.ID, "stale", "laptop"); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale checksum: err = %v, want ErrConflict", err)
	}
	otherVersions, _ := svc.GetVersions(ctx, other.ID)
	if _, _, err := svc.RestoreVersion(ctx, a.ID, otherVersions[0].ID, updated.Checksum, "laptop"); !errors.Is(err, repository.ErrVersionNotFound) {
		t.Fatalf("another note's version: err = %v, want ErrVersionNotFound", err)
	}

	// The same device saved "second text" a moment ago: without a forced new
	// version, the restore would overwrite that snapshot.
	restored, _, err := svc.RestoreVersion(ctx, a.ID, oldest.ID, updated.Checksum, "laptop")
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored.Content != "first text" || restored.Checksum != oldest.Checksum || restored.Title != "A" {
		t.Fatalf("restored note: %+v", restored)
	}
	after, _ := svc.GetVersions(ctx, a.ID)
	if len(after) != len(versions)+1 {
		t.Fatalf("%d versions after restore, want %d", len(after), len(versions)+1)
	}
	kept, err := svc.GetVersion(ctx, a.ID, after[1].ID)
	if err != nil || kept.Content != "second text" {
		t.Fatalf("the replaced text is not kept in the history: %+v, %v", kept, err)
	}
}
