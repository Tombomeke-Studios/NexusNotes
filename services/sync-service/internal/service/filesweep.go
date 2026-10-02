package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

type objectLister interface {
	ListObjects(ctx context.Context, fn func(key string, modified time.Time) error) error
	Delete(ctx context.Context, key string) error
}

type attachmentKeyChecker interface {
	KnownKeys(ctx context.Context, keys []string) (map[string]bool, error)
}

// OrphanGrace is how old a file must be before the sweeper may remove it: an
// upload stores the file first and its attachment row a moment later.
const OrphanGrace = time.Hour

// OrphanSweeper removes attachment files that no attachment row refers to
// any more (#316): left behind when a best-effort cleanup failed, or deleted
// before files were cleaned up at all. Only files older than the grace period
// are considered, and nothing is deleted when the database cannot be asked.
type OrphanSweeper struct {
	store objectLister
	rows  attachmentKeyChecker
	grace time.Duration
	batch int
	now   func() time.Time
}

func NewOrphanSweeper(store objectLister, rows attachmentKeyChecker) *OrphanSweeper {
	return &OrphanSweeper{store: store, rows: rows, grace: OrphanGrace, batch: 500, now: time.Now}
}

// Sweep removes every orphaned file and returns how many it removed.
func (s *OrphanSweeper) Sweep(ctx context.Context) (int, error) {
	cutoff := s.now().Add(-s.grace)
	removed := 0
	var pending []string
	flush := func() error {
		if len(pending) == 0 {
			return nil
		}
		known, err := s.rows.KnownKeys(ctx, pending)
		if err != nil {
			return fmt.Errorf("check attachment rows: %w", err)
		}
		for _, key := range pending {
			if known[key] {
				continue
			}
			if err := s.store.Delete(ctx, key); err != nil {
				slog.Warn("orphan sweep: delete file", "key", key, "error", err)
				continue
			}
			removed++
		}
		pending = pending[:0]
		return nil
	}
	err := s.store.ListObjects(ctx, func(key string, modified time.Time) error {
		if modified.After(cutoff) {
			return nil
		}
		pending = append(pending, key)
		if len(pending) >= s.batch {
			return flush()
		}
		return nil
	})
	if err == nil {
		err = flush()
	}
	if removed > 0 {
		slog.Info("orphan sweep removed attachment files", "count", removed)
	}
	return removed, err
}
