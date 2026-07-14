package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// Refresh token rotation (#49): long-lived opaque tokens stored hashed and
// bound to a device. Every use rotates the token; using an already-rotated
// token is the classic theft signal and revokes the whole device chain.

var ErrInvalidRefreshToken = errors.New("invalid refresh token")

const (
	// accessTokenTTL is short now that clients can refresh silently; it also
	// bounds how long a revoked device's JWT keeps working.
	accessTokenTTL  = time.Hour
	refreshTokenTTL = 30 * 24 * time.Hour
)

// RefreshStore is the persistence the rotation logic needs (fake-able in tests).
type RefreshStore interface {
	Create(ctx context.Context, userID, deviceID, tokenHash string, expiresAt time.Time) error
	GetByHash(ctx context.Context, tokenHash string) (*repository.RefreshToken, error)
	MarkUsed(ctx context.Context, id string) error
	Delete(ctx context.Context, id string) error
	DeleteByUserDevice(ctx context.Context, userID, deviceID string) error
}

// SetRefreshStore enables refresh-token issuing on this service.
func (s *AuthService) SetRefreshStore(store RefreshStore) {
	s.refreshStore = store
}

func hashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// IssueRefreshToken mints and stores a new refresh token for a device chain.
func (s *AuthService) IssueRefreshToken(ctx context.Context, userID, deviceID string) (string, error) {
	if s.refreshStore == nil {
		return "", errors.New("refresh store not configured")
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate refresh token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	expiry := time.Now().UTC().Add(refreshTokenTTL)
	if err := s.refreshStore.Create(ctx, userID, deviceID, hashRefreshToken(token), expiry); err != nil {
		return "", err
	}
	return token, nil
}

// Refresh exchanges a valid refresh token for a fresh access + refresh pair.
// All failures collapse into ErrInvalidRefreshToken so callers leak nothing.
func (s *AuthService) Refresh(ctx context.Context, refreshToken, deviceID string) (accessToken, newRefreshToken string, err error) {
	if s.refreshStore == nil {
		return "", "", ErrInvalidRefreshToken
	}
	stored, err := s.refreshStore.GetByHash(ctx, hashRefreshToken(refreshToken))
	if err != nil {
		return "", "", ErrInvalidRefreshToken
	}
	if time.Now().After(stored.ExpiresAt) {
		_ = s.refreshStore.Delete(ctx, stored.ID)
		return "", "", ErrInvalidRefreshToken
	}
	if stored.UsedAt != nil {
		// Reuse of a rotated token: someone replayed it (theft or a broken
		// client). Revoke the entire device chain and force a re-login.
		slog.Warn("refresh token reuse detected; revoking device chain",
			"user_id", stored.UserID, "device_id", stored.DeviceID)
		_ = s.refreshStore.DeleteByUserDevice(ctx, stored.UserID, stored.DeviceID)
		return "", "", ErrInvalidRefreshToken
	}
	if stored.DeviceID != deviceID {
		return "", "", ErrInvalidRefreshToken
	}

	if err := s.refreshStore.MarkUsed(ctx, stored.ID); err != nil {
		return "", "", fmt.Errorf("rotate refresh token: %w", err)
	}
	accessToken, err = s.generateToken(stored.UserID)
	if err != nil {
		return "", "", err
	}
	newRefreshToken, err = s.IssueRefreshToken(ctx, stored.UserID, stored.DeviceID)
	if err != nil {
		return "", "", err
	}
	return accessToken, newRefreshToken, nil
}

// Logout invalidates one refresh token; unknown tokens are a silent no-op.
func (s *AuthService) Logout(ctx context.Context, refreshToken string) {
	if s.refreshStore == nil || refreshToken == "" {
		return
	}
	if stored, err := s.refreshStore.GetByHash(ctx, hashRefreshToken(refreshToken)); err == nil {
		_ = s.refreshStore.Delete(ctx, stored.ID)
	}
}
