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

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/mail"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// Email verification and password reset (#47/#48). Tokens are opaque, stored
// hashed, single-use and short-lived. To avoid account enumeration the
// "forgot password" flow never reveals whether an address exists.

var ErrResetTokenInvalid = errors.New("reset token invalid, expired or used")

const (
	verificationTTL = 24 * time.Hour
	resetTTL        = time.Hour
)

// ActionTokenStore is the single-use token persistence (email verification and
// password reset both satisfy it; *repository.AuthTokenRepo implements it).
type ActionTokenStore interface {
	Create(ctx context.Context, userID, tokenHash string, expiresAt time.Time) error
	Consume(ctx context.Context, tokenHash string) (string, error)
}

// EmailUserStore is the subset of user persistence the flows touch.
type EmailUserStore interface {
	GetByEmail(ctx context.Context, email string) (*model.User, error)
	SetEmailVerified(ctx context.Context, id string) error
	UpdatePasswordHash(ctx context.Context, id, passwordHash string) error
}

// EmailAuthService orchestrates verification and reset.
type EmailAuthService struct {
	users      EmailUserStore
	verifyRepo ActionTokenStore
	resetRepo  ActionTokenStore
	refresh    resetRevoker
	mailer     mail.Mailer
	baseURL    string
}

// resetRevoker lets a password reset kill every existing session of the user.
type resetRevoker interface {
	DeleteByUser(ctx context.Context, userID string) error
}

func NewEmailAuthService(
	users EmailUserStore,
	verifyRepo, resetRepo ActionTokenStore,
	refresh resetRevoker,
	mailer mail.Mailer,
	baseURL string,
) *EmailAuthService {
	return &EmailAuthService{
		users:      users,
		verifyRepo: verifyRepo,
		resetRepo:  resetRepo,
		refresh:    refresh,
		mailer:     mailer,
		baseURL:    baseURL,
	}
}

func hashActionToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newActionToken() (raw, hash string, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", fmt.Errorf("generate token: %w", err)
	}
	raw = base64.RawURLEncoding.EncodeToString(buf)
	return raw, hashActionToken(raw), nil
}

// MailEnabled reports whether real emails go out (drives the verification gate).
func (s *EmailAuthService) MailEnabled() bool { return s.mailer.Enabled() }

// SendVerification issues a verification token and emails the link (#47).
func (s *EmailAuthService) SendVerification(ctx context.Context, userID, email string) error {
	raw, hash, err := newActionToken()
	if err != nil {
		return err
	}
	if err := s.verifyRepo.Create(ctx, userID, hash, time.Now().UTC().Add(verificationTTL)); err != nil {
		return err
	}
	link := fmt.Sprintf("%s/verify-email?token=%s", s.baseURL, raw)
	body := fmt.Sprintf("Welcome to NexusNotes!\n\nConfirm your email address by opening:\n%s\n\nThe link expires in 24 hours.", link)
	if err := s.mailer.Send(email, "Verify your NexusNotes email", body); err != nil {
		slog.Error("send verification email", "error", err)
		return err
	}
	return nil
}

// VerifyEmail consumes a verification token and flags the address confirmed.
func (s *EmailAuthService) VerifyEmail(ctx context.Context, token string) error {
	userID, err := s.verifyRepo.Consume(ctx, hashActionToken(token))
	if err != nil {
		return err
	}
	return s.users.SetEmailVerified(ctx, userID)
}

// RequestPasswordReset emails a reset link when the address exists (#48).
// It always returns nil to the caller so responses never reveal existence.
func (s *EmailAuthService) RequestPasswordReset(ctx context.Context, email string) {
	user, err := s.users.GetByEmail(ctx, email)
	if err != nil || user == nil {
		return
	}
	raw, hash, err := newActionToken()
	if err != nil {
		slog.Error("password reset token generation", "error", err)
		return
	}
	if err := s.resetRepo.Create(ctx, user.ID, hash, time.Now().UTC().Add(resetTTL)); err != nil {
		slog.Error("store password reset token", "error", err)
		return
	}
	link := fmt.Sprintf("%s/reset-password?token=%s", s.baseURL, raw)
	body := fmt.Sprintf("A password reset was requested for your NexusNotes account.\n\nReset it here:\n%s\n\nThe link expires in 1 hour. If you didn't request this, ignore this email.", link)
	if err := s.mailer.Send(email, "Reset your NexusNotes password", body); err != nil {
		slog.Error("send password reset email", "error", err)
	}
}

// ResetPassword consumes a reset token, sets the new password and revokes all
// existing sessions so a leaked token can't outlive the reset.
func (s *EmailAuthService) ResetPassword(ctx context.Context, token, newPassword string) error {
	userID, err := s.resetRepo.Consume(ctx, hashActionToken(token))
	if err != nil {
		return ErrResetTokenInvalid
	}
	hash, err := hashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	if err := s.users.UpdatePasswordHash(ctx, userID, hash); err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if s.refresh != nil {
		if err := s.refresh.DeleteByUser(ctx, userID); err != nil {
			slog.Warn("revoke sessions after reset", "user_id", userID, "error", err)
		}
	}
	return nil
}
