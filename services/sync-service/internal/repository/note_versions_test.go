package repository

import (
	"context"
	"fmt"
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
		if err := repo.RecordVersionTx(ctx, tx, v, VersionSnapshotWindow, model.VersionRetention{KeepCount: 50}); err != nil {
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

// A vault's retention keeps the newest N versions and drops versions older
// than D days, but never a note's newest version (#418).
func TestNoteRepo_VersionRetention(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	repo := NewNoteRepo(pool, testCipher(t))
	vaults := NewVaultRepo(pool, testCipher(t))
	vaultID := seedVault(t, pool)
	now := time.Now().UTC()
	mk := func(title string) *model.Note {
		n := &model.Note{ID: uuid.NewString(), VaultID: vaultID, Title: title, Content: "c", Checksum: "c", CreatedAt: now, UpdatedAt: now}
		if err := repo.Create(ctx, n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	busy, quiet := mk("busy"), mk("quiet")
	record := func(n *model.Note, content string, daysAgo int, keep model.VersionRetention) {
		t.Helper()
		tx, err := repo.BeginTx(ctx)
		if err != nil {
			t.Fatal(err)
		}
		// A new device each time: no coalescing.
		v := &model.NoteVersion{ID: uuid.NewString(), NoteID: n.ID, Content: content, Checksum: content, DeviceID: uuid.NewString(), CreatedAt: now.AddDate(0, 0, -daysAgo)}
		if err := repo.RecordVersionTx(ctx, tx, v, VersionSnapshotWindow, keep); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	checksums := func(n *model.Note) []string {
		t.Helper()
		list, err := repo.ListVersionInfo(ctx, n.ID)
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, v := range list {
			out = append(out, v.Checksum)
		}
		return out
	}

	loose := model.VersionRetention{KeepCount: 50}
	for i, days := range []int{40, 30, 20, 10, 1} {
		record(busy, fmt.Sprintf("b%d", i), days, loose)
	}
	record(quiet, "q0", 90, loose)

	// Pruning on a new version applies the count.
	record(busy, "b5", 0, model.VersionRetention{KeepCount: 4})
	if got := checksums(busy); fmt.Sprint(got) != "[b5 b4 b3 b2]" {
		t.Fatalf("after keep-count 4: %v", got)
	}

	// The vault-wide pass applies the vault's setting, age included.
	if err := vaults.SetVersionRetention(ctx, vaultID, model.VersionRetention{KeepCount: 50, KeepDays: 15}); err != nil {
		t.Fatal(err)
	}
	if got, err := vaults.GetVersionRetention(ctx, vaultID); err != nil || got.KeepDays != 15 || got.KeepCount != 50 {
		t.Fatalf("retention read back: %+v, %v", got, err)
	}
	if _, err := repo.PruneVersions(ctx, vaultID); err != nil {
		t.Fatal(err)
	}
	if got := checksums(busy); fmt.Sprint(got) != "[b5 b4 b3]" {
		t.Fatalf("after keep-days 15: %v", got)
	}
	// The only version of an untouched note survives any age limit.
	if got := checksums(quiet); fmt.Sprint(got) != "[q0]" {
		t.Fatalf("quiet note: %v", got)
	}
	if err := vaults.SetVersionRetention(ctx, vaultID, model.VersionRetention{KeepCount: 0}); err == nil {
		t.Fatal("keep count 0 accepted")
	}
}
