package service

import (
	"context"
	"errors"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// capturingUserStore records the user handed to Create and serves it back on
// lookup, so the tests see exactly what the service stores.
type capturingUserStore struct {
	fakeUserStore
	created *model.User
}

func (c *capturingUserStore) Create(_ context.Context, u *model.User) error {
	c.created = u
	return nil
}

// #342: an address typed with surrounding spaces is stored, and returned,
// without them; its case is kept for display (lookups ignore case).
func TestRegister_TrimsEmail(t *testing.T) {
	store := &capturingUserStore{}
	s := newAuthService(store)
	user, _, err := s.Register(context.Background(), "  Alice@Example.COM \t", "password123", "Alice")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if store.created == nil || store.created.Email != "Alice@Example.COM" {
		t.Fatalf("stored email = %+v, want trimmed", store.created)
	}
	if user.Email != "Alice@Example.COM" {
		t.Fatalf("returned email = %q, want trimmed", user.Email)
	}
}

// #342: spelling the same address with other case or spaces must not get an
// attacker a fresh set of login attempts.
func TestLogin_ThrottleIgnoresEmailCaseAndSpaces(t *testing.T) {
	hash, _ := hashPassword("correct-password")
	s := newAuthService(&fakeUserStore{byEmail: &model.User{ID: "u1", Email: "a@example.com", PasswordHash: hash}})

	spellings := []string{"a@example.com", " A@example.com", "a@EXAMPLE.com ", "\tA@Example.Com"}
	for i := 0; i < lockThreshold; i++ {
		email := spellings[i%len(spellings)]
		if _, _, err := s.Login(context.Background(), email, "wrong", "10.0.0.1"); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("attempt %d (%q): err = %v, want ErrInvalidCredentials", i+1, email, err)
		}
	}
	for _, email := range spellings {
		if _, _, err := s.Login(context.Background(), email, "correct-password", "10.0.0.1"); !errors.Is(err, ErrTooManyAttempts) {
			t.Fatalf("%q: err = %v, want ErrTooManyAttempts", email, err)
		}
	}
}
