package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/ws"
)

// Trash (#569): deleting moves a note to its vault's trash, from where it can
// be restored for TRASH_RETENTION_DAYS (30 by default) before the purge job
// deletes it for good. Editors and owners can trash and restore; only the
// owner can purge or empty the trash; viewers can do neither.

// trashedEvent is the payload of note:trashed.
type trashedEvent struct {
	NoteID    string    `json:"note_id"`
	VaultID   string    `json:"vault_id"`
	DeletedAt time.Time `json:"deleted_at"`
}

// isOwner reports whether the user owns the vault.
func isOwner(ctx context.Context, vaultRepo vaultRoles, vaultID, userID string) bool {
	role, err := vaultRepo.AccessRole(ctx, vaultID, userID)
	return err == nil && role == model.VaultRoleOwner
}

// broadcastTrashed tells the vault's devices that notes went to the trash:
// note:trashed for apps with a trash view, and note:deleted so apps from
// before the trash drop the note as they always did.
func (h *NoteHandler) broadcastTrashed(ctx context.Context, vaultID string, notes []model.TrashedNote) {
	for _, n := range notes {
		trashed, _ := json.Marshal(trashedEvent{NoteID: n.ID, VaultID: vaultID, DeletedAt: n.DeletedAt})
		h.broadcastToVault(ctx, vaultID, ws.Message{Type: "note:trashed", Payload: trashed})
		deleted, _ := json.Marshal(map[string]string{"note_id": n.ID})
		h.broadcastToVault(ctx, vaultID, ws.Message{Type: "note:deleted", Payload: deleted})
	}
}

// NotifyPurged tells the vault's devices a trashed note is gone for good (the
// purge job calls it).
func (h *NoteHandler) NotifyPurged(ctx context.Context, vaultID, noteID string) {
	payload, _ := json.Marshal(map[string]string{"note_id": noteID})
	h.broadcastToVault(ctx, vaultID, ws.Message{Type: "note:deleted", Payload: payload})
}

// trashInVault moves one live note of the vault to the trash and notifies the
// vault's devices. The caller has checked write access. It answers 404 itself
// when there is no such live note.
func (h *NoteHandler) trashInVault(w http.ResponseWriter, r *http.Request, vaultID, noteID string) (*model.TrashedNote, bool) {
	trashed, err := h.syncService.TrashNotes(r.Context(), vaultID, []string{noteID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to move the note to the trash")
		return nil, false
	}
	if len(trashed) == 0 {
		writeError(w, http.StatusNotFound, "note not found")
		return nil, false
	}
	h.broadcastTrashed(r.Context(), vaultID, trashed)
	return &trashed[0], true
}

// Trash moves a note to its vault's trash: POST /api/notes/{noteId}/trash.
// Write access required; an AI client cannot trash in an e2ee vault (as it
// cannot write there).
func (h *NoteHandler) Trash(w http.ResponseWriter, r *http.Request) {
	noteID := r.PathValue("noteId")
	note, err := h.syncService.GetNote(r.Context(), noteID)
	if err != nil {
		writeLookupError(w, err, "note not found")
		return
	}
	if !canWrite(r.Context(), h.vaultRepo, note.VaultID, middleware.GetUserID(r.Context())) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}
	if h.mcpWriteDenied(w, r, note.VaultID) {
		return
	}
	trashed, ok := h.trashInVault(w, r, note.VaultID, noteID)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, trashed)
}

