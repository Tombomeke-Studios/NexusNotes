package repository

import (
	"context"
	"testing"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

func TestMCPTokenRepo_UseAndPruneAudit(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	repo := NewMCPTokenRepo(pool, testCipher(t))
	vaultID := seedVault(t, pool)
	var userID string
	if err := pool.QueryRow(ctx, `SELECT user_id FROM vaults WHERE id = $1`, vaultID).Scan(&userID); err != nil {
		t.Fatal(err)
	}

	tok := &model.MCPToken{UserID: userID, Name: "Claude", Scope: model.MCPScopeRead}
	if err := repo.Create(ctx, tok, "hash-1"); err != nil {
		t.Fatal(err)
	}
	if got, err := repo.GetByHash(ctx, "hash-1"); err != nil || got == nil || got.Name != "Claude" || got.LastUsedAt != nil {
		t.Fatalf("GetByHash: %+v %v", got, err)
	}
	if got, err := repo.GetByHash(ctx, "nope"); err != nil || got != nil {
		t.Fatalf("unknown hash: %+v %v", got, err)
	}

	for _, tool := range []string{"list_notes", "read_note"} {
		if err := repo.Use(ctx, tok.ID, tool, "GET /api/x"); err != nil {
			t.Fatal(err)
		}
	}
	if got, _ := repo.GetByHash(ctx, "hash-1"); got.LastUsedAt == nil {
		t.Fatal("last_used_at not set")
	}
	entries, err := repo.Audit(ctx, userID, tok.ID, 10)
	if err != nil || len(entries) != 2 || entries[0].Tool != "read_note" {
		t.Fatalf("audit newest first: %+v %v", entries, err)
	}

	// Age one entry past the retention; pruning removes only that one.
	if _, err := pool.Exec(ctx, `UPDATE mcp_audit_log SET created_at = now() - interval '91 days' WHERE tool = 'list_notes'`); err != nil {
		t.Fatal(err)
	}
	if n, err := repo.PruneAudit(ctx, 90*24*time.Hour); err != nil || n != 1 {
		t.Fatalf("prune: %d %v", n, err)
	}
	// Revoking the token takes its audit entries with it.
	if ok, err := repo.Delete(ctx, userID, tok.ID); !ok || err != nil {
		t.Fatalf("delete: %v %v", ok, err)
	}
	var left int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mcp_audit_log`).Scan(&left); err != nil || left != 0 {
		t.Fatalf("audit rows left: %d %v", left, err)
	}
}
