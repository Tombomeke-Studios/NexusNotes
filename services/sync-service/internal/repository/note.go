package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

type NoteRepo struct {
	pool *pgxpool.Pool
}

func NewNoteRepo(pool *pgxpool.Pool) *NoteRepo {
	return &NoteRepo{pool: pool}
}

func (r *NoteRepo) Create(ctx context.Context, note *model.Note) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO notes (id, vault_id, path, title, content, checksum, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		note.ID, note.VaultID, note.Path, note.Title, note.Content, note.Checksum, note.CreatedAt, note.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert note: %w", err)
	}
	return nil
}

func (r *NoteRepo) CreateTx(ctx context.Context, tx pgx.Tx, note *model.Note) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO notes (id, vault_id, path, title, content, checksum, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		note.ID, note.VaultID, note.Path, note.Title, note.Content, note.Checksum, note.CreatedAt, note.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert note tx: %w", err)
	}
	return nil
}

func (r *NoteRepo) GetByID(ctx context.Context, id string) (*model.Note, error) {
	var n model.Note
	err := r.pool.QueryRow(ctx,
		`SELECT id, vault_id, path, title, content, checksum, created_at, updated_at
		 FROM notes WHERE id = $1`,
		id,
	).Scan(&n.ID, &n.VaultID, &n.Path, &n.Title, &n.Content, &n.Checksum, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get note: %w", err)
	}
	return &n, nil
}

func (r *NoteRepo) ListByVault(ctx context.Context, vaultID string) ([]model.Note, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, vault_id, path, title, content, checksum, created_at, updated_at
		 FROM notes WHERE vault_id = $1 ORDER BY path`,
		vaultID,
	)
	if err != nil {
		return nil, fmt.Errorf("list notes: %w", err)
	}
	defer rows.Close()

	var notes []model.Note
	for rows.Next() {
		var n model.Note
		if err := rows.Scan(&n.ID, &n.VaultID, &n.Path, &n.Title, &n.Content, &n.Checksum, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan note: %w", err)
		}
		notes = append(notes, n)
	}
	return notes, nil
}

func (r *NoteRepo) Update(ctx context.Context, note *model.Note) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE notes SET path = $1, title = $2, content = $3, checksum = $4, updated_at = $5
		 WHERE id = $6 AND vault_id = $7`,
		note.Path, note.Title, note.Content, note.Checksum, note.UpdatedAt, note.ID, note.VaultID,
	)
	if err != nil {
		return fmt.Errorf("update note: %w", err)
	}
	return nil
}

func (r *NoteRepo) Delete(ctx context.Context, id, vaultID string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM notes WHERE id = $1 AND vault_id = $2`,
		id, vaultID,
	)
	if err != nil {
		return fmt.Errorf("delete note: %w", err)
	}
	return nil
}

func (r *NoteRepo) GetByChecksum(ctx context.Context, id string) (string, error) {
	var checksum string
	err := r.pool.QueryRow(ctx,
		`SELECT checksum FROM notes WHERE id = $1`,
		id,
	).Scan(&checksum)
	if err != nil {
		return "", fmt.Errorf("get checksum: %w", err)
	}
	return checksum, nil
}

func (r *NoteRepo) CreateVersion(ctx context.Context, version *model.NoteVersion) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO note_versions (id, note_id, content, checksum, device_id, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		version.ID, version.NoteID, version.Content, version.Checksum, version.DeviceID, version.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert note version: %w", err)
	}
	return nil
}

func (r *NoteRepo) ListVersions(ctx context.Context, noteID string) ([]model.NoteVersion, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, note_id, content, checksum, device_id, created_at
		 FROM note_versions WHERE note_id = $1 ORDER BY created_at DESC`,
		noteID,
	)
	if err != nil {
		return nil, fmt.Errorf("list versions: %w", err)
	}
	defer rows.Close()

	var versions []model.NoteVersion
	for rows.Next() {
		var v model.NoteVersion
		if err := rows.Scan(&v.ID, &v.NoteID, &v.Content, &v.Checksum, &v.DeviceID, &v.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan version: %w", err)
		}
		versions = append(versions, v)
	}
	return versions, nil
}

