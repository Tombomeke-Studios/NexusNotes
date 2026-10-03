package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// Errors of ConvertVaultToE2EE.
var (
	ErrConvertNotStandard    = errors.New("vault is already end-to-end encrypted")
	ErrConvertNotesChanged   = errors.New("the vault's notes changed while converting; reload and try again")
	ErrConvertHasAttachments = errors.New("vaults with attachments cannot be end-to-end encrypted yet")
	ErrConvertMissingMeta    = errors.New("encryption_meta is required")
	ErrConvertMissingTitle   = errors.New("every note needs its encrypted title")
)

// ConvertNote is one note re-encrypted by the client: its sealed title and
// folder path (#362), its ciphertext, the plaintext checksum, and the server
// checksum it was read at.
type ConvertNote struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Path         string `json:"path"`
	Content      string `json:"content"`
	Checksum     string `json:"checksum"`
	BaseChecksum string `json:"base_checksum"`
}

// ConvertVaultToE2EE turns a standard vault into an e2ee one (#361). The
// client sends every note encrypted under the new vault key; in one
// transaction the server checks it got exactly the vault's notes as they are
// now (else ErrConvertNotesChanged, so the client re-reads and retries),
// swaps in the ciphertext, deletes the plaintext it still holds about the
// vault (stored versions, tags, aliases, links) and switches the vault to
// e2ee. Only the owner may convert; a vault with attachments is refused
// until attachments can be end-to-end encrypted (#238).
func (s *SyncService) ConvertVaultToE2EE(ctx context.Context, vaultID, userID string, meta json.RawMessage, notes []ConvertNote) error {
	if len(meta) == 0 {
		return ErrConvertMissingMeta
	}
	tx, err := s.noteRepo.BeginTx(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	vault, err := s.vaultRepo.GetForUpdateTx(ctx, tx, vaultID)
	if err != nil {
		return err
	}
	if vault.UserID != userID {
		return repository.ErrVaultNotFound
	}
	if vault.Encryption == model.VaultEncryptionE2EE {
		return ErrConvertNotStandard
	}
	for _, n := range notes {
		if n.Title == "" {
			return ErrConvertMissingTitle
		}
	}
	if has, err := s.noteRepo.VaultHasAttachmentsTx(ctx, tx, vaultID); err != nil {
		return err
	} else if has {
		return ErrConvertHasAttachments
	}

	current, err := s.noteRepo.ChecksumsForUpdateTx(ctx, tx, vaultID)
	if err != nil {
		return err
	}
	if len(notes) != len(current) {
		return ErrConvertNotesChanged
	}
	seen := make(map[string]bool, len(notes))
	for _, n := range notes {
		sum, ok := current[n.ID]
		if !ok || seen[n.ID] || sum != n.BaseChecksum {
			return ErrConvertNotesChanged
		}
		seen[n.ID] = true
	}

	now := time.Now().UTC()
	for _, n := range notes {
		if err := s.noteRepo.ReplaceSealedTx(ctx, tx, n.ID, vaultID, n.Title, n.Path, n.Content, n.Checksum, now); err != nil {
			return err
		}
	}
	if err := s.noteRepo.DropPlaintextDerivativesTx(ctx, tx, vaultID); err != nil {
		return err
	}
	if err := s.vaultRepo.SetE2EETx(ctx, tx, vaultID, meta); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit conversion: %w", err)
	}

	// Re-index without content: the vault is e2ee now, so searchDoc keeps
	// only the sealed titles and paths, replacing the documents that held
	// plaintext.
	if s.indexer != nil {
		if list, err := s.noteRepo.ListByVault(ctx, vaultID); err == nil {
			for i := range list {
				s.indexAsync(&list[i])
			}
		}
	}
	return nil
}
