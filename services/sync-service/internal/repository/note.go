package repository

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// ErrNoteNotFound is returned when a note does not exist.
var ErrNoteNotFound = errors.New("note not found")

// ErrVersionNotFound is returned when a note has no version with that id.
var ErrVersionNotFound = errors.New("version not found")

// ErrNoteLocked is returned when waiting for a note's row lock exceeded the
// transaction's lock_timeout (another save is holding it).
var ErrNoteLocked = errors.New("note is locked by another update")

// pgLockNotAvailable is Postgres' SQLSTATE for an exceeded lock_timeout.
const pgLockNotAvailable = "55P03"

// MaxNoteVersions is the default of how many stored versions a note keeps
// (a vault can change it, #418); older ones are pruned when a new one is
// added, so history does not grow without bound and content the user removed
// long ago does not linger (#387).
const MaxNoteVersions = 50

// VersionSnapshotWindow is how long a version keeps absorbing saves of the
// device that started it (#413). Autosave runs about every second; without
// this, history would hold a minute of typing instead of hours.
const VersionSnapshotWindow = 5 * time.Minute

const pruneVersionsSQL = `DELETE FROM note_versions WHERE note_id = $1 AND id NOT IN (
	SELECT id FROM note_versions WHERE note_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2)`

// pruneNoteRetentionSQL applies a retention ($2 versions, $3 days) to one
// note ($1); the newest version always stays (#418).
const pruneNoteRetentionSQL = `DELETE FROM note_versions WHERE id IN (
	SELECT id FROM (
		SELECT id, updated_at, row_number() OVER (ORDER BY created_at DESC, id DESC) AS rn
		FROM note_versions WHERE note_id = $1) ranked
	WHERE rn > $2 OR ($3 > 0 AND rn > 1 AND updated_at < now() - make_interval(days => $3)))`

// pruneVaultsRetentionSQL applies each vault's own retention to all its
// notes; $1 limits it to one vault ('' = every vault).
const pruneVaultsRetentionSQL = `DELETE FROM note_versions WHERE id IN (
	SELECT id FROM (
		SELECT nv.id, nv.updated_at, v.version_keep_count AS keep_count, v.version_keep_days AS keep_days,
			row_number() OVER (PARTITION BY nv.note_id ORDER BY nv.created_at DESC, nv.id DESC) AS rn
		FROM note_versions nv
		JOIN notes n ON n.id = nv.note_id
		JOIN vaults v ON v.id = n.vault_id
		WHERE $1 = '' OR v.id = $1) ranked
	WHERE rn > keep_count OR (keep_days > 0 AND rn > 1 AND updated_at < now() - make_interval(days => keep_days)))`

// PruneVersions applies each vault's retention to its notes' history (#418):
// one vault, or every vault when vaultID is empty (the daily cleanup).
func (r *NoteRepo) PruneVersions(ctx context.Context, vaultID string) (int64, error) {
	tag, err := r.pool.Exec(ctx, pruneVaultsRetentionSQL, vaultID)
	if err != nil {
		return 0, fmt.Errorf("prune versions: %w", err)
	}
	return tag.RowsAffected(), nil
}

// searchSnippetRunes is how much of a note's text a search result carries.
const searchSnippetRunes = 300

// NoteRepo stores notes with their content (and every stored version)
// encrypted at rest (#354); callers always see plaintext.
type NoteRepo struct {
	pool *pgxpool.Pool
	cryptor
}

func NewNoteRepo(pool *pgxpool.Pool, crypt *fieldcrypt.Cipher) *NoteRepo {
	return &NoteRepo{pool: pool, cryptor: cryptor{crypt}}
}