func (r *NoteRepo) UpdateTx(ctx context.Context, tx pgx.Tx, note *model.Note) error {
	_, err := tx.Exec(ctx,
		`UPDATE notes SET path = $1, title = $2, content = $3, checksum = $4, updated_at = $5
		 WHERE id = $6 AND vault_id = $7`,
		note.Path, note.Title, note.Content, note.Checksum, note.UpdatedAt, note.ID, note.VaultID,
	)
	if err != nil {
		return fmt.Errorf("update note tx: %w", err)
	}
	return nil
}

func (r *NoteRepo) CreateVersionTx(ctx context.Context, tx pgx.Tx, version *model.NoteVersion) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO note_versions (id, note_id, content, checksum, device_id, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		version.ID, version.NoteID, version.Content, version.Checksum, version.DeviceID, version.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert note version tx: %w", err)
	}
	return nil
}

func (r *NoteRepo) BeginTx(ctx context.Context) (pgx.Tx, error) {
	return r.pool.Begin(ctx)
}

// Search performs a case-insensitive full-text search across title, content, tags, and aliases.
// Returns up to 50 results ordered by recency. Each result includes matched tags.
func (r *NoteRepo) Search(ctx context.Context, vaultID, query string) ([]model.NoteSearchResult, error) {
	pattern := "%" + strings.ToLower(query) + "%"

	rows, err := r.pool.Query(ctx, `
		SELECT DISTINCT n.id, n.vault_id, n.path, n.title, n.updated_at,
		       left(n.content, 300) AS snippet
		FROM notes n
		LEFT JOIN note_tags  nt ON nt.note_id = n.id
		LEFT JOIN note_aliases na ON na.note_id = n.id
		WHERE n.vault_id = $1
		  AND (
		      lower(n.title)   LIKE $2
		   OR lower(n.content) LIKE $2
		   OR lower(nt.tag)    LIKE $2
		   OR lower(na.alias)  LIKE $2
		  )
		ORDER BY n.updated_at DESC
		LIMIT 50
	`, vaultID, pattern)
	if err != nil {
		return nil, fmt.Errorf("search notes: %w", err)
	}
	defer rows.Close()

	var results []model.NoteSearchResult
	for rows.Next() {
		var r model.NoteSearchResult
		if err := rows.Scan(&r.ID, &r.VaultID, &r.Path, &r.Title, &r.UpdatedAt, &r.Snippet); err != nil {
			return nil, fmt.Errorf("scan search result: %w", err)
		}
		results = append(results, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate search results: %w", err)
	}

	// Fetch tags for each result in a single batch query.
	if len(results) > 0 {
		ids := make([]string, len(results))
		for i, res := range results {
			ids[i] = res.ID
		}
		tagMap, err := r.fetchTagsForNotes(ctx, ids)
		if err != nil {
			return nil, err
		}
		for i, res := range results {
			if tags, ok := tagMap[res.ID]; ok {
				results[i].Tags = tags
			} else {
				results[i].Tags = []string{}
			}
		}
	}

	return results, nil
}

// fetchTagsForNotes returns a map of noteID → []tag for a set of note IDs.
func (r *NoteRepo) fetchTagsForNotes(ctx context.Context, noteIDs []string) (map[string][]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT note_id, tag FROM note_tags WHERE note_id = ANY($1)`,
		noteIDs,
	)
	if err != nil {
		return nil, fmt.Errorf("fetch tags for notes: %w", err)
	}
	defer rows.Close()

	result := make(map[string][]string)
	for rows.Next() {
		var noteID, tag string
		if err := rows.Scan(&noteID, &tag); err != nil {
			return nil, fmt.Errorf("scan tag row: %w", err)
		}
		result[noteID] = append(result[noteID], tag)
	}
	return result, rows.Err()
}
