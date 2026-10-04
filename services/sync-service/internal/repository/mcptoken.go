package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// MCPTokenRepo persists MCP API tokens and their audit log (#221). Only a
// hash of each token is stored; token names are encrypted at rest.
type MCPTokenRepo struct {
	pool *pgxpool.Pool
	cryptor
}

func NewMCPTokenRepo(pool *pgxpool.Pool, crypt *fieldcrypt.Cipher) *MCPTokenRepo {
	return &MCPTokenRepo{pool: pool, cryptor: cryptor{crypt}}
}

// Create stores a token for the user and fills in its id and creation time.
func (r *MCPTokenRepo) Create(ctx context.Context, t *model.MCPToken, tokenHash string) error {
	name, err := r.seal(fieldMCPTokenName, t.Name)
	if err != nil {
		return err
	}
	err = r.pool.QueryRow(ctx,
		`INSERT INTO mcp_tokens (user_id, name, token_hash, scope)
		 VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
		t.UserID, name, tokenHash, t.Scope,
	).Scan(&t.ID, &t.CreatedAt)
	if err != nil {
		return fmt.Errorf("create mcp token: %w", err)
	}
	return nil
}

// CountByUser returns how many tokens the user has.
func (r *MCPTokenRepo) CountByUser(ctx context.Context, userID string) (int, error) {
	var n int
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM mcp_tokens WHERE user_id = $1`, userID).Scan(&n); err != nil {
		return 0, fmt.Errorf("count mcp tokens: %w", err)
	}
	return n, nil
}

// ListByUser returns the user's tokens, newest first.
func (r *MCPTokenRepo) ListByUser(ctx context.Context, userID string) ([]model.MCPToken, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, name, scope, last_used_at, created_at
		 FROM mcp_tokens WHERE user_id = $1 ORDER BY created_at DESC, id`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list mcp tokens: %w", err)
	}
	defer rows.Close()
	tokens := []model.MCPToken{}
	for rows.Next() {
		t, err := r.scan(rows)
		if err != nil {
			return nil, err
		}
		tokens = append(tokens, *t)
	}
	return tokens, rows.Err()
}

// GetByHash returns the token with this hash, or nil when there is none.
func (r *MCPTokenRepo) GetByHash(ctx context.Context, tokenHash string) (*model.MCPToken, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT id, user_id, name, scope, last_used_at, created_at
		 FROM mcp_tokens WHERE token_hash = $1`,
		tokenHash,
	)
	t, err := r.scan(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return t, err
}

func (r *MCPTokenRepo) scan(row pgx.Row) (*model.MCPToken, error) {
	var t model.MCPToken
	if err := row.Scan(&t.ID, &t.UserID, &t.Name, &t.Scope, &t.LastUsedAt, &t.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		return nil, fmt.Errorf("scan mcp token: %w", err)
	}
	if err := r.open(fieldMCPTokenName, &t.Name); err != nil {
		return nil, err
	}
	return &t, nil
}

// Delete removes the user's token (its audit entries go with it); returns
// whether it existed.
func (r *MCPTokenRepo) Delete(ctx context.Context, userID, id string) (bool, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM mcp_tokens WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return false, fmt.Errorf("delete mcp token: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// Use records a request made with the token: an audit entry, and the
// last-used time (written at most once a minute, so a busy client does not
// rewrite the token row on every call).
func (r *MCPTokenRepo) Use(ctx context.Context, tokenID, tool, summary string) error {
	if _, err := r.pool.Exec(ctx,
		`INSERT INTO mcp_audit_log (token_id, tool, summary) VALUES ($1, $2, $3)`,
		tokenID, tool, summary,
	); err != nil {
		return fmt.Errorf("record mcp audit entry: %w", err)
	}
	if _, err := r.pool.Exec(ctx,
		`UPDATE mcp_tokens SET last_used_at = now()
		 WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
		tokenID,
	); err != nil {
		return fmt.Errorf("touch mcp token: %w", err)
	}
	return nil
}

// Audit returns the newest audit entries of the user's tokens, optionally of
// one token only.
func (r *MCPTokenRepo) Audit(ctx context.Context, userID, tokenID string, limit int) ([]model.MCPAuditEntry, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT a.token_id, a.tool, a.summary, a.created_at
		 FROM mcp_audit_log a JOIN mcp_tokens t ON t.id = a.token_id
		 WHERE t.user_id = $1 AND ($2 = '' OR a.token_id = $2)
		 ORDER BY a.created_at DESC, a.id DESC LIMIT $3`,
		userID, tokenID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list mcp audit log: %w", err)
	}
	defer rows.Close()
	entries := []model.MCPAuditEntry{}
	for rows.Next() {
		var e model.MCPAuditEntry
		if err := rows.Scan(&e.TokenID, &e.Tool, &e.Summary, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan mcp audit entry: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// PruneAudit deletes audit entries older than the retention.
func (r *MCPTokenRepo) PruneAudit(ctx context.Context, retention time.Duration) (int64, error) {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM mcp_audit_log WHERE created_at < now() - make_interval(secs => $1)`,
		retention.Seconds(),
	)
	if err != nil {
		return 0, fmt.Errorf("prune mcp audit log: %w", err)
	}
	return tag.RowsAffected(), nil
}
