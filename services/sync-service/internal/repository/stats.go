package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// StatsRepo answers the aggregate counts for the admin stats endpoint (#59).
type StatsRepo struct {
	pool *pgxpool.Pool
}

func NewStatsRepo(pool *pgxpool.Pool) *StatsRepo {
	return &StatsRepo{pool: pool}
}

// Counts returns the instance-wide user, vault and note totals in one query.
func (r *StatsRepo) Counts(ctx context.Context) (users, vaults, notes int64, err error) {
	row := r.pool.QueryRow(ctx,
		`SELECT
		   (SELECT count(*) FROM users),
		   (SELECT count(*) FROM vaults),
		   (SELECT count(*) FROM notes)`,
	)
	if err := row.Scan(&users, &vaults, &notes); err != nil {
		return 0, 0, 0, fmt.Errorf("count stats: %w", err)
	}
	return users, vaults, notes, nil
}
