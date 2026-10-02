package repository

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// migrationLockKey is the advisory lock that serialises migration runs, so two
// processes migrating the same database at once (parallel test packages, two
// server instances starting together) never both apply a file (#368).
const migrationLockKey int64 = 0x4e6e4d6967 // "NnMig"

func RunMigrations(ctx context.Context, pool *pgxpool.Pool, migrationsDir string) error {
	// Concurrent CREATE TABLE IF NOT EXISTS can still collide, so this too
	// runs under the migration lock.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin migrations table tx: %w", err)
	}
	_, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", migrationLockKey)
	if err == nil {
		_, err = tx.Exec(ctx, `
			CREATE TABLE IF NOT EXISTS schema_migrations (
				version TEXT PRIMARY KEY,
				applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		_ = tx.Rollback(ctx)
		return fmt.Errorf("create migrations table: %w", err)
	}

	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("read migrations directory: %w", err)
	}

	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)

	for _, file := range files {
		var exists bool
		err := pool.QueryRow(ctx,
			"SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)",
			file,
		).Scan(&exists)
		if err != nil {
			return fmt.Errorf("check migration %s: %w", file, err)
		}

		if exists {
			continue
		}

		content, err := os.ReadFile(filepath.Join(migrationsDir, file))
		if err != nil {
			return fmt.Errorf("read migration %s: %w", file, err)
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin tx for %s: %w", file, err)
		}

		// Wait for any concurrent run, then re-check: it may have applied
		// this file while we waited. The lock is released at commit/rollback.
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", migrationLockKey); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("lock migrations: %w", err)
		}
		if err := tx.QueryRow(ctx,
			"SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)", file,
		).Scan(&exists); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("re-check migration %s: %w", file, err)
		}
		if exists {
			_ = tx.Rollback(ctx)
			continue
		}

		if _, err := tx.Exec(ctx, string(content)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %s: %w", file, err)
		}

		if _, err := tx.Exec(ctx,
			"INSERT INTO schema_migrations (version) VALUES ($1)", file,
		); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %s: %w", file, err)
		}

		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", file, err)
		}

		slog.Info("migration applied", "file", file)
	}

	return nil
}
