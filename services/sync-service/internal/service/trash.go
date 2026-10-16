package service

import (
	"context"
	"fmt"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/metrics"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// MaxTrashBatch caps how many notes one trash request moves.
const MaxTrashBatch = 1000

// SetTrashRetention sets how long trashed notes are kept (TRASH_RETENTION_DAYS);
// it only feeds the purge_at the trash list reports.
func (s *SyncService) SetTrashRetention(d time.Duration) {
	if d > 0 {
		s.trashRetention = d
	}
}

// TrashNotes moves the vault's live notes among ids to the trash in one
// transaction and returns the ones it moved (#569). Links to them now resolve
// as missing (or to another live note with the same title), and they leave
// the search index. Ids that are not live notes of the vault are skipped.
func (s *SyncService) TrashNotes(ctx context.Context, vaultID string, ids []string) ([]model.TrashedNote, error) {
	tx, err := s.noteRepo.BeginTx(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	trashed, err := s.noteRepo.TrashTx(ctx, tx, vaultID, ids, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	if err := s.linkRepo.ReresolveTitlesTx(ctx, tx, vaultID, noteTitles(trashed)); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit trash: %w", err)
	}
	for i, n := range trashed {
		trashed[i].PurgeAt = n.DeletedAt.Add(s.trashRetention)
		if s.indexer != nil {
			s.indexer.DeleteNote(n.ID)
		}
		metrics.NoteOps.WithLabelValues("trash").Inc()
	}
	return trashed, nil
}

// RestoreNote takes a note out of the vault's trash, back at its original
// path, and returns it with its content (#569). Links to its title resolve to
// it again, its own links are resolved afresh, and it is re-indexed.
// ErrNoteNotFound when the note is not in the vault's trash.
func (s *SyncService) RestoreNote(ctx context.Context, vaultID, noteID string) (*model.Note, error) {
	tx, err := s.noteRepo.BeginTx(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	note, err := s.noteRepo.RestoreTx(ctx, tx, vaultID, noteID)
	if err != nil {
		return nil, err
	}
	if err := s.linkRepo.ReresolveTitlesTx(ctx, tx, vaultID, []string{note.Title}); err != nil {
		return nil, err
	}
	if err := s.linkRepo.ResolveTargetsTx(ctx, tx, vaultID, note.ID); err != nil {
		return nil, fmt.Errorf("resolve links: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit restore: %w", err)
	}
	s.indexAsync(note)
	metrics.NoteOps.WithLabelValues("restore").Inc()
	return note, nil
}

// TrashedNoteVault returns the vault of a note in the trash, or
// ErrNoteNotFound.
func (s *SyncService) TrashedNoteVault(ctx context.Context, noteID string) (string, error) {
	return s.noteRepo.TrashedVaultID(ctx, noteID)
}

// ListTrash lists the vault's trashed notes, most recently trashed first,
// each with when the purge job will delete it.
func (s *SyncService) ListTrash(ctx context.Context, vaultID string) ([]model.TrashedNote, error) {
	notes, err := s.noteRepo.ListTrash(ctx, vaultID)
	if err != nil {
		return nil, err
	}
	for i := range notes {
		notes[i].PurgeAt = notes[i].DeletedAt.Add(s.trashRetention)
	}
	return notes, nil
}

// TrashedIDs returns the ids of every note in the vault's trash.
func (s *SyncService) TrashedIDs(ctx context.Context, vaultID string) ([]string, error) {
	return s.noteRepo.TrashedIDs(ctx, vaultID)
}

// PurgeNote deletes a trashed note of the vault for good, with its versions
// and attachment rows, in one transaction (#569). It returns the note's
// attachment storage keys, for the caller to remove now that the rows are
// gone, and whether there was such a trashed note.
func (s *SyncService) PurgeNote(ctx context.Context, vaultID, noteID string) ([]string, bool, error) {
	keys, purged, err := s.noteRepo.PurgeTrashed(ctx, vaultID, noteID, time.Time{})
	if err != nil || !purged {
		return nil, purged, err
	}
	if s.indexer != nil {
		s.indexer.DeleteNote(noteID)
	}
	metrics.NoteOps.WithLabelValues("purge").Inc()
	return keys, true, nil
}

// LiveNoteIDs reports which of ids are live notes of the vault.
func (s *SyncService) LiveNoteIDs(ctx context.Context, vaultID string, ids []string) (map[string]bool, error) {
	return s.noteRepo.LiveIDs(ctx, vaultID, ids)
}

// noteTitles returns the distinct titles of notes.
func noteTitles(notes []model.TrashedNote) []string {
	seen := make(map[string]bool, len(notes))
	titles := make([]string, 0, len(notes))
	for _, n := range notes {
		if !seen[n.Title] {
			seen[n.Title] = true
			titles = append(titles, n.Title)
		}
	}
	return titles
}
