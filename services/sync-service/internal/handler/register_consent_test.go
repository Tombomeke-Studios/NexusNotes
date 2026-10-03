package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
)

// Signing up needs the consent box; when and which policy version is kept
// with the user (#289).
func TestRegister_RecordsConsent(t *testing.T) {
	pool := newIsolatedDB(t)
	users := repository.NewUserRepo(pool, fieldcrypttest.Cipher(t))
	auth := service.NewAuthService(users, "test-secret-test-secret-test-secret")
	auth.SetRefreshStore(repository.NewRefreshRepo(pool))
	h := NewAuthHandler(auth, nil, nil, users)

	register := func(body map[string]any) *httptest.ResponseRecorder {
		b, _ := json.Marshal(body)
		rec := httptest.NewRecorder()
		h.Register(rec, httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b)))
		return rec
	}
	email := uuid.NewString() + "@nexus.test"
	if rec := register(map[string]any{"email": email, "password": "password123"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("without consent: status %d, want 400", rec.Code)
	}
	if _, err := users.GetByEmail(context.Background(), email); err == nil {
		t.Fatal("an account was created without consent")
	}
	before := time.Now().UTC().Add(-time.Second)
	if rec := register(map[string]any{"email": email, "password": "password123", "accepted_terms": true}); rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("with consent: status %d %s", rec.Code, rec.Body.String())
	}
	var at time.Time
	var version string
	if err := pool.QueryRow(context.Background(), `SELECT terms_accepted_at, terms_version FROM users`).Scan(&at, &version); err != nil {
		t.Fatal(err)
	}
	if version != model.CurrentTermsVersion || at.Before(before) {
		t.Fatalf("consent recorded as %v / %q", at, version)
	}
}