func (r *NoteRepo) Create(ctx context.Context, note *model.Note) error {
	content, err := r.seal(fieldNoteContent, note.Content)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx,
		`INSERT INTO notes (id, vault_id, path, title, content, checksum, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		note.ID, note.VaultID, note.Path, note.Title, content, note.Checksum, note.CreatedAt, note.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert note: %w", err)
	}
	return nil
}

func (r *NoteRepo) CreateTx(ctx context.Context, tx pgx.Tx, note *model.Note) error {
	content, err := r.seal(fieldNoteContent, note.Content)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO notes (id, vault_id, path, title, content, checksum, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		note.ID, note.VaultID, note.Path, note.Title, content, note.Checksum, note.CreatedAt, note.UpdatedAt,
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
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoteNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get note: %w", err)
	}
	if err := r.open(fieldNoteContent, &n.Content); err != nil {
		return nil, err
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
		if err := r.open(fieldNoteContent, &n.Content); err != nil {
			return nil, err
		}
		notes = append(notes, n)
	}
	return notes, nil
}

// NoteCursor marks where a page of ListPage ended: notes come in (path, id)
// order, so the next page starts after this pair (#461).
type NoteCursor struct {
	Path string
	ID   string
}

// String encodes the cursor for an API response header.
func (c NoteCursor) String() string {
	return base64.RawURLEncoding.EncodeToString([]byte(c.Path + "\x00" + c.ID))
}

// ParseNoteCursor decodes a cursor made by String.
func ParseNoteCursor(s string) (NoteCursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return NoteCursor{}, ErrInvalidCursor
	}
	path, id, ok := strings.Cut(string(raw), "\x00")
	if !ok || id == "" {
		return NoteCursor{}, ErrInvalidCursor
	}
	return NoteCursor{Path: path, ID: id}, nil
}

// ErrInvalidCursor is returned for a cursor ListPage did not make.
var ErrInvalidCursor = errors.New("invalid cursor")

// ListPage returns up to limit notes of the vault after the cursor (the zero
// cursor starts at the beginning) and the cursor of the next page, nil when
// this was the last one (#461).
func (r *NoteRepo) ListPage(ctx context.Context, vaultID string, limit int, after NoteCursor) ([]model.Note, *NoteCursor, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, vault_id, path, title, content, checksum, created_at, updated_at
		 FROM notes WHERE vault_id = $1 AND (path, id) > ($2, $3)
		 ORDER BY path, id LIMIT $4`,
		vaultID, after.Path, after.ID, limit+1,
	)
	if err != nil {
		return nil, nil, fmt.Errorf("list notes page: %w", err)
	}
	defer rows.Close()
	notes := []model.Note{}
	for rows.Next() {
		var n model.Note
		if err := rows.Scan(&n.ID, &n.VaultID, &n.Path, &n.Title, &n.Content, &n.Checksum, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, nil, fmt.Errorf("scan note: %w", err)
		}
		if err := r.open(fieldNoteContent, &n.Content); err != nil {
			return nil, nil, err
		}
		notes = append(notes, n)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	if len(notes) <= limit {
		return notes, nil, nil
	}
	notes = notes[:limit]
	last := notes[limit-1]
	return notes, &NoteCursor{Path: last.Path, ID: last.ID}, nil
}

