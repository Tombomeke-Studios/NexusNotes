package service

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// fakeTrash is an in-memory trash: note id -> when it was trashed.
type fakeTrash struct {
	trashed   map[string]time.Time
	vault     map[string]string
	files     map[string][]string
	locked    bool // another instance holds the purge lock
	failIDs   map[string]bool
	restoreOn string // restored right before its purge (a race with the job)
	lockKey   int64
}

func (f *fakeTrash) ExpiredTrash(_ context.Context, cutoff time.Time, limit int) ([]repository.TrashedRef, error) {
	var refs []repository.TrashedRef
	for id, at := range f.trashed {
		if !at.After(cutoff) {
			refs = append(refs, repository.TrashedRef{ID: id, VaultID: f.vault[id]})
		}
	}
	sort.Slice(refs, func(i, j int) bool { return refs[i].ID < refs[j].ID })
	if len(refs) > limit {
		refs = refs[:limit]
	}
	return refs, nil
}

func (f *fakeTrash) PurgeTrashed(_ context.Context, vaultID, id string, cutoff time.Time) ([]string, bool, error) {
	if f.failIDs[id] {
		return nil, false, errors.New("database hiccup")
	}
	if id == f.restoreOn {
		delete(f.trashed, id)
	}
	at, ok := f.trashed[id]
	if !ok || f.vault[id] != vaultID || at.After(cutoff) {
		return nil, false, nil
	}
	delete(f.trashed, id)
	return f.files[id], true, nil
}

func (f *fakeTrash) WithAdvisoryLock(ctx context.Context, key int64, fn func(context.Context) error) (bool, error) {
	f.lockKey = key
	if f.locked {
		return false, nil
	}
	return true, fn(ctx)
}

type fakeRemover struct{ removed []string }

func (r *fakeRemover) RemoveFiles(_ context.Context, keys []string) {
	r.removed = append(r.removed, keys...)
}

type fakeIndex struct{ deleted []string }

func (x *fakeIndex) DeleteNote(id string) { x.deleted = append(x.deleted, id) }

func newPurgeFixture(now time.Time) (*fakeTrash, *fakeRemover, *fakeIndex, *TrashPurger) {
	store := &fakeTrash{
		trashed: map[string]time.Time{
			"old":    now.Add(-31 * 24 * time.Hour),
			"edge":   now.Add(-30 * 24 * time.Hour),
			"recent": now.Add(-29 * 24 * time.Hour),
		},
		vault:   map[string]string{"old": "v1", "edge": "v1", "recent": "v2"},
		files:   map[string][]string{"old": {"v1/a.png", "v1/b.pdf"}},
		failIDs: map[string]bool{},
	}
	files, index := &fakeRemover{}, &fakeIndex{}
	p := NewTrashPurger(store, files, index, 30*24*time.Hour)
	p.now = func() time.Time { return now }
	return store, files, index, p
}

func TestTrashPurger_PurgesOnlyNotesPastRetention(t *testing.T) {
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	store, files, index, p := newPurgeFixture(now)
	var notified []string
	p.OnPurged = func(_ context.Context, vaultID, noteID string) { notified = append(notified, vaultID+"/"+noteID) }

	n, err := p.Run(context.Background())
	if err != nil || n != 2 {
		t.Fatalf("Run = %d, %v; want 2 purged", n, err)
	}
	if _, ok := store.trashed["recent"]; !ok || len(store.trashed) != 1 {
		t.Fatalf("left in trash: %v, want only the recent note", store.trashed)
	}
	if !reflect.DeepEqual(files.removed, []string{"v1/a.png", "v1/b.pdf"}) {
		t.Errorf("removed files %v", files.removed)
	}
	if !reflect.DeepEqual(index.deleted, []string{"edge", "old"}) {
		t.Errorf("index deletions %v", index.deleted)
	}
	if !reflect.DeepEqual(notified, []string{"v1/edge", "v1/old"}) {
		t.Errorf("notified %v", notified)
	}
	if store.lockKey != TrashPurgeLockKey {
		t.Errorf("lock key %x, want the purge lock", store.lockKey)
	}
}

func TestTrashPurger_SkipsWhenAnotherInstanceHoldsTheLock(t *testing.T) {
	store, files, _, p := newPurgeFixture(time.Now())
	store.locked = true
	if n, err := p.Run(context.Background()); err != nil || n != 0 {
		t.Fatalf("Run = %d, %v; want nothing done", n, err)
	}
	if len(store.trashed) != 3 || len(files.removed) != 0 {
		t.Fatal("purged without holding the lock")
	}
}

func TestTrashPurger_NoteRestoredMeanwhileSurvives(t *testing.T) {
	store, files, index, p := newPurgeFixture(time.Now())
	store.restoreOn = "old"
	n, err := p.Run(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("Run = %d, %v; want only the other expired note", n, err)
	}
	if len(files.removed) != 0 {
		t.Errorf("removed the restored note's files: %v", files.removed)
	}
	if !reflect.DeepEqual(index.deleted, []string{"edge"}) {
		t.Errorf("index deletions %v, want only the purged note", index.deleted)
	}
}

func TestTrashPurger_ContinuesPastAFailingNote(t *testing.T) {
	store, _, _, p := newPurgeFixture(time.Now())
	store.failIDs["edge"] = true
	n, err := p.Run(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("Run = %d, %v; want the other note purged", n, err)
	}
	if _, ok := store.trashed["edge"]; !ok {
		t.Fatal("the failing note vanished")
	}
}

func TestTrashPurger_WorksThroughMoreThanOneBatch(t *testing.T) {
	now := time.Now()
	store, _, _, p := newPurgeFixture(now)
	for i := 0; i < 2*trashPurgeBatch+5; i++ {
		id := fmt.Sprintf("bulk-%03d", i)
		store.trashed[id] = now.Add(-40 * 24 * time.Hour)
		store.vault[id] = "v3"
	}
	n, err := p.Run(context.Background())
	if err != nil || n != 2*trashPurgeBatch+5+2 {
		t.Fatalf("Run = %d, %v", n, err)
	}
	if len(store.trashed) != 1 {
		t.Fatalf("left %d in trash, want 1", len(store.trashed))
	}
}

func TestTrashPurger_DefaultRetention(t *testing.T) {
	if p := NewTrashPurger(&fakeTrash{}, nil, nil, 0); p.retention != DefaultTrashRetention {
		t.Fatalf("retention %v, want the 30-day default", p.retention)
	}
}
