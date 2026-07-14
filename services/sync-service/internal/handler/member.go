package handler

import (
	"net/http"
	"strings"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// MemberHandler manages vault sharing membership (#51, #52, #55).
type MemberHandler struct {
	vaultRepo  *repository.VaultRepo
	memberRepo *repository.VaultMemberRepo
	userRepo   *repository.UserRepo
}

func NewMemberHandler(vaultRepo *repository.VaultRepo, memberRepo *repository.VaultMemberRepo, userRepo *repository.UserRepo) *MemberHandler {
	return &MemberHandler{vaultRepo: vaultRepo, memberRepo: memberRepo, userRepo: userRepo}
}

// isOwner reports whether userID owns the vault. Returns false (not 500) on a
// lookup miss so callers uniformly answer 403/404.
func (h *MemberHandler) isOwner(r *http.Request, vaultID, userID string) bool {
	vault, err := h.vaultRepo.GetByID(r.Context(), vaultID)
	return err == nil && vault.UserID == userID
}

func validRole(role string) bool {
	return role == model.VaultRoleViewer || role == model.VaultRoleEditor
}

// List returns the vault's members (any member or the owner may view).
func (h *MemberHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("id")

	if !canRead(r.Context(), h.vaultRepo, vaultID, userID) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}
	members, err := h.memberRepo.List(r.Context(), vaultID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list members")
		return
	}
	if members == nil {
		members = []model.VaultMember{}
	}
	writeJSON(w, http.StatusOK, members)
}

// Invite adds a user (by email) to the vault as viewer/editor. Owner only.
func (h *MemberHandler) Invite(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("id")

	if !h.isOwner(r, vaultID, userID) {
		writeError(w, http.StatusForbidden, "only the owner can invite members")
		return
	}

	var req struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Role == "" {
		req.Role = model.VaultRoleViewer
	}
	if !validRole(req.Role) {
		writeError(w, http.StatusBadRequest, "role must be 'viewer' or 'editor'")
		return
	}

	invitee, err := h.userRepo.GetByEmail(r.Context(), strings.ToLower(strings.TrimSpace(req.Email)))
	if err != nil {
		// Don't reveal whether the address is registered.
		writeError(w, http.StatusNotFound, "no user with that email")
		return
	}
	if invitee.ID == userID {
		writeError(w, http.StatusBadRequest, "you already own this vault")
		return
	}

	if err := h.memberRepo.Add(r.Context(), vaultID, invitee.ID, req.Role, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add member")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// UpdateRole changes a member's role. Owner only.
func (h *MemberHandler) UpdateRole(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("id")
	memberID := r.PathValue("userId")

	if !h.isOwner(r, vaultID, userID) {
		writeError(w, http.StatusForbidden, "only the owner can change roles")
		return
	}
	var req struct {
		Role string `json:"role"`
	}
	if err := decodeJSON(r, &req); err != nil || !validRole(req.Role) {
		writeError(w, http.StatusBadRequest, "role must be 'viewer' or 'editor'")
		return
	}
	ok, err := h.memberRepo.UpdateRole(r.Context(), vaultID, memberID, req.Role)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update role")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "member not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Remove kicks a member (owner) or lets a member leave (self). Anyone else 403s.
func (h *MemberHandler) Remove(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("id")
	memberID := r.PathValue("userId")

	if memberID != userID && !h.isOwner(r, vaultID, userID) {
		writeError(w, http.StatusForbidden, "only the owner can remove other members")
		return
	}
	ok, err := h.memberRepo.Remove(r.Context(), vaultID, memberID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove member")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "member not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
