package handler

import (
	"fmt"
	"io"
	"net/http"
	"path/filepath"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/storage"
)

const maxAttachmentBytes = 25 << 20 // 25 MiB

// AttachmentHandler manages note attachments backed by object storage (#153).
type AttachmentHandler struct {
	store       *storage.Store
	attachRepo  *repository.AttachmentRepo
	vaultRepo   *repository.VaultRepo
	syncService *service.SyncService
}

func NewAttachmentHandler(store *storage.Store, attachRepo *repository.AttachmentRepo, vaultRepo *repository.VaultRepo, syncService *service.SyncService) *AttachmentHandler {
	return &AttachmentHandler{store: store, attachRepo: attachRepo, vaultRepo: vaultRepo, syncService: syncService}
}

func (h *AttachmentHandler) enabled(w http.ResponseWriter) bool {
	if h.store == nil {
		writeError(w, http.StatusServiceUnavailable, "attachments are not configured on this server")
		return false
	}
	return true
}

// Upload accepts a multipart "file" field and stores it against a note.
func (h *AttachmentHandler) Upload(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w) {
		return
	}
	userID := middleware.GetUserID(r.Context())
	noteID := r.PathValue("noteId")

	note, err := h.syncService.GetNote(r.Context(), noteID)
	if err != nil {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	if !canWrite(r.Context(), h.vaultRepo, note.VaultID, userID) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	if err := r.ParseMultipartForm(maxAttachmentBytes); err != nil {
		writeError(w, http.StatusBadRequest, "invalid upload")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "a 'file' field is required")
		return
	}
	defer func() { _ = file.Close() }()

	if header.Size > maxAttachmentBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "file exceeds the 25 MiB limit")
		return
	}

	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	// Key namespaces objects by vault; the random id avoids collisions and
	// keeps the original filename out of the storage path.
	key := fmt.Sprintf("%s/%s%s", note.VaultID, uuid.New().String(), filepath.Ext(header.Filename))

	if err := h.store.Put(r.Context(), key, file, header.Size, contentType); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store file")
		return
	}

	att := &model.Attachment{
		NoteID:      noteID,
		VaultID:     note.VaultID,
		Filename:    filepath.Base(header.Filename),
		MimeType:    contentType,
		SizeBytes:   header.Size,
		StoragePath: key,
	}
	if err := h.attachRepo.Create(r.Context(), att); err != nil {
		_ = h.store.Delete(r.Context(), key) // best-effort cleanup of the orphan
		writeError(w, http.StatusInternalServerError, "failed to save attachment")
		return
	}

	writeJSON(w, http.StatusCreated, att)
}

// List returns a note's attachments.
func (h *AttachmentHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	noteID := r.PathValue("noteId")

	note, err := h.syncService.GetNote(r.Context(), noteID)
	if err != nil {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	if !canRead(r.Context(), h.vaultRepo, note.VaultID, userID) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	atts, err := h.attachRepo.ListByNote(r.Context(), noteID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list attachments")
		return
	}
	if atts == nil {
		atts = []model.Attachment{}
	}
	writeJSON(w, http.StatusOK, atts)
}

// Download streams an attachment's bytes to a caller with read access.
func (h *AttachmentHandler) Download(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w) {
		return
	}
	userID := middleware.GetUserID(r.Context())
	id := r.PathValue("id")

	att, err := h.attachRepo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "attachment not found")
		return
	}
	if !canRead(r.Context(), h.vaultRepo, att.VaultID, userID) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	obj, err := h.store.Get(r.Context(), att.StoragePath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read file")
		return
	}
	defer func() { _ = obj.Close() }()

	w.Header().Set("Content-Type", att.MimeType)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	_, _ = io.Copy(w, obj)
}

// Delete removes an attachment (metadata + bytes) for a caller with write access.
func (h *AttachmentHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w) {
		return
	}
	userID := middleware.GetUserID(r.Context())
	id := r.PathValue("id")

	att, err := h.attachRepo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "attachment not found")
		return
	}
	if !canWrite(r.Context(), h.vaultRepo, att.VaultID, userID) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	if err := h.attachRepo.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete attachment")
		return
	}
	_ = h.store.Delete(r.Context(), att.StoragePath)
	w.WriteHeader(http.StatusNoContent)
}
