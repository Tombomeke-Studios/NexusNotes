package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/metrics"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/search"
)

var ErrConflict = errors.New("checksum conflict: note was modified by another device")

// ErrNoteNotFound is returned when the note does not exist (or was deleted
// while an update was waiting for it).
var ErrNoteNotFound = repository.ErrNoteNotFound

// ErrNoteBusy is returned when another save held the note for too long;
// the client can simply retry.
var ErrNoteBusy = repository.ErrNoteLocked

type SyncService struct {
	noteRepo  *repository.NoteRepo
	vaultRepo *repository.VaultRepo
	linkRepo  *repository.LinkRepo
	tagRepo   *repository.TagRepo
	aliasRepo *repository.AliasRepo
	linkFiles *repository.LinkedFileRepo
	indexer   *search.Indexer
	// lockTimeout bounds how long an update waits for a note another save holds.
	lockTimeout string
}

func NewSyncService(noteRepo *repository.NoteRepo, vaultRepo *repository.VaultRepo, linkRepo *repository.LinkRepo, tagRepo *repository.TagRepo, aliasRepo *repository.AliasRepo, linkFiles *repository.LinkedFileRepo, indexer *search.Indexer) *SyncService {
	return &SyncService{
		noteRepo:    noteRepo,
		vaultRepo:   vaultRepo,
		linkRepo:    linkRepo,
		tagRepo:     tagRepo,
		aliasRepo:   aliasRepo,
		linkFiles:   linkFiles,
		indexer:     indexer,
		lockTimeout: "5s",
	}
}

type NoteUpdate struct {
	NoteID       string `json:"note_id"`
	Content      string `json:"content"`
	Title        string `json:"title"`
	Path         string `json:"path"`
	PrevChecksum string `json:"prev_checksum"`
	// Checksum is the client-computed plaintext hash; only honoured for e2ee
	// vaults where the server cannot hash the plaintext itself.
	Checksum string `json:"checksum"`
	DeviceID string `json:"device_id"`
	// NewVersion starts a new history snapshot instead of updating the
	// device's open one (restores, #417).
	NewVersion bool `json:"-"`
}

type ConflictInfo struct {
	NoteID         string `json:"note_id"`
	ServerContent  string `json:"server_content"`
	ServerChecksum string `json:"server_checksum"`
	ClientContent  string `json:"client_content"`
	ClientChecksum string `json:"client_checksum"`
}

