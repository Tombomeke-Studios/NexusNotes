package service

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// cleanupTimeout bounds the storage calls of one cleanup.
const cleanupTimeout = 30 * time.Second

// detached keeps the caller's values (request id for logs) but not its
// cancellation: the database rows are already gone when files are removed, so
// a client disconnecting at that moment must not leave the files behind.
func detached(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
}

type objectRemover interface {
	Delete(ctx context.Context, key string) error
	DeletePrefix(ctx context.Context, prefix string) error
}

type noteAttachmentLister interface {
	ListByNote(ctx context.Context, noteID string) ([]model.Attachment, error)
}

// FileCleanup removes attachment bytes from object storage once the database
// rows that referenced them are gone (account, vault or note deletion). Storage
// failures are logged, never returned: the deletion the user asked for has
// already happened. A nil *FileCleanup (attachments disabled) is a no-op.
type FileCleanup struct {
	store       objectRemover
	attachments noteAttachmentLister
}

func NewFileCleanup(store objectRemover, attachments noteAttachmentLister) *FileCleanup {
	return &FileCleanup{store: store, attachments: attachments}
}

// NoteFiles returns the storage keys of a note's attachments. Call it before
// deleting the note: the rows cascade away with it.
func (c *FileCleanup) NoteFiles(ctx context.Context, noteID string) []string {
	if c == nil {
		return nil
	}
	atts, err := c.attachments.ListByNote(ctx, noteID)
	if err != nil {
		slog.Warn("list attachments for cleanup", "note_id", noteID, "error", err)
		return nil
	}
	keys := make([]string, 0, len(atts))
	for _, a := range atts {
		keys = append(keys, a.StoragePath)
	}
	return keys
}

// RemoveFiles deletes the given objects, continuing past individual failures.
func (c *FileCleanup) RemoveFiles(ctx context.Context, keys []string) {
	if c == nil || len(keys) == 0 {
		return
	}
	ctx, cancel := detached(ctx)
	defer cancel()
	for _, key := range keys {
		if err := c.store.Delete(ctx, key); err != nil {
			slog.Warn("delete attachment file", "key", key, "error", err)
		}
	}
}

// RemoveVaultFiles deletes every object stored under each vault's prefix
// ("<vaultID>/"). Blank ids or ids containing a slash are skipped so a bad
// value can never widen the prefix to other vaults or the whole bucket.
func (c *FileCleanup) RemoveVaultFiles(ctx context.Context, vaultIDs ...string) {
	if c == nil {
		return
	}
	ctx, cancel := detached(ctx)
	defer cancel()
	for _, id := range vaultIDs {
		id = strings.TrimSpace(id)
		if id == "" || strings.Contains(id, "/") {
			continue
		}
		if err := c.store.DeletePrefix(ctx, id+"/"); err != nil {
			slog.Warn("delete vault attachment files", "vault_id", id, "error", err)
		}
	}
}
