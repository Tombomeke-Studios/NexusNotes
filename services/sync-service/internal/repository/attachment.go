package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

var ErrAttachmentNotFound = errors.New("attachment not found")

// AttachmentRepo stores attachment metadata; bytes live in object storage (#153).
type AttachmentRepo struct {
	pool *pgxpool.Pool
}

func NewAttachmentRepo(pool *pgxpool.Pool) *AttachmentRepo {
	return &AttachmentRepo{pool: pool}
}

func (r *AttachmentRepo) Create(ctx context.Context, a *model.Attachment) error {
	err := r.pool.QueryRow(ctx,
		`INSERT INTO attachments (note_id, vault_id, filename, mime_type, size_bytes, storage_path)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, created_at`,
		a.NoteID, a.VaultID, a.Filename, a.MimeType, a.SizeBytes, a.StoragePath,
	).Scan(&a.ID, &a.CreatedAt)
	if err != nil {
		return fmt.Errorf("create attachment: %w", err)
	}
	return nil
}

// ListByNote returns a note's attachments, oldest first.
func (r *AttachmentRepo) ListByNote(ctx context.Context, noteID string) ([]model.Attachment, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, note_id, vault_id, filename, mime_type, size_bytes, storage_path, created_at
		 FROM attachments WHERE note_id = $1 ORDER BY created_at`,
		noteID,
	)
	if err != nil {
		return nil, fmt.Errorf("list attachments: %w", err)
	}
	defer rows.Close()

	var atts []model.Attachment
	for rows.Next() {
		var a model.Attachment
		if err := rows.Scan(&a.ID, &a.NoteID, &a.VaultID, &a.Filename, &a.MimeType,
			&a.SizeBytes, &a.StoragePath, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan attachment: %w", err)
		}
		atts = append(atts, a)
	}
	return atts, rows.Err()
}

// GetByID returns one attachment's metadata (incl. its storage path).
func (r *AttachmentRepo) GetByID(ctx context.Context, id string) (*model.Attachment, error) {
	var a model.Attachment
	err := r.pool.QueryRow(ctx,
		`SELECT id, note_id, vault_id, filename, mime_type, size_bytes, storage_path, created_at
		 FROM attachments WHERE id = $1`,
		id,
	).Scan(&a.ID, &a.NoteID, &a.VaultID, &a.Filename, &a.MimeType, &a.SizeBytes, &a.StoragePath, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAttachmentNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get attachment: %w", err)
	}
	return &a, nil
}

func (r *AttachmentRepo) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM attachments WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete attachment: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrAttachmentNotFound
	}
	return nil
}
