package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

var ErrConflict = errors.New("checksum conflict: note was modified by another device")

type SyncService struct {
	noteRepo  *repository.NoteRepo
	vaultRepo *repository.VaultRepo
}

func NewSyncService(noteRepo *repository.NoteRepo, vaultRepo *repository.VaultRepo) *SyncService {
	return &SyncService{
		noteRepo:  noteRepo,
		vaultRepo: vaultRepo,
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
	NoteID          string `json:"note_id"`
	ServerContent   string `json:"server_content"`
	ServerChecksum  string `json:"server_checksum"`
	ClientContent   string `json:"client_content"`
	ClientChecksum  string `json:"client_checksum"`
}

func (s *SyncService) CreateNote(ctx context.Context, vaultID, title, path, content, deviceID string) (*model.Note, error) {
	now := time.Now().UTC()
	checksum := ComputeChecksum(content)

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

	if err := s.noteRepo.Create(ctx, note); err != nil {
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
	if err := s.noteRepo.CreateVersion(ctx, version); err != nil {
		return nil, fmt.Errorf("create initial version: %w", err)
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
	defer tx.Rollback(ctx)

	note, err := s.noteRepo.GetByID(ctx, update.NoteID)
	if err != nil {
		return nil, nil, fmt.Errorf("get note for update: %w", err)
	}

	note.Content = update.Content
	note.Title = update.Title
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

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit transaction: %w", err)
	}

	return note, nil, nil
}

func (s *SyncService) GetNote(ctx context.Context, noteID string) (*model.Note, error) {
	return s.noteRepo.GetByID(ctx, noteID)
}

func (s *SyncService) ListNotes(ctx context.Context, vaultID string) ([]model.Note, error) {
	return s.noteRepo.ListByVault(ctx, vaultID)
}

func (s *SyncService) DeleteNote(ctx context.Context, noteID, vaultID string) error {
	return s.noteRepo.Delete(ctx, noteID, vaultID)
}

func (s *SyncService) GetVersions(ctx context.Context, noteID string) ([]model.NoteVersion, error) {
	return s.noteRepo.ListVersions(ctx, noteID)
}
