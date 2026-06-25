package handler

import (
	"net/http"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
)

type TagHandler struct {
	syncService *service.SyncService
	vaultRepo   *repository.VaultRepo
}

func NewTagHandler(syncService *service.SyncService, vaultRepo *repository.VaultRepo) *TagHandler {
	return &TagHandler{syncService: syncService, vaultRepo: vaultRepo}
}

func (h *TagHandler) ListVaultTags(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("vaultId")

	vault, err := h.vaultRepo.GetByID(r.Context(), vaultID)
	if err != nil || vault.UserID != userID {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	tags, err := h.syncService.GetVaultTags(r.Context(), vaultID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list tags")
		return
	}

	if tags == nil {
		tags = []model.TagCount{}
	}

	writeJSON(w, http.StatusOK, tags)
}
