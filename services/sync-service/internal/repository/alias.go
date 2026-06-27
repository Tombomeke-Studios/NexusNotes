package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AliasRepo struct {
	pool *pgxpool.Pool
}

func NewAliasRepo(pool *pgxpool.Pool) *AliasRepo {
	return &AliasRepo{pool: pool}
}

// UpsertAliasesTx replaces all aliases for a note atomically within an existing transaction.
func (r *AliasRepo) UpsertAliasesTx(ctx context.Context, tx pgx.Tx, noteID string, aliases []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM note_aliases WHERE note_id = $1`, noteID); err != nil {
		return fmt.Errorf("delete old aliases: %w", err)
	}
	for _, alias := range aliases {
		if _, err := tx.Exec(ctx,
			`INSERT INTO note_aliases (note_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			noteID, alias,
		); err != nil {
			return fmt.Errorf("insert alias %q: %w", alias, err)
		}
	}
	return nil
}
