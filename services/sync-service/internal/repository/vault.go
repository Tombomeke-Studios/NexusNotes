package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// ErrVaultNotFound also covers "not owned by this user" and "not an e2ee
// vault" so callers cannot distinguish those cases (no information leak).
var ErrVaultNotFound = errors.New("vault not found")

type VaultRepo struct {
	pool *pgxpool.Pool
}

func NewVaultRepo(pool *pgxpool.Pool) *VaultRepo {
	return &VaultRepo{pool: pool}
}

// AccessRole returns the caller's effective role for a vault in one query:
// "owner" (they own it), "editor"/"viewer" (shared with them), or "" for no
// access (#53). Centralizes the owner-or-member check every data handler needs.
func (r *VaultRepo) AccessRole(ctx context.Context, vaultID, userID string) (string, error) {
	var role string
	err := r.pool.QueryRow(ctx,
		`SELECT CASE
		          WHEN v.user_id = $2 THEN 'owner'
		          ELSE m.role
		        END
		 FROM vaults v
		 LEFT JOIN vault_members m ON m.vault_id = v.id AND m.user_id = $2
		 WHERE v.id = $1 AND (v.user_id = $2 OR m.user_id IS NOT NULL)`,
		vaultID, userID,
	).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get access role: %w", err)
	}
	return role, nil
}

func (r *VaultRepo) Create(ctx context.Context, vault *model.Vault) error {
	if vault.Encryption == "" {
		vault.Encryption = model.VaultEncryptionNone
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO vaults (id, user_id, name, encryption, encryption_meta, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		vault.ID, vault.UserID, vault.Name, vault.Encryption, []byte(vault.EncryptionMeta), vault.CreatedAt, vault.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert vault: %w", err)
	}
	return nil
}

func (r *VaultRepo) GetByID(ctx context.Context, id string) (*model.Vault, error) {
	var v model.Vault
	var meta []byte
	err := r.pool.QueryRow(ctx,
		`SELECT id, user_id, name, encryption, encryption_meta, created_at, updated_at
		 FROM vaults WHERE id = $1`,
		id,
	).Scan(&v.ID, &v.UserID, &v.Name, &v.Encryption, &meta, &v.CreatedAt, &v.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get vault: %w", err)
	}
	v.EncryptionMeta = meta
	return &v, nil
}

func (r *VaultRepo) ListByUser(ctx context.Context, userID string) ([]model.Vault, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, name, encryption, encryption_meta, created_at, updated_at
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
		var meta []byte
		if err := rows.Scan(&v.ID, &v.UserID, &v.Name, &v.Encryption, &meta, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan vault: %w", err)
		}
		v.EncryptionMeta = meta
		vaults = append(vaults, v)
	}
	return vaults, nil
}

// UpdateEncryptionMeta replaces the opaque key-material blob of an e2ee vault
// (passphrase change / recovery-key rotation re-wraps the Vault Key). Only the
// owner may do this, and only for vaults that are already encrypted — the mode
// itself is immutable after creation.
func (r *VaultRepo) UpdateEncryptionMeta(ctx context.Context, id, userID string, meta []byte) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE vaults SET encryption_meta = $3, updated_at = NOW()
		 WHERE id = $1 AND user_id = $2 AND encryption = $4`,
		id, userID, meta, model.VaultEncryptionE2EE,
	)
	if err != nil {
		return fmt.Errorf("update encryption meta: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrVaultNotFound
	}
	return nil
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