// ChecksumsForUpdateTx returns every note of the vault (id -> checksum),
// row-locking them until tx ends so none can be saved meanwhile (#361).
func (r *NoteRepo) ChecksumsForUpdateTx(ctx context.Context, tx pgx.Tx, vaultID string) (map[string]string, error) {
	rows, err := tx.Query(ctx, `SELECT id, checksum FROM notes WHERE vault_id = $1 FOR NO KEY UPDATE`, vaultID)
	if err != nil {
		return nil, fmt.Errorf("lock vault notes: %w", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, sum string
		if err := rows.Scan(&id, &sum); err != nil {
			return nil, fmt.Errorf("scan note checksum: %w", err)
		}
		out[id] = sum
	}
	return out, rows.Err()
}

// VaultHasAttachmentsTx reports whether any note of the vault has a file.
func (r *NoteRepo) VaultHasAttachmentsTx(ctx context.Context, tx pgx.Tx, vaultID string) (bool, error) {
	var has bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM attachments WHERE vault_id = $1)`, vaultID).Scan(&has); err != nil {
		return false, fmt.Errorf("check attachments: %w", err)
	}
	return has, nil
}

// ReplaceSealedTx overwrites a note's title, path, content and checksum (the
// e2ee conversion swaps plaintext for client ciphertext, #361/#362).
func (r *NoteRepo) ReplaceSealedTx(ctx context.Context, tx pgx.Tx, id, vaultID, title, path, content, checksum string, at time.Time) error {
	sealed, err := r.seal(fieldNoteContent, content)
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx,
		`UPDATE notes SET title = $3, path = $4, content = $5, checksum = $6, updated_at = $7 WHERE id = $1 AND vault_id = $2`,
		id, vaultID, title, path, sealed, checksum, at,
	)
	if err != nil {
		return fmt.Errorf("replace note content: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNoteNotFound
	}
	return nil
}

// DropPlaintextDerivativesTx deletes what the server derived from a vault's
// plaintext: stored versions, tags, aliases and links. An e2ee vault must
// keep none of it (#361).
func (r *NoteRepo) DropPlaintextDerivativesTx(ctx context.Context, tx pgx.Tx, vaultID string) error {
	for _, q := range []string{
		`DELETE FROM note_versions WHERE note_id IN (SELECT id FROM notes WHERE vault_id = $1)`,
		`DELETE FROM note_tags WHERE note_id IN (SELECT id FROM notes WHERE vault_id = $1)`,
		`DELETE FROM note_aliases WHERE note_id IN (SELECT id FROM notes WHERE vault_id = $1)`,
		`DELETE FROM note_links WHERE vault_id = $1`,
	} {
		if _, err := tx.Exec(ctx, q, vaultID); err != nil {
			return fmt.Errorf("drop plaintext derivatives: %w", err)
		}
	}
	return nil
}

// ForEach calls fn with every note of every vault, decrypted, in batches of
// up to batchSize ordered by id (used to rebuild the search index, #365).
func (r *NoteRepo) ForEach(ctx context.Context, batchSize int, fn func([]model.Note) error) error {
	after := ""
	for {
		rows, err := r.pool.Query(ctx,
			`SELECT id, vault_id, path, title, content, checksum, created_at, updated_at
			 FROM notes WHERE id > $1 ORDER BY id LIMIT $2`,
			after, batchSize,
		)
		if err != nil {
			return fmt.Errorf("list notes: %w", err)
		}
		var batch []model.Note
		for rows.Next() {
			var n model.Note
			if err := rows.Scan(&n.ID, &n.VaultID, &n.Path, &n.Title, &n.Content, &n.Checksum, &n.CreatedAt, &n.UpdatedAt); err != nil {
				rows.Close()
				return fmt.Errorf("scan note: %w", err)
			}
			if err := r.open(fieldNoteContent, &n.Content); err != nil {
				rows.Close()
				return err
			}
			batch = append(batch, n)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("list notes: %w", err)
		}
		if len(batch) == 0 {
			return nil
		}
		if err := fn(batch); err != nil {
			return err
		}
		after = batch[len(batch)-1].ID
	}
}

func (r *NoteRepo) Update(ctx context.Context, note *model.Note) error {
	content, err := r.seal(fieldNoteContent, note.Content)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx,
		`UPDATE notes SET path = $1, title = $2, content = $3, checksum = $4, updated_at = $5
		 WHERE id = $6 AND vault_id = $7`,
		note.Path, note.Title, content, note.Checksum, note.UpdatedAt, note.ID, note.VaultID,
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

// GetForUpdateTx reads the note inside tx and row-locks it until the transaction
// ends. Concurrent updates of the same note therefore queue up behind each other,
// which makes "compare the checksum, then write" atomic (see SyncService.UpdateNote).
//
// FOR NO KEY UPDATE, not FOR UPDATE: resolving another note's links takes a
// FOR KEY SHARE lock on this row (the note_links foreign key), which FOR UPDATE
// would block, so two notes that link to each other would deadlock when saved
// at the same moment. The note's key never changes here, so the weaker lock is
// enough to serialise updates.
func (r *NoteRepo) GetForUpdateTx(ctx context.Context, tx pgx.Tx, id string) (*model.Note, error) {
	var n model.Note
	err := tx.QueryRow(ctx,
		`SELECT id, vault_id, path, title, content, checksum, created_at, updated_at
		 FROM notes WHERE id = $1 FOR NO KEY UPDATE`,
		id,
	).Scan(&n.ID, &n.VaultID, &n.Path, &n.Title, &n.Content, &n.Checksum, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoteNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgLockNotAvailable {
		return nil, ErrNoteLocked
	}
	if err != nil {
		return nil, fmt.Errorf("get note for update: %w", err)
	}
	if err := r.open(fieldNoteContent, &n.Content); err != nil {
		return nil, err
	}
	return &n, nil
}

func (r *NoteRepo) CreateVersion(ctx context.Context, version *model.NoteVersion) error {
	content, err := r.seal(fieldVersionContent, version.Content)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx,
		`INSERT INTO note_versions (id, note_id, content, checksum, device_id, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $6)`,
		version.ID, version.NoteID, content, version.Checksum, version.DeviceID, version.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert note version: %w", err)
	}
	if _, err := r.pool.Exec(ctx, pruneVersionsSQL, version.NoteID, MaxNoteVersions); err != nil {
		return fmt.Errorf("prune note versions: %w", err)
	}
	return nil
}

// ListVersionInfo lists a note's versions newest first without their content
// (#414); GetVersion loads one.
func (r *NoteRepo) ListVersionInfo(ctx context.Context, noteID string) ([]model.NoteVersion, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, note_id, checksum, device_id, created_at, updated_at
		 FROM note_versions WHERE note_id = $1 ORDER BY created_at DESC, id DESC`,
		noteID,
	)
	if err != nil {
		return nil, fmt.Errorf("list versions: %w", err)
	}
	defer rows.Close()
	versions := []model.NoteVersion{}
	for rows.Next() {
		var v model.NoteVersion
		if err := rows.Scan(&v.ID, &v.NoteID, &v.Checksum, &v.DeviceID, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan version: %w", err)
		}
		versions = append(versions, v)
	}
	return versions, rows.Err()
}

