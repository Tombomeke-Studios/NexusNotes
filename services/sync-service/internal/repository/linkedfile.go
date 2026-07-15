package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

var ErrLinkedFileNotFound = errors.New("linked file not found")

// LinkedFileRepo stores references to external files linked into a vault
// (URLs, local paths, GitHub files) plus per-user annotations (#64).
type LinkedFileRepo struct {
	pool *pgxpool.Pool
}

func NewLinkedFileRepo(pool *pgxpool.Pool) *LinkedFileRepo {
	return &LinkedFileRepo{pool: pool}
}

func (r *LinkedFileRepo) Create(ctx context.Context, lf *model.LinkedFile) error {
	err := r.pool.QueryRow(ctx,
		`INSERT INTO linked_files (vault_id, display_name, source_type, source_ref, read_only)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, created_at`,
		lf.VaultID, lf.DisplayName, lf.SourceType, lf.SourceRef, lf.ReadOnly,
	).Scan(&lf.ID, &lf.CreatedAt)
	if err != nil {
		return fmt.Errorf("create linked file: %w", err)
	}
	return nil
}

func (r *LinkedFileRepo) ListByVault(ctx context.Context, vaultID string) ([]model.LinkedFile, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, vault_id, display_name, source_type, source_ref, read_only, created_at
		 FROM linked_files WHERE vault_id = $1 ORDER BY display_name`,
		vaultID,
	)
	if err != nil {
		return nil, fmt.Errorf("list linked files: %w", err)
	}
	defer func() { rows.Close() }()

	var out []model.LinkedFile
	for rows.Next() {
		var lf model.LinkedFile
		if err := rows.Scan(&lf.ID, &lf.VaultID, &lf.DisplayName, &lf.SourceType,
			&lf.SourceRef, &lf.ReadOnly, &lf.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan linked file: %w", err)
		}
		out = append(out, lf)
	}
	return out, rows.Err()
}

func (r *LinkedFileRepo) GetByID(ctx context.Context, id string) (*model.LinkedFile, error) {
	var lf model.LinkedFile
	err := r.pool.QueryRow(ctx,
		`SELECT id, vault_id, display_name, source_type, source_ref, read_only, created_at
		 FROM linked_files WHERE id = $1`,
		id,
	).Scan(&lf.ID, &lf.VaultID, &lf.DisplayName, &lf.SourceType, &lf.SourceRef, &lf.ReadOnly, &lf.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrLinkedFileNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get linked file: %w", err)
	}
	return &lf, nil
}

func (r *LinkedFileRepo) Delete(ctx context.Context, id, vaultID string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM linked_files WHERE id = $1 AND vault_id = $2`, id, vaultID)
	if err != nil {
		return fmt.Errorf("delete linked file: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrLinkedFileNotFound
	}
	return nil
}

// GetAnnotation returns the user's annotation for a linked file, or "" (no error)
// when none exists yet.
func (r *LinkedFileRepo) GetAnnotation(ctx context.Context, linkedFileID, userID string) (string, error) {
	var content string
	err := r.pool.QueryRow(ctx,
		`SELECT content FROM linked_file_annotations WHERE linked_file_id = $1 AND user_id = $2`,
		linkedFileID, userID,
	).Scan(&content)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get annotation: %w", err)
	}
	return content, nil
}

// UpsertAnnotation stores the user's annotation, kept separate from the linked
// content so re-syncing the source never overwrites it (#64).
func (r *LinkedFileRepo) UpsertAnnotation(ctx context.Context, linkedFileID, userID, content string) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO linked_file_annotations (linked_file_id, user_id, content, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (linked_file_id, user_id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
		linkedFileID, userID, content,
	)
	if err != nil {
		return fmt.Errorf("upsert annotation: %w", err)
	}
	return nil
}
