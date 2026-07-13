package handler

import (
	"crypto/subtle"
	"net/http"
	"strings"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// AdminHandler serves operator-only endpoints guarded by a static bearer
// token from the environment (#59) — deliberately separate from user JWTs.
type AdminHandler struct {
	statsRepo  *repository.StatsRepo
	adminToken string
	startedAt  time.Time
}

func NewAdminHandler(statsRepo *repository.StatsRepo, adminToken string, startedAt time.Time) *AdminHandler {
	return &AdminHandler{statsRepo: statsRepo, adminToken: adminToken, startedAt: startedAt}
}

// authorized checks the bearer token in constant time. With no token
// configured the endpoints act as if they don't exist.
func (h *AdminHandler) authorized(r *http.Request) bool {
	if h.adminToken == "" {
		return false
	}
	got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	return subtle.ConstantTimeCompare([]byte(got), []byte(h.adminToken)) == 1
}

// Stats returns instance-wide counts and uptime.
func (h *AdminHandler) Stats(w http.ResponseWriter, r *http.Request) {
	if !h.authorized(r) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	users, vaults, notes, err := h.statsRepo.Counts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to gather stats")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"users":          users,
		"vaults":         vaults,
		"notes":          notes,
		"uptime_seconds": int64(time.Since(h.startedAt).Seconds()),
		"started_at":     h.startedAt.UTC().Format(time.RFC3339),
	})
}