// GetVersion loads one version of noteID; ErrVersionNotFound when it does not
// exist or belongs to another note.
func (r *NoteRepo) GetVersion(ctx context.Context, noteID, versionID string) (*model.NoteVersion, error) {
	var v model.NoteVersion
	err := r.pool.QueryRow(ctx,
		`SELECT id, note_id, content, checksum, device_id, created_at, updated_at
		 FROM note_versions WHERE id = $1 AND note_id = $2`,
		versionID, noteID,
	).Scan(&v.ID, &v.NoteID, &v.Content, &v.Checksum, &v.DeviceID, &v.CreatedAt, &v.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrVersionNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get version: %w", err)
	}
	if err := r.open(fieldVersionContent, &v.Content); err != nil {
		return nil, err
	}
	return &v, nil
}

func (r *NoteRepo) ListVersions(ctx context.Context, noteID string) ([]model.NoteVersion, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, note_id, content, checksum, device_id, created_at, updated_at
		 FROM note_versions WHERE note_id = $1 ORDER BY created_at DESC, id DESC`,
		noteID,
	)
	if err != nil {
		return nil, fmt.Errorf("list versions: %w", err)
	}
	defer rows.Close()

	var versions []model.NoteVersion
	for rows.Next() {
		var v model.NoteVersion
		if err := rows.Scan(&v.ID, &v.NoteID, &v.Content, &v.Checksum, &v.DeviceID, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan version: %w", err)
		}
		if err := r.open(fieldVersionContent, &v.Content); err != nil {
			return nil, err
		}
		versions = append(versions, v)
	}
	return versions, nil
}

func (r *NoteRepo) UpdateTx(ctx context.Context, tx pgx.Tx, note *model.Note) error {
	content, err := r.seal(fieldNoteContent, note.Content)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`UPDATE notes SET path = $1, title = $2, content = $3, checksum = $4, updated_at = $5
		 WHERE id = $6 AND vault_id = $7`,
		note.Path, note.Title, content, note.Checksum, note.UpdatedAt, note.ID, note.VaultID,
	)
	if err != nil {
		return fmt.Errorf("update note tx: %w", err)
	}
	return nil
}

// RecordVersionTx stores the note's new state in its history (#413). When the
// note's latest version was started by the same device less than window ago,
// that snapshot takes the new content; otherwise a new version starts, and
// the note's history is trimmed to the vault's retention (#418).
func (r *NoteRepo) RecordVersionTx(ctx context.Context, tx pgx.Tx, version *model.NoteVersion, window time.Duration, keep model.VersionRetention) error {
	content, err := r.seal(fieldVersionContent, version.Content)
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx,
		`UPDATE note_versions SET content = $2, checksum = $3, updated_at = $4
		 WHERE id = (SELECT id FROM note_versions WHERE note_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1)
		   AND device_id = $5 AND created_at > $6`,
		version.NoteID, content, version.Checksum, version.CreatedAt, version.DeviceID, version.CreatedAt.Add(-window),
	)
	if err != nil {
		return fmt.Errorf("update note snapshot: %w", err)
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	if err := r.CreateVersionTx(ctx, tx, version); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, pruneNoteRetentionSQL, version.NoteID, keep.KeepCount, keep.KeepDays); err != nil {
		return fmt.Errorf("prune note versions: %w", err)
	}
	return nil
}

func (r *NoteRepo) CreateVersionTx(ctx context.Context, tx pgx.Tx, version *model.NoteVersion) error {
	content, err := r.seal(fieldVersionContent, version.Content)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO note_versions (id, note_id, content, checksum, device_id, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $6)`,
		version.ID, version.NoteID, content, version.Checksum, version.DeviceID, version.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert note version tx: %w", err)
	}
	if _, err := tx.Exec(ctx, pruneVersionsSQL, version.NoteID, MaxNoteVersions); err != nil {
		return fmt.Errorf("prune note versions: %w", err)
	}
	return nil
}