// TrashBatch moves several notes of a vault (a folder) to the trash at once:
// POST /api/vaults/{id}/trash with {"note_ids": [...]}. Ids that are not live
// notes of the vault are skipped; the response lists the ones moved, like
// the trash list does.
func (h *NoteHandler) TrashBatch(w http.ResponseWriter, r *http.Request) {
	vaultID := r.PathValue("id")
	if !canWrite(r.Context(), h.vaultRepo, vaultID, middleware.GetUserID(r.Context())) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}
	var req struct {
		NoteIDs []string `json:"note_ids"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeBodyError(w, err, "invalid request body")
		return
	}
	if len(req.NoteIDs) == 0 || len(req.NoteIDs) > service.MaxTrashBatch {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("note_ids must hold 1-%d ids", service.MaxTrashBatch))
		return
	}
	trashed, err := h.syncService.TrashNotes(r.Context(), vaultID, req.NoteIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to move the notes to the trash")
		return
	}
	h.broadcastTrashed(r.Context(), vaultID, trashed)
	writeJSON(w, http.StatusOK, trashed)
}

// ListTrash lists a vault's trashed notes, most recently trashed first:
// GET /api/vaults/{id}/trash. Read access required. No content; titles and
// paths as stored (sealed in e2ee vaults).
func (h *NoteHandler) ListTrash(w http.ResponseWriter, r *http.Request) {
	vaultID := r.PathValue("id")
	if !canRead(r.Context(), h.vaultRepo, vaultID, middleware.GetUserID(r.Context())) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}
	notes, err := h.syncService.ListTrash(r.Context(), vaultID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list the trash")
		return
	}
	writeJSON(w, http.StatusOK, notes)
}

// trashedNoteVault finds the vault of the path's trashed note, answering 404
// itself when there is none.
func (h *NoteHandler) trashedNoteVault(w http.ResponseWriter, r *http.Request) (string, bool) {
	vaultID, err := h.syncService.TrashedNoteVault(r.Context(), r.PathValue("noteId"))
	if errors.Is(err, repository.ErrNoteNotFound) {
		writeError(w, http.StatusNotFound, "note not found in the trash")
		return "", false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to look up the note")
		return "", false
	}
	return vaultID, true
}

// Restore takes a note out of the trash, back at its original path:
// POST /api/notes/{noteId}/restore. Write access required. Answers with the
// note, which also goes to the vault's devices as note:restored.
func (h *NoteHandler) Restore(w http.ResponseWriter, r *http.Request) {
	vaultID, ok := h.trashedNoteVault(w, r)
	if !ok {
		return
	}
	if !canWrite(r.Context(), h.vaultRepo, vaultID, middleware.GetUserID(r.Context())) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}
	note, err := h.syncService.RestoreNote(r.Context(), vaultID, r.PathValue("noteId"))
	if errors.Is(err, repository.ErrNoteNotFound) {
		writeError(w, http.StatusNotFound, "note not found in the trash")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to restore the note")
		return
	}
	payload, _ := json.Marshal(note)
	h.broadcastToVault(r.Context(), vaultID, ws.Message{Type: "note:restored", Payload: payload})
	writeJSON(w, http.StatusOK, note)
}

// purge deletes one trashed note for good and notifies the vault's devices;
// its attachment files go after the database commit, best-effort.
func (h *NoteHandler) purge(ctx context.Context, vaultID, noteID string) (bool, error) {
	keys, purged, err := h.syncService.PurgeNote(ctx, vaultID, noteID)
	if err != nil || !purged {
		return false, err
	}
	if h.files != nil {
		h.files.RemoveFiles(ctx, keys)
	}
	h.NotifyPurged(ctx, vaultID, noteID)
	return true, nil
}

// Purge deletes a trashed note for good: DELETE /api/notes/{noteId}/purge.
// Only the vault owner may.
func (h *NoteHandler) Purge(w http.ResponseWriter, r *http.Request) {
	vaultID, ok := h.trashedNoteVault(w, r)
	if !ok {
		return
	}
	if !isOwner(r.Context(), h.vaultRepo, vaultID, middleware.GetUserID(r.Context())) {
		writeError(w, http.StatusForbidden, "only the vault owner can delete notes for good")
		return
	}
	purged, err := h.purge(r.Context(), vaultID, r.PathValue("noteId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete the note")
		return
	}
	if !purged {
		writeError(w, http.StatusNotFound, "note not found in the trash")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// EmptyTrash deletes every trashed note of the vault for good, one
// transaction per note: POST /api/vaults/{id}/trash/empty. Only the owner may.
func (h *NoteHandler) EmptyTrash(w http.ResponseWriter, r *http.Request) {
	vaultID := r.PathValue("id")
	if !isOwner(r.Context(), h.vaultRepo, vaultID, middleware.GetUserID(r.Context())) {
		writeError(w, http.StatusForbidden, "only the vault owner can empty the trash")
		return
	}
	ids, err := h.syncService.TrashedIDs(r.Context(), vaultID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to empty the trash")
		return
	}
	count := 0
	for _, id := range ids {
		purged, err := h.purge(r.Context(), vaultID, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to empty the trash")
			return
		}
		if purged {
			count++
		}
	}
	writeJSON(w, http.StatusOK, map[string]int{"purged": count})
}
