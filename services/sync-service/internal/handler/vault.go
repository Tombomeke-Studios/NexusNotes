package handler

import (
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

type VaultHandler struct {
	vaultRepo *repository.VaultRepo
}

func NewVaultHandler(vaultRepo *repository.VaultRepo) *VaultHandler {
	return &VaultHandler{vaultRepo: vaultRepo}
}

func (h *VaultHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	now := time.Now().UTC()
	vault := &model.Vault{
		ID:        uuid.New().String(),
		UserID:    userID,
		Name:      req.Name,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := h.vaultRepo.Create(r.Context(), vault); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create vault")
		return
	}

	writeJSON(w, http.StatusCreated, vault)
}

func (h *VaultHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	vaults, err := h.vaultRepo.ListByUser(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list vaults")
		return
	}

	if vaults == nil {
		vaults = []model.Vault{}
	}

	writeJSON(w, http.StatusOK, vaults)
}

func (h *VaultHandler) Get(w http.ResponseWriter, r *http.Request) {
	vaultID := r.PathValue("id")
	userID := middleware.GetUserID(r.Context())

	vault, err := h.vaultRepo.GetByID(r.Context(), vaultID)
	if err != nil {
		writeError(w, http.StatusNotFound, "vault not found")
		return
	}

	if vault.UserID != userID {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	writeJSON(w, http.StatusOK, vault)
}

func (h *VaultHandler) Update(w http.ResponseWriter, r *http.Request) {
	vaultID := r.PathValue("id")
	userID := middleware.GetUserID(r.Context())

	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	vault := &model.Vault{
		ID:        vaultID,
		UserID:    userID,
		Name:      req.Name,
		UpdatedAt: time.Now().UTC(),
	}

	if err := h.vaultRepo.Update(r.Context(), vault); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update vault")
		return
	}

	writeJSON(w, http.StatusOK, vault)
}

func (h *VaultHandler) Delete(w http.ResponseWriter, r *http.Request) {
	vaultID := r.PathValue("id")
	userID := middleware.GetUserID(r.Context())

	if err := h.vaultRepo.Delete(r.Context(), vaultID, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete vault")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
