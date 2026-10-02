package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

func callMe(h *AuthHandler, userID string) int {
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	h.Me(rec, req)
	return rec.Code
}

// GET /api/auth/me answers 404 only when the account is gone (the client then
// signs out) and 500 when the database fails (the client keeps the session)
// (#374, see restoreFailureAction in the desktop app).
func TestMe_DistinguishesMissingAccountFromDatabaseFailure(t *testing.T) {
	pool := newIsolatedDB(t)
	users := repository.NewUserRepo(pool, fieldcrypttest.Cipher(t))
	h := NewAuthHandler(nil, nil, nil, users)

	now := time.Now().UTC()
	u := &model.User{ID: uuid.NewString(), Email: uuid.NewString() + "@test", PasswordHash: "x", CreatedAt: now, UpdatedAt: now}
	if err := users.Create(context.Background(), u); err != nil {
		t.Fatal(err)
	}
	if code := callMe(h, u.ID); code != http.StatusOK {
		t.Fatalf("existing account: status %d, want 200", code)
	}
	if code := callMe(h, uuid.NewString()); code != http.StatusNotFound {
		t.Fatalf("deleted account: status %d, want 404", code)
	}

	pool.Close() // the database is now unreachable for this handler
	if code := callMe(h, u.ID); code != http.StatusInternalServerError {
		t.Fatalf("database failure: status %d, want 500 (a 404 would sign the user out)", code)
	}
}
