package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/ws"
)

type NoteHandler struct {
	syncService *service.SyncService
	vaultRepo   *repository.VaultRepo
	hub         *ws.Hub
}

func NewNoteHandler(syncService *service.SyncService, vaultRepo *repository.VaultRepo, hub *ws.Hub) *NoteHandler {
	return &NoteHandler{
		syncService: syncService,
		vaultRepo:   vaultRepo,
		hub:         hub,
	}
}

func (h *NoteHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("vaultId")

	vault, err := h.vaultRepo.GetByID(r.Context(), vaultID)
	if err != nil || vault.UserID != userID {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	var req struct {
		Title    string `json:"title"`
		Path     string `json:"path"`
		Content  string `json:"content"`
		DeviceID string `json:"device_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	note, err := h.syncService.CreateNote(r.Context(), vaultID, req.Title, req.Path, req.Content, req.DeviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create note")
		return
	}

	payload, _ := json.Marshal(note)
	h.hub.BroadcastToUser(userID, ws.Message{
		Type:    "note:created",
		Payload: payload,
	}, nil)

	writeJSON(w, http.StatusCreated, note)
}

func (h *NoteHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("vaultId")

	vault, err := h.vaultRepo.GetByID(r.Context(), vaultID)
	if err != nil || vault.UserID != userID {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	notes, err := h.syncService.ListNotes(r.Context(), vaultID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list notes")
		return
	}

	if notes == nil {
		notes = []model.Note{}
	}

	writeJSON(w, http.StatusOK, notes)
}

func (h *NoteHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	noteID := r.PathValue("noteId")

	note, err := h.syncService.GetNote(r.Context(), noteID)
	if err != nil {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}

	vault, err := h.vaultRepo.GetByID(r.Context(), note.VaultID)
	if err != nil || vault.UserID != userID {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	writeJSON(w, http.StatusOK, note)
}

func (h *NoteHandler) Update(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	noteID := r.PathValue("noteId")

	existing, err := h.syncService.GetNote(r.Context(), noteID)
	if err != nil {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	vault, err := h.vaultRepo.GetByID(r.Context(), existing.VaultID)
	if err != nil || vault.UserID != userID {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	var req struct {
		Title        string `json:"title"`
		Path         string `json:"path"`
		Content      string `json:"content"`
		PrevChecksum string `json:"prev_checksum"`
		DeviceID     string `json:"device_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	update := service.NoteUpdate{
		NoteID:       noteID,
		Content:      req.Content,
		Title:        req.Title,
		Path:         req.Path,
		PrevChecksum: req.PrevChecksum,
		DeviceID:     req.DeviceID,
	}

	note, conflict, err := h.syncService.UpdateNote(r.Context(), update)
	if err != nil {
		if errors.Is(err, service.ErrConflict) {
			writeJSON(w, http.StatusConflict, conflict)
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update note")
		return
	}

	payload, _ := json.Marshal(note)
	h.hub.BroadcastToUser(userID, ws.Message{
		Type:    "note:updated",
		Payload: payload,
	}, nil)

	writeJSON(w, http.StatusOK, note)
}

func (h *NoteHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("vaultId")
	noteID := r.PathValue("noteId")

	if err := h.syncService.DeleteNote(r.Context(), noteID, vaultID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete note")
		return
	}

	payload, _ := json.Marshal(map[string]string{"note_id": noteID})
	h.hub.BroadcastToUser(userID, ws.Message{
		Type:    "note:deleted",
		Payload: payload,
	}, nil)

	w.WriteHeader(http.StatusNoContent)
}

func (h *NoteHandler) Versions(w http.ResponseWriter, r *http.Request) {
	noteID := r.PathValue("noteId")

	versions, err := h.syncService.GetVersions(r.Context(), noteID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get versions")
		return
	}

	if versions == nil {
		versions = []model.NoteVersion{}
	}

	writeJSON(w, http.StatusOK, versions)
}

func (h *NoteHandler) Search(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("vaultId")

	vault, err := h.vaultRepo.GetByID(r.Context(), vaultID)
	if err != nil || vault.UserID != userID {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	query := r.URL.Query().Get("q")
	if query == "" {
		writeError(w, http.StatusBadRequest, "q parameter is required")
		return
	}

	results, err := h.syncService.SearchNotes(r.Context(), vaultID, query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}

	if results == nil {
		results = []model.NoteSearchResult{}
	}

	writeJSON(w, http.StatusOK, results)
}

func (h *NoteHandler) Backlinks(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	noteID := r.PathValue("noteId")

	note, err := h.syncService.GetNote(r.Context(), noteID)
	if err != nil {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	vault, err := h.vaultRepo.GetByID(r.Context(), note.VaultID)
	if err != nil || vault.UserID != userID {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	backlinks, err := h.syncService.GetBacklinks(r.Context(), noteID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get backlinks")
		return
	}

	if backlinks == nil {
		backlinks = []model.BacklinkNote{}
	}

	writeJSON(w, http.StatusOK, backlinks)
}
