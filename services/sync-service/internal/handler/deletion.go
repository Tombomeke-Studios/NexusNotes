package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
)

// DeletionHandler serves account deletion with a grace period (#289).
type DeletionHandler struct {
	svc *service.AccountDeletionService
}

func NewDeletionHandler(svc *service.AccountDeletionService) *DeletionHandler {
	return &DeletionHandler{svc: svc}
}

type scheduledResponse struct {
	DeletionScheduledAt time.Time `json:"deletion_scheduled_at"`
}

// Schedule (DELETE /api/auth/account) starts the grace period for the
// signed-in user after re-checking their password; 202 with the date.
func (h *DeletionHandler) Schedule(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := decodeSmallJSON(w, r, &req); err != nil {
		writeBodyError(w, err, "invalid request body")
		return
	}
	if req.Password == "" {
		writeError(w, http.StatusBadRequest, "password is required to delete the account")
		return
	}
	at, err := h.svc.Schedule(r.Context(), middleware.GetUserID(r.Context()), req.Password)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCredentials) {
			writeError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to schedule the deletion")
		return
	}
	writeJSON(w, http.StatusAccepted, scheduledResponse{at})
}

// Cancel (POST /api/auth/account/keep) keeps the signed-in user's account.
func (h *DeletionHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Cancel(r.Context(), middleware.GetUserID(r.Context())); err != nil {
		writeLookupError(w, err, "user not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// CancelWithToken (POST /api/auth/cancel-deletion) keeps the account an
// emailed link belongs to.
func (h *DeletionHandler) CancelWithToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := decodeSmallJSON(w, r, &req); err != nil || req.Token == "" {
		writeBodyError(w, err, "token is required")
		return
	}
	if err := h.svc.CancelWithToken(r.Context(), req.Token); err != nil {
		writeError(w, http.StatusBadRequest, "this link is invalid, expired or already used")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Request (POST /api/auth/request-deletion) emails a confirm link to an
// address that has an account; always 204, so it reveals nothing.
func (h *DeletionHandler) Request(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := decodeSmallJSON(w, r, &req); err != nil || req.Email == "" {
		writeBodyError(w, err, "email is required")
		return
	}
	h.svc.Request(r.Context(), req.Email)
	w.WriteHeader(http.StatusNoContent)
}

// Confirm (POST /api/auth/confirm-deletion) starts the grace period from a
// confirm link.
func (h *DeletionHandler) Confirm(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := decodeSmallJSON(w, r, &req); err != nil || req.Token == "" {
		writeBodyError(w, err, "token is required")
		return
	}
	at, err := h.svc.ConfirmRequest(r.Context(), req.Token)
	if err != nil {
		writeError(w, http.StatusBadRequest, "this link is invalid, expired or already used")
		return
	}
	writeJSON(w, http.StatusAccepted, scheduledResponse{at})
}
