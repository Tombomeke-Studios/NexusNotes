package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

type VaultHandler struct {
	vaultRepo  *repository.VaultRepo
	userRepo   *repository.UserRepo
	memberRepo *repository.VaultMemberRepo
	// requireVerified gates vault creation on a confirmed email (#47); only
	// active when SMTP is configured, so mail-less self-hosts are unaffected.
	requireVerified bool
}

func NewVaultHandler(vaultRepo *repository.VaultRepo, userRepo *repository.UserRepo, memberRepo *repository.VaultMemberRepo, requireVerified bool) *VaultHandler {
	return &VaultHandler{vaultRepo: vaultRepo, userRepo: userRepo, memberRepo: memberRepo, requireVerified: requireVerified}
}

func (h *VaultHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	// Require a verified email before the account can hold data (#47).
	if h.requireVerified {
		user, err := h.userRepo.GetByID(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create vault")
			return
		}
		if !user.EmailVerified {
			writeError(w, http.StatusForbidden, "please verify your email address before creating a vault")
			return
		}
	}

	var req struct {
		Name string `json:"name"`
		// E2EE fields, both client-produced; encryption_meta stays opaque.
		Encryption     string          `json:"encryption"`
		EncryptionMeta json.RawMessage `json:"encryption_meta"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Encryption == "" {
		req.Encryption = model.VaultEncryptionNone
	}
	if req.Encryption != model.VaultEncryptionNone && req.Encryption != model.VaultEncryptionE2EE {
		writeError(w, http.StatusBadRequest, "encryption must be 'none' or 'e2ee'")
		return
	}
	if req.Encryption == model.VaultEncryptionE2EE && len(req.EncryptionMeta) == 0 {
		writeError(w, http.StatusBadRequest, "encryption_meta is required for an e2ee vault")
		return
	}

	now := time.Now().UTC()
	vault := &model.Vault{
		ID:             uuid.New().String(),
		UserID:         userID,
		Name:           req.Name,
		Encryption:     req.Encryption,
		EncryptionMeta: req.EncryptionMeta,
		CreatedAt:      now,
		UpdatedAt:      now,
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
	for i := range vaults {
		vaults[i].Role = model.VaultRoleOwner
	}

	// Include vaults shared with this user, each stamped with their role (#55).
	shared, err := h.memberRepo.ListSharedVaults(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list vaults")
		return
	}
	vaults = append(vaults, shared...)

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

	role, err := h.vaultRepo.AccessRole(r.Context(), vaultID, userID)
	if err != nil || role == "" {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}
	vault.Role = role

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

// UpdateEncryption replaces the opaque key-material blob of an e2ee vault
// (passphrase change / recovery-key rotation). The encryption mode itself is
// immutable after creation.
func (h *VaultHandler) UpdateEncryption(w http.ResponseWriter, r *http.Request) {
	vaultID := r.PathValue("id")
	userID := middleware.GetUserID(r.Context())

	var req struct {
		EncryptionMeta json.RawMessage `json:"encryption_meta"`
	}
	if err := decodeJSON(r, &req); err != nil || len(req.EncryptionMeta) == 0 {
		writeError(w, http.StatusBadRequest, "encryption_meta is required")
		return
	}

	if err := h.vaultRepo.UpdateEncryptionMeta(r.Context(), vaultID, userID, req.EncryptionMeta); err != nil {
		if errors.Is(err, repository.ErrVaultNotFound) {
			writeError(w, http.StatusNotFound, "vault not found or not encrypted")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update encryption metadata")
		return
	}

	w.WriteHeader(http.StatusNoContent)
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
