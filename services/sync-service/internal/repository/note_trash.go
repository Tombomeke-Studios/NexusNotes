package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// Trash (#569): a trashed note keeps its row, with deleted_at set, until it is
// restored or purged. Every live read in this package filters on
// deleted_at IS NULL; only the functions below see trashed notes.

// TrashTx moves the vault's live notes among ids to the trash, stamped at,
// and returns the ones it moved (without content; PurgeAt left for the
// caller). Ids that are not live notes of the vault are skipped.
func (r *NoteRepo) TrashTx(ctx context.Context, tx pgx.Tx, vaultID string, ids []string, at time.Time) ([]model.TrashedNote, error) {
	rows, err := tx.Query(ctx,
		`UPDATE notes SET deleted_at = $3
		 WHERE vault_id = $1 AND id = ANY($2) AND deleted_at IS NULL
		 RETURNING id, vault_id, path, title, checksum, created_at, updated_at, deleted_at`,
		vaultID, ids, at,
	)
	if err != nil {
		return nil, fmt.Errorf("trash notes: %w", err)
	}
	defer rows.Close()
	notes := []model.TrashedNote{}
	for rows.Next() {
		var n model.TrashedNote
		if err := rows.Scan(&n.ID, &n.VaultID, &n.Path, &n.Title, &n.Checksum, &n.CreatedAt, &n.UpdatedAt, &n.DeletedAt); err != nil {
			return nil, fmt.Errorf("scan trashed note: %w", err)
		}
		notes = append(notes, n)
	}
	return notes, rows.Err()
}

// RestoreTx takes a note of the vault out of the trash, at its original path,
// and returns it with its content. ErrNoteNotFound when it is not in the
// vault's trash.
func (r *NoteRepo) RestoreTx(ctx context.Context, tx pgx.Tx, vaultID, id string) (*model.Note, error) {
	var n model.Note
	err := tx.QueryRow(ctx,
		`UPDATE notes SET deleted_at = NULL
		 WHERE id = $1 AND vault_id = $2 AND deleted_at IS NOT NULL
		 RETURNING id, vault_id, path, title, content, checksum, created_at, updated_at`,
		id, vaultID,
	).Scan(&n.ID, &n.VaultID, &n.Path, &n.Title, &n.Content, &n.Checksum, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoteNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("restore note: %w", err)
	}
	if err := r.open(fieldNoteContent, &n.Content); err != nil {
		return nil, err
	}
	return &n, nil
}

// TrashedVaultID returns the vault of a note that is in the trash;
// ErrNoteNotFound when there is no such trashed note.
func (r *NoteRepo) TrashedVaultID(ctx context.Context, id string) (string, error) {
	var vaultID string
	err := r.pool.QueryRow(ctx,
		`SELECT vault_id FROM notes WHERE id = $1 AND deleted_at IS NOT NULL`, id,
	).Scan(&vaultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNoteNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get trashed note: %w", err)
	}
	return vaultID, nil
}

// ListTrash lists the vault's trashed notes, most recently trashed first,
// without content. Titles and paths come back as stored (sealed in e2ee
// vaults). PurgeAt is left for the caller, which knows the retention.
func (r *NoteRepo) ListTrash(ctx context.Context, vaultID string) ([]model.TrashedNote, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, vault_id, path, title, checksum, created_at, updated_at, deleted_at
		 FROM notes WHERE vault_id = $1 AND deleted_at IS NOT NULL
		 ORDER BY deleted_at DESC, id`,
		vaultID,
	)
	if err != nil {
		return nil, fmt.Errorf("list trash: %w", err)
	}
	defer rows.Close()
	notes := []model.TrashedNote{}
	for rows.Next() {
		var n model.TrashedNote
		if err := rows.Scan(&n.ID, &n.VaultID, &n.Path, &n.Title, &n.Checksum, &n.CreatedAt, &n.UpdatedAt, &n.DeletedAt); err != nil {
			return nil, fmt.Errorf("scan trashed note: %w", err)
		}
		notes = append(notes, n)
	}
	return notes, rows.Err()
}

// TrashedRef names a trashed note.
type TrashedRef struct {
	ID      string
	VaultID string
}

// ExpiredTrash returns up to limit notes trashed at or before cutoff, oldest
// first: the purge job's work list.
func (r *NoteRepo) ExpiredTrash(ctx context.Context, cutoff time.Time, limit int) ([]TrashedRef, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, vault_id FROM notes
		 WHERE deleted_at IS NOT NULL AND deleted_at <= $1
		 ORDER BY deleted_at, id LIMIT $2`,
		cutoff, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list expired trash: %w", err)
	}
	defer rows.Close()
	var refs []TrashedRef
	for rows.Next() {
		var ref TrashedRef
		if err := rows.Scan(&ref.ID, &ref.VaultID); err != nil {
			return nil, fmt.Errorf("scan expired trash: %w", err)
		}
		refs = append(refs, ref)
	}
	return refs, rows.Err()
}

