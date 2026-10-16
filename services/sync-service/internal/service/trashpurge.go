package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/metrics"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// DefaultTrashRetention is how long a trashed note can be restored (#569).
const DefaultTrashRetention = 30 * 24 * time.Hour

// TrashPurgeLockKey is the Postgres advisory lock the purge job holds, so
// only one server instance purges at a time.
const TrashPurgeLockKey int64 = 0x4e6e547273 // "NnTrs"

// trashPurgeBatch is how many expired notes one database round trip fetches.
const trashPurgeBatch = 100

// trashPurgeStore is the database side of the purge job (*repository.NoteRepo).
type trashPurgeStore interface {
	ExpiredTrash(ctx context.Context, cutoff time.Time, limit int) ([]repository.TrashedRef, error)
	PurgeTrashed(ctx context.Context, vaultID, id string, cutoff time.Time) ([]string, bool, error)
	WithAdvisoryLock(ctx context.Context, key int64, fn func(context.Context) error) (bool, error)
}

var _ trashPurgeStore = (*repository.NoteRepo)(nil)

// purgeFileRemover deletes attachment objects, logging failures (*FileCleanup).
type purgeFileRemover interface {
	RemoveFiles(ctx context.Context, keys []string)
}

// purgeIndex drops a note from the search index (*search.Indexer).
type purgeIndex interface {
	DeleteNote(noteID string)
}

// TrashPurger deletes notes that have been in the trash longer than the
// retention (#569): each in its own transaction, conditional on it still
// being trashed that long, so a note restored while the job runs survives.
// Attachment files are removed after the commit, best-effort.
type TrashPurger struct {
	store     trashPurgeStore
	files     purgeFileRemover // nil when attachments are disabled
	index     purgeIndex       // nil without search
	retention time.Duration
	lockKey   int64
	now       func() time.Time
	// OnPurged, when set, is told about every purged note (to notify clients).
	OnPurged func(ctx context.Context, vaultID, noteID string)
}

// NewTrashPurger builds the purge job; files and index may be nil.
func NewTrashPurger(store trashPurgeStore, files purgeFileRemover, index purgeIndex, retention time.Duration) *TrashPurger {
	if retention <= 0 {
		retention = DefaultTrashRetention
	}
	return &TrashPurger{store: store, files: files, index: index, retention: retention, lockKey: TrashPurgeLockKey, now: time.Now}
}

// Run purges every note trashed more than the retention ago and returns how
// many it deleted. When another instance holds the purge lock it does nothing.
func (p *TrashPurger) Run(ctx context.Context) (int, error) {
	cutoff := p.now().UTC().Add(-p.retention)
	purged := 0
	ran, err := p.store.WithAdvisoryLock(ctx, p.lockKey, func(ctx context.Context) error {
		failed := map[string]bool{}
		for {
			refs, err := p.store.ExpiredTrash(ctx, cutoff, trashPurgeBatch+len(failed))
			if err != nil {
				return err
			}
			progress := false
			for _, ref := range refs {
				if failed[ref.ID] {
					continue
				}
				keys, ok, err := p.store.PurgeTrashed(ctx, ref.VaultID, ref.ID, cutoff)
				if err != nil {
					slog.Error("purge trashed note", "note_id", ref.ID, "error", err)
					failed[ref.ID] = true
					continue
				}
				// Not purged: restored (or emptied) since the list was read.
				// It drops out of the next ExpiredTrash either way.
				progress = true
				if !ok {
					continue
				}
				purged++
				metrics.NoteOps.WithLabelValues("purge").Inc()
				if p.files != nil {
					p.files.RemoveFiles(ctx, keys)
				}
				if p.index != nil {
					p.index.DeleteNote(ref.ID)
				}
				if p.OnPurged != nil {
					p.OnPurged(ctx, ref.VaultID, ref.ID)
				}
			}
			if !progress || len(refs) < trashPurgeBatch+len(failed) {
				return nil
			}
		}
	})
	if err != nil {
		return purged, err
	}
	if !ran {
		slog.Debug("trash purge skipped: another instance holds the lock")
	}
	return purged, nil
}
