package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

type LinkRepo struct {
	pool *pgxpool.Pool
}

func NewLinkRepo(pool *pgxpool.Pool) *LinkRepo {
	return &LinkRepo{pool: pool}
}

// UpsertLinksTx atomically replaces all links for a source note within an existing transaction.
func (r *LinkRepo) UpsertLinksTx(ctx context.Context, tx pgx.Tx, vaultID, sourceNoteID string, links []model.NoteLink) error {
	if _, err := tx.Exec(ctx,
		`DELETE FROM note_links WHERE source_note_id = $1`,
		sourceNoteID,
	); err != nil {
		return fmt.Errorf("delete existing links: %w", err)
	}

	if len(links) == 0 {
		return nil
	}

	now := time.Now().UTC()
	for i := range links {
		links[i].CreatedAt = now
		_, err := tx.Exec(ctx,
			`INSERT INTO note_links (id, vault_id, source_note_id, target_title, anchor, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			links[i].ID, vaultID, sourceNoteID, links[i].TargetTitle, links[i].Anchor, links[i].CreatedAt,
		)
		if err != nil {
			return fmt.Errorf("insert link: %w", err)
		}
	}
	return nil
}

// ResolveTargetsTx resolves target_note_id for unresolved links within the vault.
// Matches by exact title; first match wins when multiple notes share a title.
func (r *LinkRepo) ResolveTargetsTx(ctx context.Context, tx pgx.Tx, vaultID, sourceNoteID string) error {
	_, err := tx.Exec(ctx,
		`UPDATE note_links
		 SET target_note_id = (
		     SELECT n.id FROM notes n
		     WHERE n.vault_id = $1 AND n.title = note_links.target_title
		     ORDER BY n.created_at
		     LIMIT 1
		 )
		 WHERE source_note_id = $2`,
		vaultID, sourceNoteID,
	)
	if err != nil {
		return fmt.Errorf("resolve link targets: %w", err)
	}
	return nil
}

// GetBacklinks returns all notes that contain a [[wikilink]] pointing to targetNoteID.
func (r *LinkRepo) GetBacklinks(ctx context.Context, targetNoteID string) ([]model.BacklinkNote, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT n.id, n.vault_id, n.path, n.title, n.updated_at
		 FROM note_links nl
		 JOIN notes n ON n.id = nl.source_note_id
		 WHERE nl.target_note_id = $1
		 ORDER BY n.title`,
		targetNoteID,
	)
	if err != nil {
		return nil, fmt.Errorf("query backlinks: %w", err)
	}
	defer rows.Close()

	var backlinks []model.BacklinkNote
	for rows.Next() {
		var b model.BacklinkNote
		if err := rows.Scan(&b.ID, &b.VaultID, &b.Path, &b.Title, &b.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan backlink: %w", err)
		}
		backlinks = append(backlinks, b)
	}
	return backlinks, nil
}
