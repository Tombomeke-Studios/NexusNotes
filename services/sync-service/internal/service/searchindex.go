package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/search"
)

// searchDoc builds a note's search document. Content, tags and aliases are
// only included for standard vaults: an e2ee vault's content is ciphertext,
// and when the vault cannot be loaded they are left out to be safe. vault may
// be nil, in which case it is looked up.
func (s *SyncService) searchDoc(ctx context.Context, note *model.Note, vault *model.Vault) search.NoteDoc {
	doc := search.NoteDoc{
		ID:        note.ID,
		VaultID:   note.VaultID,
		Title:     note.Title,
		Path:      note.Path,
		UpdatedAt: note.UpdatedAt.Format(time.RFC3339),
	}
	if vault == nil {
		if v, err := s.vaultRepo.GetByID(ctx, note.VaultID); err == nil {
			vault = v
		}
	}
	if vault != nil && vault.Encryption != model.VaultEncryptionE2EE {
		doc.Content = note.Content
		fm, _ := ParseFrontmatter(note.Content)
		doc.Tags = mergeTags(note.Content)
		doc.Aliases = fm.Aliases
	}
	if bls, err := s.GetBacklinks(ctx, note.ID); err == nil {
		for _, bl := range bls {
			doc.BacklinkTitles = append(doc.BacklinkTitles, bl.Title)
		}
	}
	return doc
}

// indexAsync indexes a saved note in the background, so saving never waits
// on the search service.
func (s *SyncService) indexAsync(note *model.Note) {
	if s.indexer == nil {
		return
	}
	snapshot := *note
	go func() {
		s.indexer.IndexNote(s.searchDoc(context.Background(), &snapshot, nil))
	}()
}

// RebuildSearchIndexIfEmpty refills an empty search index from the database
// and returns how many notes it indexed (#365). The index is derived data:
// operators keep it on an encrypted volume and out of backups, and after a
// restore (or a lost volume) this brings search back without manual steps.
// A populated index is left alone.
func (s *SyncService) RebuildSearchIndexIfEmpty(ctx context.Context) (int, error) {
	if s.indexer == nil {
		return 0, nil
	}
	count, err := s.indexer.DocumentCount(ctx)
	if err != nil {
		return 0, fmt.Errorf("count search documents: %w", err)
	}
	if count > 0 {
		return 0, nil
	}

	vaults := map[string]*model.Vault{}
	indexed := 0
	err = s.noteRepo.ForEach(ctx, 200, func(notes []model.Note) error {
		docs := make([]search.NoteDoc, 0, len(notes))
		for i := range notes {
			vault, ok := vaults[notes[i].VaultID]
			if !ok {
				if v, err := s.vaultRepo.GetByID(ctx, notes[i].VaultID); err == nil {
					vault = v
				}
				vaults[notes[i].VaultID] = vault
			}
			docs = append(docs, s.searchDoc(ctx, &notes[i], vault))
		}
		if err := s.indexer.IndexDocs(ctx, docs); err != nil {
			return fmt.Errorf("index batch: %w", err)
		}
		indexed += len(docs)
		return nil
	})
	if err != nil {
		return indexed, err
	}
	if indexed > 0 {
		slog.Info("search index rebuilt from the database", "notes", indexed)
	}
	return indexed, nil
}
