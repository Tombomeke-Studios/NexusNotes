package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/mail"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// DeletionGracePeriod is how long a requested account deletion waits before
// everything is erased; until then it can be cancelled (#289).
const DeletionGracePeriod = 7 * 24 * time.Hour

// deletionRequestTTL bounds the confirm link of a deletion asked for without
// signing in.
const deletionRequestTTL = 24 * time.Hour

// ErrDeletionTokenInvalid is returned for a bad, used or expired link.
var ErrDeletionTokenInvalid = errors.New("deletion link invalid, expired or already used")

type deletionUserStore interface {
	GetByID(ctx context.Context, id string) (*model.User, error)
	GetByEmail(ctx context.Context, email string) (*model.User, error)
	SetDeletionScheduled(ctx context.Context, id string, at *time.Time) error
	DeletionDue(ctx context.Context, now time.Time) ([]string, error)
}

type userEraser interface {
	EraseUser(ctx context.Context, userID string) error
}

// AccountDeletionService runs account deletion with a grace period (#289):
// a request signs the user out everywhere and schedules erasure 7 days out;
// an emailed link (or signing in and choosing to keep the account) cancels
// it; PurgeDue erases accounts whose time has come. Someone who cannot sign
// in can ask by email; the confirm link proves they own the address.
type AccountDeletionService struct {
	users    deletionUserStore
	eraser   userEraser
	cancels  ActionTokenStore
	requests ActionTokenStore
	sessions resetRevoker
	hub      sessionCloser
	mailer   mail.Mailer
	baseURL  string
	now      func() time.Time
}

func NewAccountDeletionService(
	users deletionUserStore,
	eraser userEraser,
	cancels, requests ActionTokenStore,
	sessions resetRevoker,
	hub sessionCloser,
	mailer mail.Mailer,
	baseURL string,
) *AccountDeletionService {
	return &AccountDeletionService{
		users: users, eraser: eraser, cancels: cancels, requests: requests,
		sessions: sessions, hub: hub, mailer: mailer, baseURL: baseURL,
		now: func() time.Time { return time.Now().UTC() },
	}
}

// Schedule starts the grace period for the signed-in user, after checking
// their password so a stolen session alone cannot do it.
func (s *AccountDeletionService) Schedule(ctx context.Context, userID, password string) (time.Time, error) {
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return time.Time{}, fmt.Errorf("get user: %w", err)
	}
	ok, _, err := verifyPassword(user.PasswordHash, password)
	if err != nil {
		return time.Time{}, fmt.Errorf("verify password: %w", err)
	}
	if !ok {
		return time.Time{}, ErrInvalidCredentials
	}
	return s.schedule(ctx, user)
}

func (s *AccountDeletionService) schedule(ctx context.Context, user *model.User) (time.Time, error) {
	at := s.now().Add(DeletionGracePeriod)
	if err := s.users.SetDeletionScheduled(ctx, user.ID, &at); err != nil {
		return time.Time{}, err
	}
	// Signed out everywhere: whoever asked for this should not keep a session
	// open on another device without noticing.
	if s.sessions != nil {
		if err := s.sessions.DeleteByUser(ctx, user.ID); err != nil {
			slog.Warn("revoke sessions for deletion", "user_id", user.ID, "error", err)
		}
	}
	s.hub.DisconnectUser(user.ID)

	raw, hash, err := newActionToken()
	if err != nil {
		return at, err
	}
	if err := s.cancels.Create(ctx, user.ID, hash, at); err != nil {
		return at, err
	}
	link := fmt.Sprintf("%s/cancel-deletion?token=%s", s.baseURL, raw)
	body := fmt.Sprintf("Your NexusNotes account and everything in it (notes, vaults, attachments, keys) will be permanently deleted on %s.\n\n"+
		"Changed your mind? Keep your account by opening:\n%s\n\n"+
		"You can also sign in before then and choose \"Keep my account\".", at.Format("2 January 2006, 15:04 MST"), link)
	if err := s.mailer.Send(user.Email, "Your NexusNotes account will be deleted", body); err != nil {
		slog.Error("send deletion email", "error", err)
	}
	return at, nil
}

// Cancel keeps the signed-in user's account.
func (s *AccountDeletionService) Cancel(ctx context.Context, userID string) error {
	return s.users.SetDeletionScheduled(ctx, userID, nil)
}

// CancelWithToken keeps the account the emailed link belongs to.
func (s *AccountDeletionService) CancelWithToken(ctx context.Context, token string) error {
	userID, err := s.cancels.Consume(ctx, hashActionToken(token))
	if err != nil {
		return ErrDeletionTokenInvalid
	}
	return s.users.SetDeletionScheduled(ctx, userID, nil)
}

// Request emails a confirm link when the address has an account. Like the
// password reset it never reveals whether it does.
func (s *AccountDeletionService) Request(ctx context.Context, email string) {
	user, err := s.users.GetByEmail(ctx, email)
	if err != nil || user == nil || user.DeletionScheduledAt != nil {
		return
	}
	raw, hash, err := newActionToken()
	if err != nil {
		slog.Error("deletion request token", "error", err)
		return
	}
	if err := s.requests.Create(ctx, user.ID, hash, s.now().Add(deletionRequestTTL)); err != nil {
		slog.Error("store deletion request token", "error", err)
		return
	}
	link := fmt.Sprintf("%s/confirm-deletion?token=%s", s.baseURL, raw)
	body := fmt.Sprintf("Someone asked to delete the NexusNotes account for this address.\n\n"+
		"If that was you, confirm here:\n%s\n\nThe account is then deleted after %d days unless you cancel. "+
		"The link expires in 24 hours. If you didn't ask for this, ignore this email.", link, int(DeletionGracePeriod.Hours()/24))
	if err := s.mailer.Send(user.Email, "Confirm deleting your NexusNotes account", body); err != nil {
		slog.Error("send deletion request email", "error", err)
	}
}

// ConfirmRequest starts the grace period for the account the link belongs to.
func (s *AccountDeletionService) ConfirmRequest(ctx context.Context, token string) (time.Time, error) {
	userID, err := s.requests.Consume(ctx, hashActionToken(token))
	if err != nil {
		return time.Time{}, ErrDeletionTokenInvalid
	}
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return time.Time{}, err
	}
	return s.schedule(ctx, user)
}

// PurgeDue erases every account whose grace period is over and reports how
// many. One failure does not stop the rest; it is retried on the next run.
func (s *AccountDeletionService) PurgeDue(ctx context.Context) (int, error) {
	ids, err := s.users.DeletionDue(ctx, s.now())
	if err != nil {
		return 0, err
	}
	erased := 0
	for _, id := range ids {
		if err := s.eraser.EraseUser(ctx, id); err != nil {
			slog.Error("erase account after grace period", "user_id", id, "error", err)
			continue
		}
		erased++
	}
	return erased, nil
}
