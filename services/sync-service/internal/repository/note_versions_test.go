package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// Saves within the snapshot window of the same device update one version
// instead of adding one per autosave (#413).
func TestNoteRepo_RecordVersionCoalesces(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	repo := NewNoteRepo(pool, testCipher(t))
	vaultID := seedVault(t, pool)
	t0 := time.Now().UTC().Add(-time.Hour).Truncate(time.Microsecond) // Postgres precision
	note := &model.Note{ID: uuid.NewString(), VaultID: vaultID, Title: "t", Content: "c", Checksum: "c", CreatedAt: t0, UpdatedAt: t0}
	if err := repo.Create(ctx, note); err != nil {
		t.Fatal(err)
	}
	record := func(content, device string, at time.Time) {
		t.Helper()
		tx, err := repo.BeginTx(ctx)
		if err != nil {
			t.Fatal(err)
		}
		v := &model.NoteVersion{ID: uuid.NewString(), NoteID: note.ID, Content: content, Checksum: "sum-" + content, DeviceID: device, CreatedAt: at}
		if err := repo.RecordVersionTx(ctx, tx, v, VersionSnapshotWindow); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}

	record("a1", "laptop", t0)
	record("a2", "laptop", t0.Add(time.Minute))
	record("a3", "laptop", t0.Add(4*time.Minute))  // still the same snapshot
	record("b1", "phone", t0.Add(5*time.Minute))   // another device: new snapshot
	record("a4", "laptop", t0.Add(6*time.Minute))  // after the phone's: new snapshot
	record("a5", "laptop", t0.Add(12*time.Minute)) // window over: new snapshot

	versions, err := repo.ListVersions(ctx, note.ID)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, v := range versions {
		got = append(got, v.Checksum)
	}
	want := []string{"sum-a5", "sum-a4", "sum-b1", "sum-a3"}
	if len(got) != len(want) {
		t.Fatalf("versions %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("versions %v, want %v", got, want)
		}
	}
	first := versions[3]
	if !first.CreatedAt.Equal(t0) || !first.UpdatedAt.Equal(t0.Add(4*time.Minute)) {
		t.Fatalf("coalesced snapshot: created %v updated %v, want %v / %v", first.CreatedAt, first.UpdatedAt, t0, t0.Add(4*time.Minute))
	}
}
