package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// BenchmarkListPage_10kNotes reads the first page of a 10,000-note vault and
// then walks the whole vault page by page (#220; target: a page well under
// 50 ms). Needs DATABASE_URL:
//
//	go test ./internal/repository -run '^$' -bench ListPage -benchtime 20x
func BenchmarkListPage_10kNotes(b *testing.B) {
	pool := newIsolatedDB(b)
	ctx := context.Background()
	repo := NewNoteRepo(pool, testCipher(b))
	vaultID := seedVault(b, pool)

	const total = 10_000
	content, err := repo.seal(fieldNoteContent, "# A note\n\nWith a few lines of text, a [[link]] and a #tag.\n")
	if err != nil {
		b.Fatal(err)
	}
	now := time.Now().UTC()
	rows := make([][]any, total)
	for i := range rows {
		rows[i] = []any{uuid.NewString(), vaultID, fmt.Sprintf("folder-%02d/note-%05d.md", i%40, i), fmt.Sprintf("Note %d", i), content, "c", now, now}
	}
	if _, err := pool.CopyFrom(ctx, pgx.Identifier{"notes"},
		[]string{"id", "vault_id", "path", "title", "content", "checksum", "created_at", "updated_at"},
		pgx.CopyFromRows(rows)); err != nil {
		b.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "ANALYZE notes"); err != nil {
		b.Fatal(err)
	}

	b.Run("first page", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, _, err := repo.ListPage(ctx, vaultID, 500, NoteCursor{}); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("whole vault", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			var after NoteCursor
			seen := 0
			for {
				page, next, err := repo.ListPage(ctx, vaultID, 500, after)
				if err != nil {
					b.Fatal(err)
				}
				seen += len(page)
				if next == nil {
					break
				}
				after = *next
			}
			if seen != total {
				b.Fatalf("walked %d notes, want %d", seen, total)
			}
		}
	})
}
