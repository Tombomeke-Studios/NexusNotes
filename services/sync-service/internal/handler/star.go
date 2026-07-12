package handler

import (
	"net/http"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
)

// StarHandler exposes per-user starred (favourite) notes.
type StarHandler struct {
	starRepo    *repository.StarRepo
	vaultRepo   *repository.VaultRepo
	syncService *service.SyncService
}

func NewStarHandler(starRepo *repository.StarRepo, vaultRepo *repository.VaultRepo, syncService *service.SyncService) *StarHandler {
	return &StarHandler{starRepo: starRepo, vaultRepo: vaultRepo, syncService: syncService}
}

// List returns the ids of every note the user has starred (across vaults).
func (h *StarHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	ids, err := h.starRepo.List(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list starred notes")
		return
	}
	if ids == nil {
		ids = []string{}
	}
	writeJSON(w, http.StatusOK, ids)
}

// requireOwnedNote resolves the note and verifies the caller owns its vault.
func (h *StarHandler) requireOwnedNote(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID := middleware.GetUserID(r.Context())
	noteID := r.PathValue("noteId")

	note, err := h.syncService.GetNote(r.Context(), noteID)
	if err != nil {
		writeError(w, http.StatusNotFound, "note not found")
		return "", false
	}
	vault, err := h.vaultRepo.GetByID(r.Context(), note.VaultID)
	if err != nil || vault.UserID != userID {
		writeError(w, http.StatusForbidden, "access denied")
		return "", false
	}
	return noteID, true
}

// Star marks a note as a favourite; idempotent.
func (h *StarHandler) Star(w http.ResponseWriter, r *http.Request) {
	noteID, ok := h.requireOwnedNote(w, r)
	if !ok {
		return
	}
	if err := h.starRepo.Star(r.Context(), middleware.GetUserID(r.Context()), noteID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to star note")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Unstar removes the favourite mark; idempotent.
func (h *StarHandler) Unstar(w http.ResponseWriter, r *http.Request) {
	noteID, ok := h.requireOwnedNote(w, r)
	if !ok {
		return
	}
	if err := h.starRepo.Unstar(r.Context(), middleware.GetUserID(r.Context()), noteID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to unstar note")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
