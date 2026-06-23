package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

type VaultRepo struct {
	pool *pgxpool.Pool
}

func NewVaultRepo(pool *pgxpool.Pool) *VaultRepo {
	return &VaultRepo{pool: pool}
}

func (r *VaultRepo) Create(ctx context.Context, vault *model.Vault) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO vaults (id, user_id, name, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		vault.ID, vault.UserID, vault.Name, vault.CreatedAt, vault.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert vault: %w", err)
	}
	return nil
}

func (r *VaultRepo) GetByID(ctx context.Context, id string) (*model.Vault, error) {
	var v model.Vault
	err := r.pool.QueryRow(ctx,
		`SELECT id, user_id, name, created_at, updated_at
		 FROM vaults WHERE id = $1`,
		id,
	).Scan(&v.ID, &v.UserID, &v.Name, &v.CreatedAt, &v.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get vault: %w", err)
	}
	return &v, nil
}

func (r *VaultRepo) ListByUser(ctx context.Context, userID string) ([]model.Vault, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, name, created_at, updated_at
		 FROM vaults WHERE user_id = $1 ORDER BY name`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list vaults: %w", err)
	}
	defer rows.Close()

	var vaults []model.Vault
	for rows.Next() {
		var v model.Vault
		if err := rows.Scan(&v.ID, &v.UserID, &v.Name, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan vault: %w", err)
		}
		vaults = append(vaults, v)
	}
	return vaults, nil
}

func (r *VaultRepo) Update(ctx context.Context, vault *model.Vault) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE vaults SET name = $1, updated_at = $2 WHERE id = $3 AND user_id = $4`,
		vault.Name, vault.UpdatedAt, vault.ID, vault.UserID,
	)
	if err != nil {
		return fmt.Errorf("update vault: %w", err)
	}
	return nil
}

func (r *VaultRepo) Delete(ctx context.Context, id, userID string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM vaults WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil {
		return fmt.Errorf("delete vault: %w", err)
	}
	return nil
}
