package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

type TagRepo struct {
	pool *pgxpool.Pool
}

func NewTagRepo(pool *pgxpool.Pool) *TagRepo {
	return &TagRepo{pool: pool}
}

// UpsertTagsTx replaces all tags for a note atomically within an existing transaction.
func (r *TagRepo) UpsertTagsTx(ctx context.Context, tx pgx.Tx, noteID string, tags []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM note_tags WHERE note_id = $1`, noteID); err != nil {
		return fmt.Errorf("delete old tags: %w", err)
	}
	for _, tag := range tags {
		if _, err := tx.Exec(ctx,
			`INSERT INTO note_tags (note_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			noteID, tag,
		); err != nil {
			return fmt.Errorf("insert tag %q: %w", tag, err)
		}
	}
	return nil
}

// GetVaultTags returns all tags in a vault with their note counts, ordered by count desc.
func (r *TagRepo) GetVaultTags(ctx context.Context, vaultID string) ([]model.TagCount, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT nt.tag, COUNT(*) AS count
		 FROM note_tags nt
		 JOIN notes n ON n.id = nt.note_id
		 WHERE n.vault_id = $1
		 GROUP BY nt.tag
		 ORDER BY count DESC, nt.tag ASC`,
		vaultID,
	)
	if err != nil {
		return nil, fmt.Errorf("query vault tags: %w", err)
	}
	defer rows.Close()

	var result []model.TagCount
	for rows.Next() {
		var tc model.TagCount
		if err := rows.Scan(&tc.Tag, &tc.Count); err != nil {
			return nil, fmt.Errorf("scan tag count: %w", err)
		}
		result = append(result, tc)
	}
	return result, nil
}
