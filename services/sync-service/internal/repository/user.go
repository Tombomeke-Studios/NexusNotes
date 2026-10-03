package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// Sentinel errors let callers distinguish expected conditions (no such user,
// duplicate email) from genuine infrastructure failures (e.g. the database being
// unreachable), which must not be masked as a friendly business error.
var (
	ErrUserNotFound   = errors.New("user not found")
	ErrDuplicateEmail = errors.New("duplicate email")
)

// pgUniqueViolation is the PostgreSQL SQLSTATE for a unique-constraint violation.
const pgUniqueViolation = "23505"

// UserRepo stores accounts with their email address (#356) and display name
// (#355) encrypted at rest. Addresses are looked up through a blind index of
// the normalised address, so lookups ignore case and surrounding spaces.
type UserRepo struct {
	pool *pgxpool.Pool
	cryptor
}

func NewUserRepo(pool *pgxpool.Pool, crypt *fieldcrypt.Cipher) *UserRepo {
	return &UserRepo{pool: pool, cryptor: cryptor{crypt}}
}

// normalizeEmail is the form an address is indexed and compared in.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func (r *UserRepo) emailIndex(email string) string {
	return r.c.BlindIndex(fieldUserEmail, normalizeEmail(email))
}

// emailIndexes are the address's blind index under every configured key, so
// rows indexed before a key rotation still match.
func (r *UserRepo) emailIndexes(email string) []string {
	return r.c.BlindIndexes(fieldUserEmail, normalizeEmail(email))
}

func (r *UserRepo) Create(ctx context.Context, user *model.User) error {
	// The unique index only covers the current key's index; a row indexed
	// under an older key, or from before encryption at rest (no index yet),
	// must still block a second account with the same address.
	var taken bool
	if err := r.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM users
		  WHERE email_index = ANY($1) OR (email_index IS NULL AND lower(email) = $2))`,
		r.emailIndexes(user.Email), normalizeEmail(user.Email),
	).Scan(&taken); err != nil {
		return fmt.Errorf("check email: %w", err)
	}
	if taken {
		return ErrDuplicateEmail
	}
	email, err := r.seal(fieldUserEmail, strings.TrimSpace(user.Email))
	if err != nil {
		return err
	}
	displayName, err := r.seal(fieldUserDisplayName, user.DisplayName)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx,
		`INSERT INTO users (id, email, email_index, password_hash, display_name, created_at, updated_at, terms_accepted_at, terms_version)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, ''))`,
		user.ID, email, r.emailIndex(user.Email), user.PasswordHash, displayName, user.CreatedAt, user.UpdatedAt,
		user.TermsAcceptedAt, user.TermsVersion,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
			return ErrDuplicateEmail
		}
		return fmt.Errorf("insert user: %w", err)
	}
	return nil
}

func (r *UserRepo) GetByEmail(ctx context.Context, email string) (*model.User, error) {
	var u model.User
	err := r.pool.QueryRow(ctx,
		`SELECT id, email, password_hash, display_name, email_verified, created_at, updated_at
		 FROM users
		 WHERE email_index = ANY($1) OR (email_index IS NULL AND lower(email) = $2)
		 LIMIT 1`,
		r.emailIndexes(email), normalizeEmail(email),
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName, &u.EmailVerified, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("get user by email: %w", err)
	}
	if err := r.openUser(&u); err != nil {
		return nil, err
	}
	return &u, nil
}

// Delete removes the user row; vaults, notes, versions, links, tags and
// devices are removed by the ON DELETE CASCADE constraints in the schema.
func (r *UserRepo) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (r *UserRepo) UpdatePasswordHash(ctx context.Context, id, passwordHash string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
		id, passwordHash,
	)
	if err != nil {
		return fmt.Errorf("update password hash: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (r *UserRepo) GetByID(ctx context.Context, id string) (*model.User, error) {
	var u model.User
	err := r.pool.QueryRow(ctx,
		`SELECT id, email, password_hash, display_name, email_verified, created_at, updated_at
		 FROM users WHERE id = $1`,
		id,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName, &u.EmailVerified, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	if err := r.openUser(&u); err != nil {
		return nil, err
	}
	return &u, nil
}

// openUser decrypts a scanned user's encrypted fields in place.
func (r *UserRepo) openUser(u *model.User) error {
	if err := r.open(fieldUserEmail, &u.Email); err != nil {
		return err
	}
	return r.open(fieldUserDisplayName, &u.DisplayName)
}

// SetEmailVerified marks the user's email address as confirmed (#47).
func (r *UserRepo) SetEmailVerified(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET email_verified = true, updated_at = now() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("set email verified: %w", err)
	}
	return nil
}