func (s *SyncService) CreateNote(ctx context.Context, vaultID, title, path, content, deviceID, clientChecksum string) (*model.Note, error) {
	now := time.Now().UTC()
	vault, err := s.vaultRepo.GetByID(ctx, vaultID)
	if err != nil {
		return nil, fmt.Errorf("get vault: %w", err)
	}
	checksum := resolveChecksum(vault.Encryption, content, clientChecksum)

	fm, _ := ParseFrontmatter(content)
	if fm.Title != "" {
		title = fm.Title
	}

	note := &model.Note{
		ID:        uuid.New().String(),
		VaultID:   vaultID,
		Path:      path,
		Title:     title,
		Content:   content,
		Checksum:  checksum,
		CreatedAt: now,
		UpdatedAt: now,
	}

	tx, err := s.noteRepo.BeginTx(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := s.noteRepo.CreateTx(ctx, tx, note); err != nil {
		return nil, fmt.Errorf("create note: %w", err)
	}

	version := &model.NoteVersion{
		ID:        uuid.New().String(),
		NoteID:    note.ID,
		Content:   content,
		Checksum:  checksum,
		DeviceID:  deviceID,
		CreatedAt: now,
	}
	// A new note has a single version: nothing to trim yet.
	keep := model.VersionRetention{KeepCount: repository.MaxNoteVersions}
	if err := s.noteRepo.RecordVersionTx(ctx, tx, version, repository.VersionSnapshotWindow, keep); err != nil {
		return nil, fmt.Errorf("create initial version: %w", err)
	}

	links := buildNoteLinks(vaultID, note.ID, content)
	if err := s.linkRepo.UpsertLinksTx(ctx, tx, vaultID, note.ID, links); err != nil {
		return nil, fmt.Errorf("upsert links: %w", err)
	}
	if err := s.linkRepo.ResolveTargetsTx(ctx, tx, vaultID, note.ID); err != nil {
		return nil, fmt.Errorf("resolve links: %w", err)
	}

	if err := s.tagRepo.UpsertTagsTx(ctx, tx, note.ID, mergeTags(content)); err != nil {
		return nil, fmt.Errorf("upsert tags: %w", err)
	}

	if err := s.aliasRepo.UpsertAliasesTx(ctx, tx, note.ID, fm.Aliases); err != nil {
		return nil, fmt.Errorf("upsert aliases: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	s.indexAsync(note)

	metrics.NoteOps.WithLabelValues("create").Inc()
	return note, nil
}

func (s *SyncService) UpdateNote(ctx context.Context, update NoteUpdate) (*model.Note, *ConflictInfo, error) {
	tx, err := s.noteRepo.BeginTx(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock the row before comparing checksums: the optimistic-lock check and the
	// write must be one atomic step, otherwise two saves that both saw the same
	// previous checksum both pass the check and the later one silently overwrites
	// the earlier (#256). Concurrent saves queue here; the loser then sees the
	// winner's checksum and gets a conflict.
	if err := s.noteRepo.SetLockTimeoutTx(ctx, tx, s.lockTimeout); err != nil {
		return nil, nil, err
	}
	note, err := s.noteRepo.GetForUpdateTx(ctx, tx, update.NoteID)
	if err != nil {
		return nil, nil, err
	}

	if note.Checksum != update.PrevChecksum {
		conflict := &ConflictInfo{
			NoteID:         update.NoteID,
			ServerContent:  note.Content,
			ServerChecksum: note.Checksum,
			ClientContent:  update.Content,
			ClientChecksum: firstNonEmpty(update.Checksum, ComputeChecksum(update.Content)),
		}
		return nil, conflict, ErrConflict
	}

	vault, err := s.vaultRepo.GetByIDTx(ctx, tx, note.VaultID)
	if err != nil {
		return nil, nil, fmt.Errorf("get vault: %w", err)
	}
	newChecksum := resolveChecksum(vault.Encryption, update.Content, update.Checksum)
	now := time.Now().UTC()

	fm, _ := ParseFrontmatter(update.Content)
	effectiveTitle := update.Title
	if fm.Title != "" {
		effectiveTitle = fm.Title
	}

	note.Content = update.Content
	note.Title = effectiveTitle
	note.Path = update.Path
	note.Checksum = newChecksum
	note.UpdatedAt = now

	if err := s.noteRepo.UpdateTx(ctx, tx, note); err != nil {
		return nil, nil, fmt.Errorf("update note: %w", err)
	}

	version := &model.NoteVersion{
		ID:        uuid.New().String(),
		NoteID:    note.ID,
		Content:   update.Content,
		Checksum:  newChecksum,
		DeviceID:  update.DeviceID,
		CreatedAt: now,
	}
	window := repository.VersionSnapshotWindow
	if update.NewVersion {
		window = 0
	}
	keep, err := s.vaultRepo.GetVersionRetentionTx(ctx, tx, note.VaultID)
	if err != nil {
		return nil, nil, err
	}
	if err := s.noteRepo.RecordVersionTx(ctx, tx, version, window, keep); err != nil {
		return nil, nil, fmt.Errorf("create version: %w", err)
	}

	links := buildNoteLinks(note.VaultID, note.ID, update.Content)
	if err := s.linkRepo.UpsertLinksTx(ctx, tx, note.VaultID, note.ID, links); err != nil {
		return nil, nil, fmt.Errorf("upsert links: %w", err)
	}
	if err := s.linkRepo.ResolveTargetsTx(ctx, tx, note.VaultID, note.ID); err != nil {
		return nil, nil, fmt.Errorf("resolve links: %w", err)
	}

	if err := s.tagRepo.UpsertTagsTx(ctx, tx, note.ID, mergeTags(update.Content)); err != nil {
		return nil, nil, fmt.Errorf("upsert tags: %w", err)
	}

	if err := s.aliasRepo.UpsertAliasesTx(ctx, tx, note.ID, fm.Aliases); err != nil {
		return nil, nil, fmt.Errorf("upsert aliases: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit transaction: %w", err)
	}

	s.indexAsync(note)

	metrics.NoteOps.WithLabelValues("update").Inc()
	return note, nil, nil
}

func (s *SyncService) GetVaultTags(ctx context.Context, vaultID string) ([]model.TagCount, error) {
	return s.tagRepo.GetVaultTags(ctx, vaultID)
}

func (s *SyncService) GetNote(ctx context.Context, noteID string) (*model.Note, error) {
	return s.noteRepo.GetByID(ctx, noteID)
}

func (s *SyncService) ListNotes(ctx context.Context, vaultID string) ([]model.Note, error) {
	return s.noteRepo.ListByVault(ctx, vaultID)
}

// ListNotesPage is one page of a vault's notes (#461); next is nil after the last.
func (s *SyncService) ListNotesPage(ctx context.Context, vaultID string, limit int, after repository.NoteCursor) ([]model.Note, *repository.NoteCursor, error) {
	return s.noteRepo.ListPage(ctx, vaultID, limit, after)
}

func (s *SyncService) DeleteNote(ctx context.Context, noteID, vaultID string) error {
	if err := s.noteRepo.Delete(ctx, noteID, vaultID); err != nil {
		return err
	}
	if s.indexer != nil {
		s.indexer.DeleteNote(noteID)
	}
	metrics.NoteOps.WithLabelValues("delete").Inc()
	return nil
}

// RestoreVersion makes a stored version the note's content again (#417). It
// is an update against prevChecksum like any save, so a note changed in the
// meantime is a conflict, and it always starts a new version: the text it
// replaces stays in the history. The version's checksum is reused, so e2ee
// ciphertext restores without the server reading it.
func (s *SyncService) RestoreVersion(ctx context.Context, noteID, versionID, prevChecksum, deviceID string) (*model.Note, *ConflictInfo, error) {
	note, err := s.noteRepo.GetByID(ctx, noteID)
	if err != nil {
		return nil, nil, err
	}
	version, err := s.noteRepo.GetVersion(ctx, noteID, versionID)
	if err != nil {
		return nil, nil, err
	}
	return s.UpdateNote(ctx, NoteUpdate{
		NoteID:       noteID,
		Title:        note.Title,
		Path:         note.Path,
		Content:      version.Content,
		Checksum:     version.Checksum,
		PrevChecksum: prevChecksum,
		DeviceID:     deviceID,
		NewVersion:   true,
	})
}

// ErrInvalidRetention is returned for a retention outside the accepted range.
var ErrInvalidRetention = fmt.Errorf("keep between 1 and %d versions, and 0 to %d days", model.MaxVersionKeepCount, model.MaxVersionKeepDays)

// GetVersionRetention reads how much history the vault keeps (#418).
func (s *SyncService) GetVersionRetention(ctx context.Context, vaultID string) (model.VersionRetention, error) {
	return s.vaultRepo.GetVersionRetention(ctx, vaultID)
}

// StorageStats reports how much the vault stores (#220).
func (s *SyncService) StorageStats(ctx context.Context, vaultID string) (model.VaultStorageStats, error) {
	return s.noteRepo.StorageStats(ctx, vaultID)
}

// SetVersionRetention changes the vault's retention and trims its notes'
// history to it right away, rather than at the next save or daily cleanup.
func (s *SyncService) SetVersionRetention(ctx context.Context, vaultID string, keep model.VersionRetention) error {
	if keep.KeepCount < 1 || keep.KeepCount > model.MaxVersionKeepCount || keep.KeepDays < 0 || keep.KeepDays > model.MaxVersionKeepDays {
		return ErrInvalidRetention
	}
	if err := s.vaultRepo.SetVersionRetention(ctx, vaultID, keep); err != nil {
		return err
	}
	_, err := s.noteRepo.PruneVersions(ctx, vaultID)
	return err
}

// GetVersions lists a note's versions without their content (#414).
func (s *SyncService) GetVersions(ctx context.Context, noteID string) ([]model.NoteVersion, error) {
	return s.noteRepo.ListVersionInfo(ctx, noteID)
}

// GetVersion loads one version of a note, content included.
func (s *SyncService) GetVersion(ctx context.Context, noteID, versionID string) (*model.NoteVersion, error) {
	return s.noteRepo.GetVersion(ctx, noteID, versionID)
}

func (s *SyncService) GetBacklinks(ctx context.Context, noteID string) ([]model.BacklinkNote, error) {
	return s.linkRepo.GetBacklinks(ctx, noteID)
}

func (s *SyncService) SearchNotes(ctx context.Context, vaultID, query string) ([]model.NoteSearchResult, error) {
	return s.noteRepo.Search(ctx, vaultID, query)
}

// buildNoteLinks converts parsed wikilinks into model.NoteLink values ready for persistence.
func buildNoteLinks(vaultID, sourceNoteID, content string) []model.NoteLink {
	parsed := ParseLinks(content)
	links := make([]model.NoteLink, len(parsed))
	for i, p := range parsed {
		links[i] = model.NoteLink{
			ID:           uuid.New().String(),
			VaultID:      vaultID,
			SourceNoteID: sourceNoteID,
			TargetTitle:  p.TargetTitle,
			Anchor:       p.Anchor,
		}
	}
	return links
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
