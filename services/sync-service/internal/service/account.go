package service

import (
	"context"
	"fmt"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// The account service depends on narrow interfaces so the destructive flow is
// fully unit-testable with fakes.
type accountUserStore interface {
	GetByID(ctx context.Context, id string) (*model.User, error)
	Delete(ctx context.Context, id string) error
}

type accountVaultStore interface {
	ListByUser(ctx context.Context, userID string) ([]model.Vault, error)
}

type accountNoteStore interface {
	ListByVault(ctx context.Context, vaultID string) ([]model.Note, error)
}

type searchCleaner interface {
	DeleteVaultNotes(vaultIDs []string)
}

type sessionCloser interface {
	DisconnectUser(userID string)
}

// vaultFileRemover deletes a vault's attachment files from object storage.
type vaultFileRemover interface {
	RemoveVaultFiles(ctx context.Context, vaultIDs ...string)
}

// AccountService handles account-level lifecycle operations: GDPR erasure and
// data-portability export.
type AccountService struct {
	users  accountUserStore
	vaults accountVaultStore
	notes  accountNoteStore
	search searchCleaner
	hub    sessionCloser
	files  vaultFileRemover // nil when attachments are disabled
}

// SetFileCleanup lets account deletion also erase attachment files (#290).
func (s *AccountService) SetFileCleanup(files vaultFileRemover) {
	s.files = files
}

func NewAccountService(users accountUserStore, vaults accountVaultStore, notes accountNoteStore, search searchCleaner, hub sessionCloser) *AccountService {
	return &AccountService{users: users, vaults: vaults, notes: notes, search: search, hub: hub}
}

// DeleteAccount permanently erases the user and everything they own. The
// password is re-verified so a stolen session token alone cannot destroy an
// account. PostgreSQL cascades take care of vaults, notes, versions, links,
// tags, devices and attachment rows; the search index, attachment files in
// object storage and live WebSocket sessions are external and cleaned up
// explicitly.
func (s *AccountService) DeleteAccount(ctx context.Context, userID, password string) error {
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("get user: %w", err)
	}

	ok, _, err := verifyPassword(user.PasswordHash, password)
	if err != nil {
		return fmt.Errorf("verify password: %w", err)
	}
	if !ok {
		return ErrInvalidCredentials
	}

	// Snapshot vault IDs before the cascade removes them.
	vaults, err := s.vaults.ListByUser(ctx, userID)
	if err != nil {
		return fmt.Errorf("list vaults: %w", err)
	}

	if err := s.users.Delete(ctx, userID); err != nil {
		return fmt.Errorf("delete user: %w", err)
	}

	if len(vaults) > 0 {
		vaultIDs := make([]string, len(vaults))
		for i, v := range vaults {
			vaultIDs[i] = v.ID
		}
		s.search.DeleteVaultNotes(vaultIDs)
		if s.files != nil {
			s.files.RemoveVaultFiles(ctx, vaultIDs...)
		}
	}
	s.hub.DisconnectUser(userID)

	return nil
}
