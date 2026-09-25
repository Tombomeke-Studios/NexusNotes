package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// fakeRefreshStore keeps refresh tokens in memory, keyed by hash.
type fakeRefreshStore struct {
	rows      map[string]*repository.RefreshToken // hash -> row
	nextID    int
	getErr    error // when set, GetByHash fails with it (simulates a database outage)
	rotateErr error // when set, Rotate fails with it and changes nothing
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
	if f.getErr != nil {
		return nil, f.getErr
	}
	row, ok := f.rows[hash]
	if !ok {
		return nil, repository.ErrRefreshTokenNotFound
	}
	copied := *row
	return &copied, nil
}

// Rotate is atomic like the real store: on failure nothing changes.
func (f *fakeRefreshStore) Rotate(ctx context.Context, oldID, userID, deviceID, newHash string, expiresAt time.Time) error {
	if f.rotateErr != nil {
		return f.rotateErr
	}
	for _, row := range f.rows {
		if row.ID == oldID {
			if row.UsedAt != nil {
				return repository.ErrRefreshTokenReused
			}
			now := time.Now()
			row.UsedAt = &now
		}
	}
	return f.Create(ctx, userID, deviceID, newHash, expiresAt)
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

// A store failure is not a rejected token: the caller must be able to tell
// them apart, or a database outage would sign every client out.
func TestRefresh_StoreFailureIsNotReportedAsInvalidToken(t *testing.T) {
	store := newFakeRefreshStore()
	store.getErr = errors.New("connection refused")
	svc := newRefreshAuthService(store)

	_, _, err := svc.Refresh(context.Background(), "any-token", "device")
	if err == nil {
		t.Fatal("expected an error")
	}
	if errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("a store failure must not be reported as an invalid token, got %v", err)
	}
}

// A rotation that fails part-way must not burn the presented token: the client
// retries with it, and a half-applied rotation would look like token reuse and
// revoke the whole device chain.
func TestRefresh_FailedRotationKeepsTheOldTokenUsable(t *testing.T) {
	store := newFakeRefreshStore()
	svc := newRefreshAuthService(store)
	token, err := svc.IssueRefreshToken(context.Background(), "user-1", "device-1")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	store.rotateErr = errors.New("write failed")
	if _, _, err := svc.Refresh(context.Background(), token, "device-1"); err == nil || errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("a failed rotation should be a server error, got %v", err)
	}

	store.rotateErr = nil
	if _, _, err := svc.Refresh(context.Background(), token, "device-1"); err != nil {
		t.Fatalf("the old token must still work after a failed rotation: %v", err)
	}
}

// Two refreshes racing with the same token: the store lets only one rotate;
// the other is treated as reuse.
func TestRefresh_LosingAConcurrentRotationIsReuse(t *testing.T) {
	store := newFakeRefreshStore()
	svc := newRefreshAuthService(store)
	token, _ := svc.IssueRefreshToken(context.Background(), "user-1", "device-1")

	store.rotateErr = repository.ErrRefreshTokenReused
	if _, _, err := svc.Refresh(context.Background(), token, "device-1"); !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("losing the rotation race must be rejected as reuse, got %v", err)
	}
}
