package repository

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
)

// encryptedColumn is one column the repositories encrypt at rest, with the
// key columns that identify its rows.
type encryptedColumn struct {
	table  string
	keys   []string
	column string
	field  string
}

// encryptedColumns lists every encrypted column; the backfill walks them all.
// Add a column here whenever a repository starts sealing one.
var encryptedColumns = []encryptedColumn{
	{"notes", []string{"id"}, "content", fieldNoteContent},
	{"note_versions", []string{"id"}, "content", fieldVersionContent},
	{"vaults", []string{"id"}, "name", fieldVaultName},
	{"linked_files", []string{"id"}, "display_name", fieldLinkedFileName},
	{"linked_files", []string{"id"}, "source_ref", fieldLinkedFileSource},
	{"linked_file_annotations", []string{"linked_file_id", "user_id"}, "content", fieldAnnotation},
	{"users", []string{"id"}, "display_name", fieldUserDisplayName},
	{"users", []string{"id"}, "email", fieldUserEmail},
	{"devices", []string{"id"}, "name", fieldDeviceName},
}

// BackfillEncryption rewrites every value that is not yet encrypted under the
// current key: plaintext from before encryption at rest (#357), or ciphertext
// under a retired key after a rotation. Email addresses get their blind index
// (re)computed at the same time. It works in batches of batchSize rows, skips
// a row that changed underneath it (the writer encrypted it already), and is
// safe to interrupt and run again. Returns how many values it rewrote.
func BackfillEncryption(ctx context.Context, pool *pgxpool.Pool, crypt *fieldcrypt.Cipher, batchSize int) (int, error) {
	total := 0
	for _, col := range encryptedColumns {
		n, err := backfillColumn(ctx, pool, crypt, col, batchSize)
		total += n
		if err != nil {
			return total, fmt.Errorf("backfill %s.%s: %w", col.table, col.column, err)
		}
	}
	return total, nil
}

func backfillColumn(ctx context.Context, pool *pgxpool.Pool, crypt *fieldcrypt.Cipher, col encryptedColumn, batchSize int) (int, error) {
	keyList := strings.Join(col.keys, ", ")
	// Keyset pagination: ($2, $3, ...) are the last row's keys of the batch before.
	cursorParams := make([]string, len(col.keys))
	for i := range col.keys {
		cursorParams[i] = fmt.Sprintf("$%d", i+2)
	}
	selectSQL := fmt.Sprintf(
		`SELECT %s, %s FROM %s WHERE NOT starts_with(%s, $1) AND (%s) > (%s) ORDER BY %s LIMIT %d`,
		keyList, col.column, col.table, col.column, keyList, strings.Join(cursorParams, ", "), keyList, batchSize)

	var where []string
	for i, k := range col.keys {
		where = append(where, fmt.Sprintf("%s = $%d", k, i+3))
	}
	set := col.column + " = $1"
	if col.field == fieldUserEmail {
		set += fmt.Sprintf(", email_index = $%d", len(col.keys)+3)
	}
	// "AND column = $2": only overwrite the value that was read, never a newer write.
	updateSQL := fmt.Sprintf(`UPDATE %s SET %s WHERE %s AND %s = $2`, col.table, set, strings.Join(where, " AND "), col.column)

	cursor := make([]any, len(col.keys))
	for i := range cursor {
		cursor[i] = ""
	}
	rewritten := 0
	for {
		type row struct {
			keys  []any
			value string
		}
		rows, err := pool.Query(ctx, selectSQL, append([]any{crypt.CurrentPrefix()}, cursor...)...)
		if err != nil {
			return rewritten, err
		}
		var batch []row
		for rows.Next() {
			keys := make([]string, len(col.keys))
			dest := make([]any, 0, len(keys)+1)
			for i := range keys {
				dest = append(dest, &keys[i])
			}
			var value string
			dest = append(dest, &value)
			if err := rows.Scan(dest...); err != nil {
				rows.Close()
				return rewritten, err
			}
			r := row{value: value}
			for _, k := range keys {
				r.keys = append(r.keys, k)
			}
			batch = append(batch, r)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return rewritten, err
		}
		if len(batch) == 0 {
			return rewritten, nil
		}

		for _, r := range batch {
			plain, err := crypt.Decrypt(col.field, r.value)
			if err != nil {
				// Not ours to fix (unknown key, corrupted value): leave it and
				// say which row, so an operator can restore the key.
				slog.Warn("backfill: cannot decrypt value; left as is", "table", col.table, "column", col.column, "row", r.keys, "error", err)
				continue
			}
			enc, err := crypt.Encrypt(col.field, plain)
			if err != nil {
				return rewritten, err
			}
			args := append([]any{enc, r.value}, r.keys...)
			if col.field == fieldUserEmail {
				args = append(args, crypt.BlindIndex(fieldUserEmail, normalizeEmail(plain)))
			}
			tag, err := pool.Exec(ctx, updateSQL, args...)
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
				// Two legacy accounts whose addresses differ only in case.
				slog.Warn("backfill: email address collides with another account; left unencrypted", "row", r.keys)
				continue
			}
			if err != nil {
				return rewritten, err
			}
			rewritten += int(tag.RowsAffected())
		}
		cursor = batch[len(batch)-1].keys
	}
}
