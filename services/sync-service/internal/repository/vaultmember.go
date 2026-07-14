package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// VaultMemberRepo manages membership of shared vaults (#51-#54).
type VaultMemberRepo struct {
	pool *pgxpool.Pool
}

func NewVaultMemberRepo(pool *pgxpool.Pool) *VaultMemberRepo {
	return &VaultMemberRepo{pool: pool}
}

// Add invites a user to a vault (auto-accepted — there is no separate accept
// step yet, so the vault appears for the member immediately). Re-inviting an
// existing member just updates their role.
func (r *VaultMemberRepo) Add(ctx context.Context, vaultID, userID, role, invitedBy string) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO vault_members (vault_id, user_id, role, invited_by, accepted_at)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (vault_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
		vaultID, userID, role, invitedBy,
	)
	if err != nil {
		return fmt.Errorf("add vault member: %w", err)
	}
	return nil
}

// Role returns the user's role in the vault, or "" when they are not a member.
func (r *VaultMemberRepo) Role(ctx context.Context, vaultID, userID string) (string, error) {
	var role string
	err := r.pool.QueryRow(ctx,
		`SELECT role FROM vault_members WHERE vault_id = $1 AND user_id = $2`,
		vaultID, userID,
	).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get member role: %w", err)
	}
	return role, nil
}

// List returns the vault's members with their user details.
func (r *VaultMemberRepo) List(ctx context.Context, vaultID string) ([]model.VaultMember, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT m.vault_id, m.user_id, u.email, u.display_name, m.role,
		        COALESCE(m.invited_by, ''), m.accepted_at, m.created_at
		 FROM vault_members m JOIN users u ON u.id = m.user_id
		 WHERE m.vault_id = $1 ORDER BY m.created_at`,
		vaultID,
	)
	if err != nil {
		return nil, fmt.Errorf("list vault members: %w", err)
	}
	defer rows.Close()

	var members []model.VaultMember
	for rows.Next() {
		var m model.VaultMember
		if err := rows.Scan(&m.VaultID, &m.UserID, &m.Email, &m.DisplayName, &m.Role,
			&m.InvitedBy, &m.AcceptedAt, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan vault member: %w", err)
		}
		members = append(members, m)
	}
	return members, rows.Err()
}

// UpdateRole changes a member's role; returns whether a row existed.
func (r *VaultMemberRepo) UpdateRole(ctx context.Context, vaultID, userID, role string) (bool, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE vault_members SET role = $3 WHERE vault_id = $1 AND user_id = $2`,
		vaultID, userID, role,
	)
	if err != nil {
		return false, fmt.Errorf("update member role: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// Remove deletes a membership (kick or leave); returns whether a row existed.
func (r *VaultMemberRepo) Remove(ctx context.Context, vaultID, userID string) (bool, error) {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM vault_members WHERE vault_id = $1 AND user_id = $2`,
		vaultID, userID,
	)
	if err != nil {
		return false, fmt.Errorf("remove vault member: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// ListSharedVaults returns the vaults shared with the user, each stamped with
// the user's role (for GET /api/vaults, #55).
func (r *VaultMemberRepo) ListSharedVaults(ctx context.Context, userID string) ([]model.Vault, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT v.id, v.user_id, v.name, v.encryption, v.encryption_meta,
		        v.created_at, v.updated_at, m.role
		 FROM vault_members m JOIN vaults v ON v.id = m.vault_id
		 WHERE m.user_id = $1 ORDER BY v.name`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list shared vaults: %w", err)
	}
	defer rows.Close()

	var vaults []model.Vault
	for rows.Next() {
		var v model.Vault
		var meta []byte
		if err := rows.Scan(&v.ID, &v.UserID, &v.Name, &v.Encryption, &meta,
			&v.CreatedAt, &v.UpdatedAt, &v.Role); err != nil {
			return nil, fmt.Errorf("scan shared vault: %w", err)
		}
		v.EncryptionMeta = meta
		vaults = append(vaults, v)
	}
	return vaults, rows.Err()
}

// MemberUserIDs returns the user ids of every member of the vault (excluding
// the owner) — used to broadcast note updates to collaborators (#54).
func (r *VaultMemberRepo) MemberUserIDs(ctx context.Context, vaultID string) ([]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT user_id FROM vault_members WHERE vault_id = $1`, vaultID)
	if err != nil {
		return nil, fmt.Errorf("list member ids: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan member id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
