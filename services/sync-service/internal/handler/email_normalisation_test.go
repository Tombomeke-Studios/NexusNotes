package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
)

// #342: an email address is one account whatever its case or surrounding
// spaces, from signup through login.
func TestAuth_EmailNormalisation(t *testing.T) {
	pool := newIsolatedDB(t)
	users := repository.NewUserRepo(pool, fieldcrypttest.Cipher(t))
	auth := service.NewAuthService(users, "test-secret-test-secret-test-secret")
	auth.SetRefreshStore(repository.NewRefreshRepo(pool))
	h := NewAuthHandler(auth, nil, nil, users)

	call := func(fn http.HandlerFunc, body map[string]any) *httptest.ResponseRecorder {
		t.Helper()
		b, _ := json.Marshal(body)
		rec := httptest.NewRecorder()
		fn(rec, httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b)))
		return rec
	}
	register := func(email string) *httptest.ResponseRecorder {
		return call(h.Register, map[string]any{"email": email, "password": "password123", "accepted_terms": true})
	}
	login := func(email string) *httptest.ResponseRecorder {
		return call(h.Login, map[string]any{"email": email, "password": "password123"})
	}

	rec := register("  Mixed.Case@Nexus.Test  ")
	if rec.Code != http.StatusCreated {
		t.Fatalf("signup: status %d %s", rec.Code, rec.Body.String())
	}
	var signup struct {
		User struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &signup); err != nil {
		t.Fatal(err)
	}
	if signup.User.Email != "Mixed.Case@Nexus.Test" {
		t.Fatalf("signup returned email %q, want it without the spaces", signup.User.Email)
	}

	for _, email := range []string{"mixed.case@nexus.test", "MIXED.CASE@NEXUS.TEST", "  Mixed.Case@Nexus.Test  ", "\tmixed.CASE@nexus.test\n"} {
		rec := login(email)
		if rec.Code != http.StatusOK {
			t.Fatalf("login as %q: status %d %s", email, rec.Code, rec.Body.String())
		}
		var got struct {
			User struct {
				ID string `json:"id"`
			} `json:"user"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.User.ID != signup.User.ID {
			t.Fatalf("login as %q reached user %q, want %q", email, got.User.ID, signup.User.ID)
		}
	}

	for _, email := range []string{"mixed.case@nexus.test", " MIXED.case@nexus.TEST "} {
		if rec := register(email); rec.Code != http.StatusConflict {
			t.Fatalf("duplicate signup as %q: status %d, want 409", email, rec.Code)
		}
	}
	var count int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM users`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("%d accounts, want 1", count)
	}
}

// #342: an address of only spaces is no address.
func TestAuth_BlankEmailRejected(t *testing.T) {
	h := NewAuthHandler(nil, nil, nil, nil)
	for name, fn := range map[string]http.HandlerFunc{"register": h.Register, "login": h.Login} {
		b, _ := json.Marshal(map[string]any{"email": "   ", "password": "password123", "accepted_terms": true})
		rec := httptest.NewRecorder()
		fn(rec, httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b)))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s with a blank email: status %d, want 400", name, rec.Code)
		}
	}
}

// #342: so do the public forms that take only an email.
func TestEmailOnlyForms_BlankEmailRejected(t *testing.T) {
	auth := NewAuthHandler(nil, nil, nil, nil)
	deletion := NewDeletionHandler(nil)
	for name, fn := range map[string]http.HandlerFunc{"forgot-password": auth.ForgotPassword, "request-deletion": deletion.Request} {
		b, _ := json.Marshal(map[string]any{"email": " \t "})
		rec := httptest.NewRecorder()
		fn(rec, httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b)))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s with a blank email: status %d, want 400", name, rec.Code)
		}
	}
}
