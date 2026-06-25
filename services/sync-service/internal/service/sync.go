package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/search"
)

var ErrConflict = errors.New("checksum conflict: note was modified by another device")

type SyncService struct {
	noteRepo  *repository.NoteRepo
	vaultRepo *repository.VaultRepo
	linkRepo  *repository.LinkRepo
	tagRepo   *repository.TagRepo
	indexer   *search.Indexer
}

func NewSyncService(noteRepo *repository.NoteRepo, vaultRepo *repository.VaultRepo, linkRepo *repository.LinkRepo, tagRepo *repository.TagRepo, indexer *search.Indexer) *SyncService {
	return &SyncService{
		noteRepo:  noteRepo,
		vaultRepo: vaultRepo,
		linkRepo:  linkRepo,
		tagRepo:   tagRepo,
		indexer:   indexer,
	}
}

type NoteUpdate struct {
	NoteID       string `json:"note_id"`
	Content      string `json:"content"`
	Title        string `json:"title"`
	Path         string `json:"path"`
	PrevChecksum string `json:"prev_checksum"`
	DeviceID     string `json:"device_id"`
}

type ConflictInfo struct {
	NoteID         string `json:"note_id"`
	ServerContent  string `json:"server_content"`
	ServerChecksum string `json:"server_checksum"`
	ClientContent  string `json:"client_content"`
	ClientChecksum string `json:"client_checksum"`
}

func (s *SyncService) CreateNote(ctx context.Context, vaultID, title, path, content, deviceID string) (*model.Note, error) {
	now := time.Now().UTC()
	checksum := ComputeChecksum(content)

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
	if err := s.noteRepo.CreateVersionTx(ctx, tx, version); err != nil {
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

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	if s.indexer != nil {
		noteID := note.ID
		doc := search.NoteDoc{
			ID:        note.ID,
			VaultID:   note.VaultID,
			Title:     note.Title,
			Path:      note.Path,
			UpdatedAt: note.UpdatedAt.Format(time.RFC3339),
		}
		go func() {
			// Omit content and tags for encrypted vaults
			if vault, err := s.vaultRepo.GetByID(context.Background(), note.VaultID); err == nil && !vault.IsEncrypted {
				doc.Content = note.Content
				doc.Tags = mergeTags(content)
			}
			if bls, err := s.GetBacklinks(context.Background(), noteID); err == nil {
				for _, bl := range bls {
					doc.BacklinkTitles = append(doc.BacklinkTitles, bl.Title)
				}
			}
			s.indexer.IndexNote(doc)
		}()
	}

	return note, nil
}

func (s *SyncService) UpdateNote(ctx context.Context, update NoteUpdate) (*model.Note, *ConflictInfo, error) {
	currentChecksum, err := s.noteRepo.GetByChecksum(ctx, update.NoteID)
	if err != nil {
		return nil, nil, fmt.Errorf("get current checksum: %w", err)
	}

	if currentChecksum != update.PrevChecksum {
		existing, err := s.noteRepo.GetByID(ctx, update.NoteID)
		if err != nil {
			return nil, nil, fmt.Errorf("get existing note for conflict: %w", err)
		}

		conflict := &ConflictInfo{
			NoteID:         update.NoteID,
			ServerContent:  existing.Content,
			ServerChecksum: existing.Checksum,
			ClientContent:  update.Content,
			ClientChecksum: ComputeChecksum(update.Content),
		}
		return nil, conflict, ErrConflict
	}

	newChecksum := ComputeChecksum(update.Content)
	now := time.Now().UTC()

	tx, err := s.noteRepo.BeginTx(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	note, err := s.noteRepo.GetByID(ctx, update.NoteID)
	if err != nil {
		return nil, nil, fmt.Errorf("get note for update: %w", err)
	}

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
	if err := s.noteRepo.CreateVersionTx(ctx, tx, version); err != nil {
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

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit transaction: %w", err)
	}

	if s.indexer != nil {
		noteID := note.ID
		savedContent := update.Content
		doc := search.NoteDoc{
			ID:        note.ID,
			VaultID:   note.VaultID,
			Title:     note.Title,
			Path:      note.Path,
			UpdatedAt: note.UpdatedAt.Format(time.RFC3339),
		}
		go func() {
			if vault, err := s.vaultRepo.GetByID(context.Background(), note.VaultID); err == nil && !vault.IsEncrypted {
				doc.Content = savedContent
				doc.Tags = mergeTags(savedContent)
			}
			if bls, err := s.GetBacklinks(context.Background(), noteID); err == nil {
				for _, bl := range bls {
					doc.BacklinkTitles = append(doc.BacklinkTitles, bl.Title)
				}
			}
			s.indexer.IndexNote(doc)
		}()
	}

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

func (s *SyncService) DeleteNote(ctx context.Context, noteID, vaultID string) error {
	if err := s.noteRepo.Delete(ctx, noteID, vaultID); err != nil {
		return err
	}
	if s.indexer != nil {
		s.indexer.DeleteNote(noteID)
	}
	return nil
}

func (s *SyncService) GetVersions(ctx context.Context, noteID string) ([]model.NoteVersion, error) {
	return s.noteRepo.ListVersions(ctx, noteID)
}

func (s *SyncService) GetBacklinks(ctx context.Context, noteID string) ([]model.BacklinkNote, error) {
	return s.linkRepo.GetBacklinks(ctx, noteID)
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
