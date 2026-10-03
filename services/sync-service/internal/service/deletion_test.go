package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

type fakeDeletionUsers struct {
	users     map[string]*model.User
	scheduled map[string]*time.Time
}

func (f *fakeDeletionUsers) GetByID(_ context.Context, id string) (*model.User, error) {
	if u, ok := f.users[id]; ok {
		return u, nil
	}
	return nil, repository.ErrUserNotFound
}
func (f *fakeDeletionUsers) GetByEmail(_ context.Context, email string) (*model.User, error) {
	for _, u := range f.users {
		if u.Email == email {
			return u, nil
		}
	}
	return nil, repository.ErrUserNotFound
}
func (f *fakeDeletionUsers) SetDeletionScheduled(_ context.Context, id string, at *time.Time) error {
	f.scheduled[id] = at
	f.users[id].DeletionScheduledAt = at
	return nil
}
func (f *fakeDeletionUsers) DeletionDue(_ context.Context, now time.Time) ([]string, error) {
	var ids []string
	for id, at := range f.scheduled {
		if at != nil && !at.After(now) {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

type fakeTokens struct{ byHash map[string]string }

func (f *fakeTokens) Create(_ context.Context, userID, hash string, _ time.Time) error {
	f.byHash[hash] = userID
	return nil
}
func (f *fakeTokens) Consume(_ context.Context, hash string) (string, error) {
	id, ok := f.byHash[hash]
	if !ok {
		return "", repository.ErrAuthTokenInvalid
	}
	delete(f.byHash, hash)
	return id, nil
}

type fakeEraser struct{ erased []string }

func (f *fakeEraser) EraseUser(_ context.Context, id string) error {
	f.erased = append(f.erased, id)
	return nil
}

type sentMail struct{ to, subject, body string }
type fakeMailer struct{ sent []sentMail }

func (f *fakeMailer) Enabled() bool { return true }
func (f *fakeMailer) Send(to, subject, body string) error {
	f.sent = append(f.sent, sentMail{to, subject, body})
	return nil
}

type fakeDeletionRevoker struct{ revoked []string }

func (f *fakeDeletionRevoker) DeleteByUser(_ context.Context, id string) error {
	f.revoked = append(f.revoked, id)
	return nil
}

func linkToken(t *testing.T, body, path string) string {
	t.Helper()
	i := strings.Index(body, path+"?token=")
	if i < 0 {
		t.Fatalf("no %s link in %q", path, body)
	}
	rest := body[i+len(path+"?token="):]
	if j := strings.IndexAny(rest, " \n"); j >= 0 {
		rest = rest[:j]
	}
	return rest
}

func deletionFixture(t *testing.T) (*AccountDeletionService, *fakeDeletionUsers, *fakeEraser, *fakeMailer, *fakeDeletionRevoker, *fakeSessionCloser, *time.Time) {
	t.Helper()
	hash, err := hashPassword("correct-password")
	if err != nil {
		t.Fatal(err)
	}
	users := &fakeDeletionUsers{
		users:     map[string]*model.User{"u1": {ID: "u1", Email: "a@example.com", PasswordHash: hash}},
		scheduled: map[string]*time.Time{},
	}
	eraser, mailer, revoker, hub := &fakeEraser{}, &fakeMailer{}, &fakeDeletionRevoker{}, &fakeSessionCloser{}
	now := time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)
	svc := NewAccountDeletionService(users, eraser, &fakeTokens{map[string]string{}}, &fakeTokens{map[string]string{}}, revoker, hub, mailer, "https://notes.example")
	svc.now = func() time.Time { return now }
	return svc, users, eraser, mailer, revoker, hub, &now
}

// Deleting an account waits 7 days, can be cancelled by email or in-app, and
// is then carried out by the purge (#289).
func TestAccountDeletion_GracePeriod(t *testing.T) {
	ctx := context.Background()
	svc, users, eraser, mailer, revoker, hub, now := deletionFixture(t)

	if _, err := svc.Schedule(ctx, "u1", "wrong"); err != ErrInvalidCredentials {
		t.Fatalf("wrong password: %v", err)
	}
	at, err := svc.Schedule(ctx, "u1", "correct-password")
	if err != nil {
		t.Fatal(err)
	}
	if !at.Equal(now.Add(DeletionGracePeriod)) || users.scheduled["u1"] == nil {
		t.Fatalf("scheduled at %v (%v)", at, users.scheduled["u1"])
	}
	if len(revoker.revoked) != 1 || len(hub.disconnected) != 1 {
		t.Fatal("sessions were not ended")
	}
	if len(mailer.sent) != 1 || !strings.Contains(mailer.sent[0].body, "/cancel-deletion?token=") {
		t.Fatalf("mail = %+v", mailer.sent)
	}

	// Not due yet: nothing is erased.
	if n, _ := svc.PurgeDue(ctx); n != 0 || len(eraser.erased) != 0 {
		t.Fatal("erased before the grace period ended")
	}

	// The emailed link cancels it, once.
	token := linkToken(t, mailer.sent[0].body, "/cancel-deletion")
	if err := svc.CancelWithToken(ctx, token); err != nil {
		t.Fatal(err)
	}
	if users.scheduled["u1"] != nil {
		t.Fatal("still scheduled after cancel")
	}
	if err := svc.CancelWithToken(ctx, token); err == nil {
		t.Fatal("a cancel link worked twice")
	}

	// Scheduled again and left alone: the purge erases it once due.
	if _, err := svc.Schedule(ctx, "u1", "correct-password"); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(DeletionGracePeriod + time.Minute)
	if n, err := svc.PurgeDue(ctx); err != nil || n != 1 || len(eraser.erased) != 1 {
		t.Fatalf("purge: n=%d err=%v erased=%v", n, err, eraser.erased)
	}
}

func TestAccountDeletion_CancelSignedIn(t *testing.T) {
	ctx := context.Background()
	svc, users, _, _, _, _, _ := deletionFixture(t)
	if _, err := svc.Schedule(ctx, "u1", "correct-password"); err != nil {
		t.Fatal(err)
	}
	if err := svc.Cancel(ctx, "u1"); err != nil || users.scheduled["u1"] != nil {
		t.Fatalf("cancel: %v %v", err, users.scheduled["u1"])
	}
}

// Someone who can't sign in asks by email; only the mailbox owner can confirm.
func TestAccountDeletion_PublicRequest(t *testing.T) {
	ctx := context.Background()
	svc, users, _, mailer, _, _, _ := deletionFixture(t)

	svc.Request(ctx, "nobody@example.com")
	if len(mailer.sent) != 0 {
		t.Fatal("mailed an unknown address")
	}
	svc.Request(ctx, "a@example.com")
	if len(mailer.sent) != 1 || users.scheduled["u1"] != nil {
		t.Fatalf("request should only mail a confirm link: %+v", mailer.sent)
	}
	token := linkToken(t, mailer.sent[0].body, "/confirm-deletion")
	at, err := svc.ConfirmRequest(ctx, token)
	if err != nil || users.scheduled["u1"] == nil || at.IsZero() {
		t.Fatalf("confirm: %v %v", err, at)
	}
	if len(mailer.sent) != 2 || !strings.Contains(mailer.sent[1].body, "/cancel-deletion?token=") {
		t.Fatal("no cancel link after confirming")
	}
	if _, err := svc.ConfirmRequest(ctx, "bogus"); err == nil {
		t.Fatal("a bogus token was accepted")
	}
}
