package service

import (
	"context"
	"errors"
	"sort"
	"testing"
	"time"
)

type fakeBucket struct {
	objects map[string]time.Time
	deleted []string
}

func (b *fakeBucket) ListObjects(_ context.Context, fn func(key string, modified time.Time) error) error {
	keys := make([]string, 0, len(b.objects))
	for k := range b.objects {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if err := fn(k, b.objects[k]); err != nil {
			return err
		}
	}
	return nil
}

func (b *fakeBucket) Delete(_ context.Context, key string) error {
	b.deleted = append(b.deleted, key)
	delete(b.objects, key)
	return nil
}

type fakeKnownKeys struct {
	known map[string]bool
	calls int
	err   error
}

func (f *fakeKnownKeys) KnownKeys(_ context.Context, keys []string) (map[string]bool, error) {
	f.calls++
	out := map[string]bool{}
	for _, k := range keys {
		if f.known[k] {
			out[k] = true
		}
	}
	return out, f.err
}

// Files with no attachment row, past the grace period, are removed; live
// files and fresh uploads (whose row may not exist yet) never are (#316).
func TestOrphanSweeper(t *testing.T) {
	now := time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
	old := now.Add(-2 * time.Hour)
	bucket := &fakeBucket{objects: map[string]time.Time{
		"v1/live.png":      old,
		"v1/orphan.png":    old,
		"gone-vault/x.pdf": old,
		"v1/uploading.png": now.Add(-time.Minute),
	}}
	rows := &fakeKnownKeys{known: map[string]bool{"v1/live.png": true}}
	s := &OrphanSweeper{store: bucket, rows: rows, grace: time.Hour, batch: 2, now: func() time.Time { return now }}

	n, err := s.Sweep(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(bucket.deleted)
	if n != 2 || len(bucket.deleted) != 2 || bucket.deleted[0] != "gone-vault/x.pdf" || bucket.deleted[1] != "v1/orphan.png" {
		t.Fatalf("removed %d: %v; want the two old orphans", n, bucket.deleted)
	}
	if rows.calls < 2 {
		t.Fatalf("keys were checked in %d call(s); want batches of 2", rows.calls)
	}
}

// When the database cannot be asked, nothing is deleted.
func TestOrphanSweeper_DatabaseErrorDeletesNothing(t *testing.T) {
	now := time.Now()
	bucket := &fakeBucket{objects: map[string]time.Time{"v1/a.png": now.Add(-24 * time.Hour)}}
	s := &OrphanSweeper{store: bucket, rows: &fakeKnownKeys{err: errors.New("db down")}, grace: time.Hour, batch: 10, now: func() time.Time { return now }}
	if _, err := s.Sweep(context.Background()); err == nil {
		t.Fatal("a failing lookup must be an error")
	}
	if len(bucket.deleted) != 0 {
		t.Fatalf("deleted %v without knowing which files are live", bucket.deleted)
	}
}
