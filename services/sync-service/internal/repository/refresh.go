package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrRefreshTokenNotFound = errors.New("refresh token not found")

// RefreshToken is one stored (hashed) refresh token in a rotation chain (#49).
type RefreshToken struct {
	ID        string
	UserID    string
	DeviceID  string
	ExpiresAt time.Time
	UsedAt    *time.Time
}

// RefreshRepo persists hashed refresh tokens.
type RefreshRepo struct {
	pool *pgxpool.Pool
}

func NewRefreshRepo(pool *pgxpool.Pool) *RefreshRepo {
	return &RefreshRepo{pool: pool}
}

func (r *RefreshRepo) Create(ctx context.Context, userID, deviceID, tokenHash string, expiresAt time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4)`,
		userID, deviceID, tokenHash, expiresAt,
	)
	if err != nil {
		return fmt.Errorf("create refresh token: %w", err)
	}
	return nil
}

func (r *RefreshRepo) GetByHash(ctx context.Context, tokenHash string) (*RefreshToken, error) {
	var t RefreshToken
	err := r.pool.QueryRow(ctx,
		`SELECT id, user_id, device_id, expires_at, used_at
		 FROM refresh_tokens WHERE token_hash = $1`,
		tokenHash,
	).Scan(&t.ID, &t.UserID, &t.DeviceID, &t.ExpiresAt, &t.UsedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrRefreshTokenNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get refresh token: %w", err)
	}
	return &t, nil
}

// MarkUsed stamps a token as consumed by a rotation; a second use of the
// same token is the reuse signal that revokes the whole chain.
func (r *RefreshRepo) MarkUsed(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE refresh_tokens SET used_at = now() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("mark refresh token used: %w", err)
	}
	return nil
}

func (r *RefreshRepo) Delete(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM refresh_tokens WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete refresh token: %w", err)
	}
	return nil
}

// DeleteByUserDevice revokes every token of one device's chain — used on
// reuse detection and on device revocation (#45).
func (r *RefreshRepo) DeleteByUserDevice(ctx context.Context, userID, deviceID string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM refresh_tokens WHERE user_id = $1 AND device_id = $2`,
		userID, deviceID,
	)
	if err != nil {
		return fmt.Errorf("delete device refresh tokens: %w", err)
	}
	return nil
}

// DeleteByUser revokes every session of a user — used after a password reset.
func (r *RefreshRepo) DeleteByUser(ctx context.Context, userID string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM refresh_tokens WHERE user_id = $1`, userID)
	if err != nil {
		return fmt.Errorf("delete user refresh tokens: %w", err)
	}
	return nil
}

// DeleteExpired removes tokens past their expiry (daily cleanup).
func (r *RefreshRepo) DeleteExpired(ctx context.Context) (int64, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM refresh_tokens WHERE expires_at < now()`)
	if err != nil {
		return 0, fmt.Errorf("delete expired refresh tokens: %w", err)
	}
	return tag.RowsAffected(), nil
}
