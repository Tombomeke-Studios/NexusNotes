package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// --- in-memory fakes ---

type fakeEmailUsers struct {
	byEmail  map[string]*model.User
	verified map[string]bool
	hashes   map[string]string
}

func newFakeEmailUsers() *fakeEmailUsers {
	return &fakeEmailUsers{byEmail: map[string]*model.User{}, verified: map[string]bool{}, hashes: map[string]string{}}
}
func (f *fakeEmailUsers) GetByEmail(_ context.Context, email string) (*model.User, error) {
	return f.byEmail[email], nil
}
func (f *fakeEmailUsers) SetEmailVerified(_ context.Context, id string) error {
	f.verified[id] = true
	return nil
}
func (f *fakeEmailUsers) UpdatePasswordHash(_ context.Context, id, hash string) error {
	f.hashes[id] = hash
	return nil
}

type fakeTokenStore struct {
	rows map[string]tokenRow // hash -> row
}
type tokenRow struct {
	userID    string
	expiresAt time.Time
	used      bool
}

func newFakeTokenStore() *fakeTokenStore { return &fakeTokenStore{rows: map[string]tokenRow{}} }
func (f *fakeTokenStore) Create(_ context.Context, userID, hash string, exp time.Time) error {
	f.rows[hash] = tokenRow{userID: userID, expiresAt: exp}
	return nil
}
func (f *fakeTokenStore) Consume(_ context.Context, hash string) (string, error) {
	row, ok := f.rows[hash]
	if !ok || row.used || time.Now().After(row.expiresAt) {
		return "", repository.ErrAuthTokenInvalid
	}
	row.used = true
	f.rows[hash] = row
	return row.userID, nil
}

type fakeRevoker struct{ revoked []string }

func (f *fakeRevoker) DeleteByUser(_ context.Context, userID string) error {
	f.revoked = append(f.revoked, userID)
	return nil
}

// captureMailer records the last message so tests can pull the token out.
type captureMailer struct {
	enabled bool
	to      string
	body    string
}

func (m *captureMailer) Enabled() bool { return m.enabled }
func (m *captureMailer) Send(to, _ /*subject*/, body string) error {
	m.to, m.body = to, body
	return nil
}

// tokenFromLink extracts the ?token= value from the last mail body.
func tokenFromLink(body string) string {
	i := strings.Index(body, "token=")
	if i < 0 {
		return ""
	}
	rest := body[i+len("token="):]
	return strings.TrimSpace(strings.SplitN(rest, "\n", 2)[0])
}

func newEmailAuth(users *fakeEmailUsers, verify, reset *fakeTokenStore, rev *fakeRevoker, m *captureMailer) *EmailAuthService {
	return NewEmailAuthService(users, verify, reset, rev, m, "http://app.test")
}

// --- verification ---

func TestVerification_RoundTrip(t *testing.T) {
	ctx := context.Background()
	users := newFakeEmailUsers()
	users.byEmail["a@x.io"] = &model.User{ID: "u1", Email: "a@x.io"}
	verify := newFakeTokenStore()
	mailer := &captureMailer{enabled: true}
	svc := newEmailAuth(users, verify, newFakeTokenStore(), &fakeRevoker{}, mailer)

	if err := svc.SendVerification(ctx, "u1", "a@x.io"); err != nil {
		t.Fatalf("send: %v", err)
	}
	token := tokenFromLink(mailer.body)
	if token == "" {
		t.Fatal("no token in verification email")
	}
	if err := svc.VerifyEmail(ctx, token); err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !users.verified["u1"] {
		t.Fatal("user should be verified")
	}
	// Single use: a replay fails.
	if err := svc.VerifyEmail(ctx, token); err == nil {
		t.Fatal("verification token should be single-use")
	}
}

func TestVerifyEmail_RejectsUnknownToken(t *testing.T) {
	svc := newEmailAuth(newFakeEmailUsers(), newFakeTokenStore(), newFakeTokenStore(), &fakeRevoker{}, &captureMailer{enabled: true})
	if err := svc.VerifyEmail(context.Background(), "bogus"); err == nil {
		t.Fatal("expected an unknown token to be rejected")
	}
}

// --- password reset ---

func TestPasswordReset_RoundTripRevokesSessions(t *testing.T) {
	ctx := context.Background()
	users := newFakeEmailUsers()
	users.byEmail["a@x.io"] = &model.User{ID: "u1", Email: "a@x.io"}
	reset := newFakeTokenStore()
	rev := &fakeRevoker{}
	mailer := &captureMailer{enabled: true}
	svc := newEmailAuth(users, newFakeTokenStore(), reset, rev, mailer)

	svc.RequestPasswordReset(ctx, "a@x.io")
	token := tokenFromLink(mailer.body)
	if token == "" {
		t.Fatal("no token in reset email")
	}

	if err := svc.ResetPassword(ctx, token, "brand-new-password"); err != nil {
		t.Fatalf("reset: %v", err)
	}
	if users.hashes["u1"] == "" {
		t.Fatal("password hash should be updated")
	}
	if len(rev.revoked) != 1 || rev.revoked[0] != "u1" {
		t.Fatalf("reset must revoke sessions, got %v", rev.revoked)
	}
	// Token cannot be reused.
	if err := svc.ResetPassword(ctx, token, "another-password"); err == nil {
		t.Fatal("reset token should be single-use")
	}
}

func TestRequestPasswordReset_UnknownEmailIsSilentNoop(t *testing.T) {
	ctx := context.Background()
	reset := newFakeTokenStore()
	mailer := &captureMailer{enabled: true}
	svc := newEmailAuth(newFakeEmailUsers(), newFakeTokenStore(), reset, &fakeRevoker{}, mailer)

	svc.RequestPasswordReset(ctx, "ghost@x.io")

	if len(reset.rows) != 0 {
		t.Fatal("no token should be created for an unknown address")
	}
	if mailer.body != "" {
		t.Fatal("no email should be sent for an unknown address")
	}
}

func TestMailEnabled_ReflectsMailer(t *testing.T) {
	on := newEmailAuth(newFakeEmailUsers(), newFakeTokenStore(), newFakeTokenStore(), &fakeRevoker{}, &captureMailer{enabled: true})
	off := newEmailAuth(newFakeEmailUsers(), newFakeTokenStore(), newFakeTokenStore(), &fakeRevoker{}, &captureMailer{enabled: false})
	if !on.MailEnabled() || off.MailEnabled() {
		t.Fatal("MailEnabled should mirror the mailer")
	}
}