// SetLockTimeoutTx bounds how long statements in tx wait for a row lock, so a
// stuck writer turns into an error instead of piling up requests.
func (r *NoteRepo) SetLockTimeoutTx(ctx context.Context, tx pgx.Tx, timeout string) error {
	if _, err := tx.Exec(ctx, "SELECT set_config('lock_timeout', $1, true)", timeout); err != nil {
		return fmt.Errorf("set lock timeout: %w", err)
	}
	return nil
}

func (r *NoteRepo) BeginTx(ctx context.Context) (pgx.Tx, error) {
	return r.pool.Begin(ctx)
}

// Search performs a case-insensitive search across title, content, tags, and
// aliases: the fallback when Meilisearch is unavailable. Content is encrypted
// at rest, so titles/tags/aliases are matched in SQL and content after
// decryption here. Returns up to 50 results ordered by recency, each with its
// matched tags.
func (r *NoteRepo) Search(ctx context.Context, vaultID, query string) ([]model.NoteSearchResult, error) {
	needle := strings.ToLower(query)
	pattern := "%" + needle + "%"

	rows, err := r.pool.Query(ctx, `
		SELECT n.id, n.vault_id, n.path, n.title, n.updated_at, n.content,
		       lower(n.title) LIKE $2
		    OR EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND lower(nt.tag) LIKE $2)
		    OR EXISTS (SELECT 1 FROM note_aliases na WHERE na.note_id = n.id AND lower(na.alias) LIKE $2)
		       AS meta_match
		FROM notes n
		WHERE n.vault_id = $1
		ORDER BY n.updated_at DESC
	`, vaultID, pattern)
	if err != nil {
		return nil, fmt.Errorf("search notes: %w", err)
	}
	defer rows.Close()

	var results []model.NoteSearchResult
	for rows.Next() && len(results) < 50 {
		var (
			res       model.NoteSearchResult
			content   string
			metaMatch bool
		)
		if err := rows.Scan(&res.ID, &res.VaultID, &res.Path, &res.Title, &res.UpdatedAt, &content, &metaMatch); err != nil {
			return nil, fmt.Errorf("scan search result: %w", err)
		}
		if err := r.open(fieldNoteContent, &content); err != nil {
			return nil, err
		}
		if !metaMatch && !strings.Contains(strings.ToLower(content), needle) {
			continue
		}
		res.Snippet = firstRunes(content, searchSnippetRunes)
		results = append(results, res)
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

// firstRunes returns at most n runes of s.
func firstRunes(s string, n int) string {
	i := 0
	for pos := range s {
		if i == n {
			return s[:pos]
		}
		i++
	}
	return s
}

// StorageStats counts a vault's notes, versions and attachments and their
// stored sizes (#220). Sizes are measured on the stored (encrypted) values;
// nothing is decrypted.
func (r *NoteRepo) StorageStats(ctx context.Context, vaultID string) (model.VaultStorageStats, error) {
	var s model.VaultStorageStats
	err := r.pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM notes WHERE vault_id = $1),
			(SELECT coalesce(sum(octet_length(content)), 0) FROM notes WHERE vault_id = $1),
			(SELECT count(*) FROM note_versions nv JOIN notes n ON n.id = nv.note_id WHERE n.vault_id = $1),
			(SELECT coalesce(sum(octet_length(nv.content)), 0) FROM note_versions nv JOIN notes n ON n.id = nv.note_id WHERE n.vault_id = $1),
			(SELECT count(*) FROM attachments WHERE vault_id = $1),
			(SELECT coalesce(sum(size_bytes), 0) FROM attachments WHERE vault_id = $1)`,
		vaultID,
	).Scan(&s.Notes, &s.ContentBytes, &s.Versions, &s.VersionBytes, &s.Attachments, &s.AttachmentBytes)
	if err != nil {
		return s, fmt.Errorf("vault storage stats: %w", err)
	}
	return s, nil
}
