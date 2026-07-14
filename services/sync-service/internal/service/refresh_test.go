package service

import (
	"context"
	"testing"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// fakeRefreshStore keeps refresh tokens in memory, keyed by hash.
type fakeRefreshStore struct {
	rows   map[string]*repository.RefreshToken // hash -> row
	nextID int
}

func newFakeRefreshStore() *fakeRefreshStore {
	return &fakeRefreshStore{rows: map[string]*repository.RefreshToken{}}
}

func (f *fakeRefreshStore) Create(_ context.Context, userID, deviceID, hash string, expiresAt time.Time) error {
	f.nextID++
	f.rows[hash] = &repository.RefreshToken{
		ID: string(rune('a' + f.nextID)), UserID: userID, DeviceID: deviceID, ExpiresAt: expiresAt,
	}
	return nil
}

func (f *fakeRefreshStore) GetByHash(_ context.Context, hash string) (*repository.RefreshToken, error) {
	row, ok := f.rows[hash]
	if !ok {
		return nil, repository.ErrRefreshTokenNotFound
	}
	copied := *row
	return &copied, nil
}

func (f *fakeRefreshStore) MarkUsed(_ context.Context, id string) error {
	now := time.Now()
	for _, row := range f.rows {
		if row.ID == id {
			row.UsedAt = &now
		}
	}
	return nil
}

func (f *fakeRefreshStore) Delete(_ context.Context, id string) error {
	for hash, row := range f.rows {
		if row.ID == id {
			delete(f.rows, hash)
		}
	}
	return nil
}

func (f *fakeRefreshStore) DeleteByUserDevice(_ context.Context, userID, deviceID string) error {
	for hash, row := range f.rows {
		if row.UserID == userID && row.DeviceID == deviceID {
			delete(f.rows, hash)
		}
	}
	return nil
}

func newRefreshAuthService(store *fakeRefreshStore) *AuthService {
	s := NewAuthService(&fakeUserStore{}, "test-secret")
	s.SetRefreshStore(store)
	return s
}

func TestRefresh_RotatesToken(t *testing.T) {
	store := newFakeRefreshStore()
	s := newRefreshAuthService(store)
	ctx := context.Background()

	first, err := s.IssueRefreshToken(ctx, "u1", "d1")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	access, second, err := s.Refresh(ctx, first, "d1")
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if access == "" || second == "" || second == first {
		t.Fatalf("expected a fresh access + rotated refresh token")
	}
	// The access token must validate.
	if _, err := s.ValidateToken(access); err != nil {
		t.Fatalf("access token invalid: %v", err)
	}
	// The new refresh token works exactly once as well.
	if _, _, err := s.Refresh(ctx, second, "d1"); err != nil {
		t.Fatalf("second rotation: %v", err)
	}
}

func TestRefresh_ReuseRevokesTheDeviceChain(t *testing.T) {
	store := newFakeRefreshStore()
	s := newRefreshAuthService(store)
	ctx := context.Background()

	first, _ := s.IssueRefreshToken(ctx, "u1", "d1")
	_, second, err := s.Refresh(ctx, first, "d1")
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}

	// Replaying the consumed token must fail AND kill the live chain.
	if _, _, err := s.Refresh(ctx, first, "d1"); err == nil {
		t.Fatal("expected reuse to be rejected")
	}
	if _, _, err := s.Refresh(ctx, second, "d1"); err == nil {
		t.Fatal("expected the whole chain to be revoked after reuse")
	}
}

func TestRefresh_RejectsExpiredAndForeignDevice(t *testing.T) {
	store := newFakeRefreshStore()
	s := newRefreshAuthService(store)
	ctx := context.Background()

	token, _ := s.IssueRefreshToken(ctx, "u1", "d1")

	// Wrong device: rejected without revoking the chain.
	if _, _, err := s.Refresh(ctx, token, "other-device"); err == nil {
		t.Fatal("expected a device mismatch to be rejected")
	}
	if _, _, err := s.Refresh(ctx, token, "d1"); err != nil {
		t.Fatalf("chain should survive a device mismatch: %v", err)
	}

	// Expired: rejected and removed.
	expired, _ := s.IssueRefreshToken(ctx, "u2", "d2")
	store.rows[hashRefreshToken(expired)].ExpiresAt = time.Now().Add(-time.Minute)
	if _, _, err := s.Refresh(ctx, expired, "d2"); err == nil {
		t.Fatal("expected an expired token to be rejected")
	}
}

func TestLogout_DeletesTheToken(t *testing.T) {
	store := newFakeRefreshStore()
	s := newRefreshAuthService(store)
	ctx := context.Background()

	token, _ := s.IssueRefreshToken(ctx, "u1", "d1")
	s.Logout(ctx, token)
	if _, _, err := s.Refresh(ctx, token, "d1"); err == nil {
		t.Fatal("expected a logged-out token to be rejected")
	}
	// Unknown tokens are a silent no-op.
	s.Logout(ctx, "never-issued")
}
