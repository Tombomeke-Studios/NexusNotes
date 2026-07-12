package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// StarRepo persists per-user starred (favourite) notes.
type StarRepo struct {
	pool *pgxpool.Pool
}

func NewStarRepo(pool *pgxpool.Pool) *StarRepo {
	return &StarRepo{pool: pool}
}

// List returns the ids of all notes the user has starred, oldest star first.
func (r *StarRepo) List(ctx context.Context, userID string) ([]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT note_id FROM starred_notes WHERE user_id = $1 ORDER BY starred_at`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list starred notes: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan starred note: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// Star marks a note as starred; starring twice is a no-op.
func (r *StarRepo) Star(ctx context.Context, userID, noteID string) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO starred_notes (user_id, note_id) VALUES ($1, $2)
		 ON CONFLICT (user_id, note_id) DO NOTHING`,
		userID, noteID,
	)
	if err != nil {
		return fmt.Errorf("star note: %w", err)
	}
	return nil
}

// Unstar removes a star; removing a missing star is a no-op.
func (r *StarRepo) Unstar(ctx context.Context, userID, noteID string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM starred_notes WHERE user_id = $1 AND note_id = $2`,
		userID, noteID,
	)
	if err != nil {
		return fmt.Errorf("unstar note: %w", err)
	}
	return nil
}
