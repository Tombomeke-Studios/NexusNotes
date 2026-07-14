package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrAuthTokenInvalid = errors.New("auth token invalid, expired or already used")

// AuthTokenRepo stores single-use, hashed action tokens (email verification
// and password reset share the shape; #47/#48). The table name comes from a
// fixed constructor whitelist, never from input.
type AuthTokenRepo struct {
	pool  *pgxpool.Pool
	table string
}

func NewEmailVerificationRepo(pool *pgxpool.Pool) *AuthTokenRepo {
	return &AuthTokenRepo{pool: pool, table: "email_verifications"}
}

func NewPasswordResetRepo(pool *pgxpool.Pool) *AuthTokenRepo {
	return &AuthTokenRepo{pool: pool, table: "password_reset_tokens"}
}

func (r *AuthTokenRepo) Create(ctx context.Context, userID, tokenHash string, expiresAt time.Time) error {
	_, err := r.pool.Exec(ctx,
		fmt.Sprintf(`INSERT INTO %s (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, r.table),
		userID, tokenHash, expiresAt,
	)
	if err != nil {
		return fmt.Errorf("create %s token: %w", r.table, err)
	}
	return nil
}

// Consume atomically marks an unexpired, unused token as used and returns its
// user — a second Consume of the same token fails, so tokens are single-use
// even under concurrent requests.
func (r *AuthTokenRepo) Consume(ctx context.Context, tokenHash string) (string, error) {
	var userID string
	err := r.pool.QueryRow(ctx,
		fmt.Sprintf(`UPDATE %s SET used_at = now()
		 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
		 RETURNING user_id`, r.table),
		tokenHash,
	).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrAuthTokenInvalid
	}
	if err != nil {
		return "", fmt.Errorf("consume %s token: %w", r.table, err)
	}
	return userID, nil
}

// DeleteExpired prunes stale tokens (daily cleanup).
func (r *AuthTokenRepo) DeleteExpired(ctx context.Context) (int64, error) {
	tag, err := r.pool.Exec(ctx,
		fmt.Sprintf(`DELETE FROM %s WHERE expires_at < now()`, r.table))
	if err != nil {
		return 0, fmt.Errorf("delete expired %s tokens: %w", r.table, err)
	}
	return tag.RowsAffected(), nil
}