// TrashedIDs returns the ids of every note in the vault's trash.
func (r *NoteRepo) TrashedIDs(ctx context.Context, vaultID string) ([]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id FROM notes WHERE vault_id = $1 AND deleted_at IS NOT NULL ORDER BY id`, vaultID)
	if err != nil {
		return nil, fmt.Errorf("list trashed ids: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan trashed id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// PurgeTrashed deletes one trashed note for good, in one transaction: its
// versions, tags, aliases, outgoing links, stars and attachment rows cascade
// with it. It only deletes while the note is still in the trash and, when
// cutoff is not zero, was trashed at or before cutoff, so a note restored
// meanwhile (or trashed again since) survives. It returns the storage keys of
// the note's attachments, for the caller to remove once this has committed,
// and whether the note was deleted.
func (r *NoteRepo) PurgeTrashed(ctx context.Context, vaultID, id string, cutoff time.Time) ([]string, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("begin purge: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock the row first, so a restore cannot slip in between reading the
	// attachment keys and deleting.
	var deletedAt time.Time
	err = tx.QueryRow(ctx,
		`SELECT deleted_at FROM notes WHERE id = $1 AND vault_id = $2 AND deleted_at IS NOT NULL FOR UPDATE`,
		id, vaultID,
	).Scan(&deletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("lock trashed note: %w", err)
	}
	if !cutoff.IsZero() && deletedAt.After(cutoff) {
		return nil, false, nil
	}

	rows, err := tx.Query(ctx, `SELECT storage_path FROM attachments WHERE note_id = $1`, id)
	if err != nil {
		return nil, false, fmt.Errorf("list purged attachments: %w", err)
	}
	var keys []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			rows.Close()
			return nil, false, fmt.Errorf("scan purged attachment: %w", err)
		}
		keys = append(keys, k)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("list purged attachments: %w", err)
	}

	tag, err := tx.Exec(ctx,
		`DELETE FROM notes WHERE id = $1 AND vault_id = $2 AND deleted_at IS NOT NULL AND ($3::timestamptz IS NULL OR deleted_at <= $3)`,
		id, vaultID, nullTime(cutoff),
	)
	if err != nil {
		return nil, false, fmt.Errorf("purge note: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, false, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, fmt.Errorf("commit purge: %w", err)
	}
	return keys, true, nil
}

// PurgeTrashedTx deletes every trashed note of the vault inside tx (a vault
// turning e2ee must keep no plaintext, #569) and returns their ids. The
// caller must make sure none of them has attachments.
func (r *NoteRepo) PurgeTrashedTx(ctx context.Context, tx pgx.Tx, vaultID string) ([]string, error) {
	rows, err := tx.Query(ctx,
		`DELETE FROM notes WHERE vault_id = $1 AND deleted_at IS NOT NULL RETURNING id`, vaultID)
	if err != nil {
		return nil, fmt.Errorf("purge vault trash: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan purged note: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// LiveIDs reports which of ids are live notes of the vault (search hits from
// the index are checked against it, #569).
func (r *NoteRepo) LiveIDs(ctx context.Context, vaultID string, ids []string) (map[string]bool, error) {
	live := make(map[string]bool, len(ids))
	if len(ids) == 0 {
		return live, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id FROM notes WHERE vault_id = $1 AND id = ANY($2) AND deleted_at IS NULL`, vaultID, ids)
	if err != nil {
		return nil, fmt.Errorf("check live notes: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan live note: %w", err)
		}
		live[id] = true
	}
	return live, rows.Err()
}

// WithAdvisoryLock runs fn while holding the session advisory lock key, so
// only one server instance does that work at a time. When another instance
// holds the lock, fn is skipped and ran is false.
func (r *NoteRepo) WithAdvisoryLock(ctx context.Context, key int64, fn func(context.Context) error) (ran bool, err error) {
	conn, err := r.pool.Acquire(ctx)
	if err != nil {
		return false, fmt.Errorf("acquire connection: %w", err)
	}
	defer conn.Release()
	var got bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, key).Scan(&got); err != nil {
		return false, fmt.Errorf("take advisory lock: %w", err)
	}
	if !got {
		return false, nil
	}
	defer func() {
		// Unlock even when ctx is done: the connection goes back to the pool.
		if _, uerr := conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, key); uerr != nil {
			// Closing the connection drops the lock.
			_ = conn.Conn().Close(context.WithoutCancel(ctx))
		}
	}()
	return true, fn(ctx)
}

// nullTime is nil for the zero time, so SQL sees NULL.
func nullTime(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

// ListTrashedNotes returns the vault's trashed notes with their content (the
// account export includes them, #569).
func (r *NoteRepo) ListTrashedNotes(ctx context.Context, vaultID string) ([]model.Note, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, vault_id, path, title, content, checksum, created_at, updated_at
		 FROM notes WHERE vault_id = $1 AND deleted_at IS NOT NULL ORDER BY path, id`,
		vaultID,
	)
	if err != nil {
		return nil, fmt.Errorf("list trashed notes: %w", err)
	}
	defer rows.Close()
	var notes []model.Note
	for rows.Next() {
		var n model.Note
		if err := rows.Scan(&n.ID, &n.VaultID, &n.Path, &n.Title, &n.Content, &n.Checksum, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan trashed note: %w", err)
		}
		if err := r.open(fieldNoteContent, &n.Content); err != nil {
			return nil, err
		}
		notes = append(notes, n)
	}
	return notes, rows.Err()
}
