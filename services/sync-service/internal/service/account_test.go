package service

import (
	"context"
	"errors"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

type fakeAccountUserStore struct {
	user      *model.User
	getErr    error
	deleteErr error
	deleted   []string
}

func (f *fakeAccountUserStore) GetByID(context.Context, string) (*model.User, error) {
	return f.user, f.getErr
}
func (f *fakeAccountUserStore) Delete(_ context.Context, id string) error {
	if f.deleteErr != nil {
		return f.deleteErr
	}
	f.deleted = append(f.deleted, id)
	return nil
}

type fakeAccountVaultStore struct {
	vaults  []model.Vault
	listErr error
}

func (f *fakeAccountVaultStore) ListByUser(context.Context, string) ([]model.Vault, error) {
	return f.vaults, f.listErr
}

type fakeSearchCleaner struct{ vaultIDs []string }

func (f *fakeSearchCleaner) DeleteVaultNotes(vaultIDs []string) { f.vaultIDs = vaultIDs }

type fakeSessionCloser struct{ disconnected []string }

func (f *fakeSessionCloser) DisconnectUser(userID string) {
	f.disconnected = append(f.disconnected, userID)
}

func accountFixture(t *testing.T) (*AccountService, *fakeAccountUserStore, *fakeAccountVaultStore, *fakeSearchCleaner, *fakeSessionCloser) {
	t.Helper()
	hash, err := hashPassword("correct-password")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	users := &fakeAccountUserStore{user: &model.User{ID: "u1", Email: "a@example.com", PasswordHash: hash}}
	vaults := &fakeAccountVaultStore{vaults: []model.Vault{{ID: "v1"}, {ID: "v2"}}}
	search := &fakeSearchCleaner{}
	hub := &fakeSessionCloser{}
	return NewAccountService(users, vaults, search, hub), users, vaults, search, hub
}

func TestDeleteAccount_Success(t *testing.T) {
	s, users, _, search, hub := accountFixture(t)

	if err := s.DeleteAccount(context.Background(), "u1", "correct-password"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(users.deleted) != 1 || users.deleted[0] != "u1" {
		t.Fatalf("deleted users = %v, want [u1]", users.deleted)
	}
	if len(search.vaultIDs) != 2 || search.vaultIDs[0] != "v1" || search.vaultIDs[1] != "v2" {
		t.Fatalf("search cleanup vaults = %v, want [v1 v2]", search.vaultIDs)
	}
	if len(hub.disconnected) != 1 || hub.disconnected[0] != "u1" {
		t.Fatalf("disconnected = %v, want [u1]", hub.disconnected)
	}
}

func TestDeleteAccount_WrongPasswordDeletesNothing(t *testing.T) {
	s, users, _, search, hub := accountFixture(t)

	err := s.DeleteAccount(context.Background(), "u1", "wrong-password")
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("err = %v, want ErrInvalidCredentials", err)
	}
	if len(users.deleted) != 0 || search.vaultIDs != nil || len(hub.disconnected) != 0 {
		t.Fatal("nothing may be deleted or disconnected on a failed password check")
	}
}

func TestDeleteAccount_UserNotFound(t *testing.T) {
	s, users, _, _, _ := accountFixture(t)
	users.user = nil
	users.getErr = repository.ErrUserNotFound

	err := s.DeleteAccount(context.Background(), "ghost", "whatever")
	if !errors.Is(err, repository.ErrUserNotFound) {
		t.Fatalf("err = %v, want ErrUserNotFound", err)
	}
}

func TestDeleteAccount_DeleteFailureSkipsCleanup(t *testing.T) {
	s, users, _, search, hub := accountFixture(t)
	users.deleteErr = errors.New("connection refused")

	if err := s.DeleteAccount(context.Background(), "u1", "correct-password"); err == nil {
		t.Fatal("expected an error")
	}
	if search.vaultIDs != nil || len(hub.disconnected) != 0 {
		t.Fatal("cleanup must not run when the database delete failed")
	}
}

func TestDeleteAccount_NoVaultsSkipsSearchCleanup(t *testing.T) {
	s, _, vaults, search, _ := accountFixture(t)
	vaults.vaults = nil

	if err := s.DeleteAccount(context.Background(), "u1", "correct-password"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if search.vaultIDs != nil {
		t.Fatalf("search cleanup called with %v for a user without vaults", search.vaultIDs)
	}
}
