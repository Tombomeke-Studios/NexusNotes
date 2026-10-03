package handler

import (
	"context"
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
	memberRepo  *repository.VaultMemberRepo
	hub         *ws.Hub
	files       noteFileCleaner // nil when attachments are disabled
}

// noteFileCleaner finds and deletes a note's attachment files in object storage.
type noteFileCleaner interface {
	NoteFiles(ctx context.Context, noteID string) []string
	RemoveFiles(ctx context.Context, keys []string)
}

// SetFileCleanup makes note deletion also erase its attachment files (#290).
func (h *NoteHandler) SetFileCleanup(files noteFileCleaner) {
	h.files = files
}

func NewNoteHandler(syncService *service.SyncService, vaultRepo *repository.VaultRepo, memberRepo *repository.VaultMemberRepo, hub *ws.Hub) *NoteHandler {
	return &NoteHandler{
		syncService: syncService,
		vaultRepo:   vaultRepo,
		memberRepo:  memberRepo,
		hub:         hub,
	}
}

// broadcastToVault pushes a note event to everyone with access to the vault —
// the owner and every member — so shared vaults sync in real time (#54).
func (h *NoteHandler) broadcastToVault(r *http.Request, vaultID string, msg ws.Message) {
	recipients := map[string]bool{}
	if vault, err := h.vaultRepo.GetByID(r.Context(), vaultID); err == nil {
		recipients[vault.UserID] = true
	}
	if ids, err := h.memberRepo.MemberUserIDs(r.Context(), vaultID); err == nil {
		for _, id := range ids {
			recipients[id] = true
		}
	}
	for userID := range recipients {
		h.hub.BroadcastToUser(userID, msg, nil)
	}
}

func (h *NoteHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("vaultId")

	if !canWrite(r.Context(), h.vaultRepo, vaultID, userID) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	var req struct {
		Title    string `json:"title"`
		Path     string `json:"path"`
		Content  string `json:"content"`
		DeviceID string `json:"device_id"`
		// Client plaintext checksum; only honoured for e2ee vaults.
		Checksum string `json:"checksum"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeBodyError(w, err, "invalid request body")
		return
	}

	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	note, err := h.syncService.CreateNote(r.Context(), vaultID, req.Title, req.Path, req.Content, req.DeviceID, req.Checksum)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create note")
		return
	}

	payload, _ := json.Marshal(note)
	h.broadcastToVault(r, vaultID, ws.Message{Type: "note:created", Payload: payload})

	writeJSON(w, http.StatusCreated, note)
}

func (h *NoteHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("vaultId")

	if !canRead(r.Context(), h.vaultRepo, vaultID, userID) {
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
		writeLookupError(w, err, "note not found")
		return
	}

	if !canRead(r.Context(), h.vaultRepo, note.VaultID, userID) {
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
		writeLookupError(w, err, "note not found")
		return
	}
	if !canWrite(r.Context(), h.vaultRepo, existing.VaultID, userID) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	var req struct {
		Title        string `json:"title"`
		Path         string `json:"path"`
		Content      string `json:"content"`
		PrevChecksum string `json:"prev_checksum"`
		// Client plaintext checksum; only honoured for e2ee vaults.
		Checksum string `json:"checksum"`
		DeviceID string `json:"device_id"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeBodyError(w, err, "invalid request body")
		return
	}

	update := service.NoteUpdate{
		NoteID:       noteID,
		Content:      req.Content,
		Title:        req.Title,
		Path:         req.Path,
		PrevChecksum: req.PrevChecksum,
		Checksum:     req.Checksum,
		DeviceID:     req.DeviceID,
	}

	note, conflict, err := h.syncService.UpdateNote(r.Context(), update)
	if err != nil {
		if errors.Is(err, service.ErrConflict) {
			writeJSON(w, http.StatusConflict, conflict)
			return
		}
		if errors.Is(err, service.ErrNoteNotFound) {
			writeError(w, http.StatusNotFound, "note not found")
			return
		}
		if errors.Is(err, service.ErrNoteBusy) {
			w.Header().Set("Retry-After", "1")
			writeError(w, http.StatusServiceUnavailable, "note is being saved by another device, retry")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update note")
		return
	}

	payload, _ := json.Marshal(note)
	h.broadcastToVault(r, note.VaultID, ws.Message{Type: "note:updated", Payload: payload})

	writeJSON(w, http.StatusOK, note)
}

func (h *NoteHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("vaultId")
	noteID := r.PathValue("noteId")

	if !canWrite(r.Context(), h.vaultRepo, vaultID, userID) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	// The note must live in the vault named by the path; otherwise the delete
	// would be a silent no-op in the database yet still drop the note from the
	// search index and broadcast a deletion for it.
	note, err := h.syncService.GetNote(r.Context(), noteID)
	if err != nil {
		writeLookupError(w, err, "note not found")
		return
	}
	if note.VaultID != vaultID {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}

	// Collect the attachment keys first: the rows cascade away with the note.
	var fileKeys []string
	if h.files != nil {
		fileKeys = h.files.NoteFiles(r.Context(), noteID)
	}
	if err := h.syncService.DeleteNote(r.Context(), noteID, vaultID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete note")
		return
	}
	if h.files != nil {
		h.files.RemoveFiles(r.Context(), fileKeys)
	}

	payload, _ := json.Marshal(map[string]string{"note_id": noteID})
	h.broadcastToVault(r, vaultID, ws.Message{Type: "note:deleted", Payload: payload})

	w.WriteHeader(http.StatusNoContent)
}

// readableNote loads the path's note and checks vault read access: versions
// carry note content, so they need the same access as the note itself.
func (h *NoteHandler) readableNote(w http.ResponseWriter, r *http.Request) (*model.Note, bool) {
	note, err := h.syncService.GetNote(r.Context(), r.PathValue("noteId"))
	if err != nil {
		writeLookupError(w, err, "note not found")
		return nil, false
	}
	if !canRead(r.Context(), h.vaultRepo, note.VaultID, middleware.GetUserID(r.Context())) {
		writeError(w, http.StatusForbidden, "access denied")
		return nil, false
	}
	return note, true
}

// Version returns one version of a note with its content (#414).
func (h *NoteHandler) Version(w http.ResponseWriter, r *http.Request) {
	note, ok := h.readableNote(w, r)
	if !ok {
		return
	}
	v, err := h.syncService.GetVersion(r.Context(), note.ID, r.PathValue("versionId"))
	if err != nil {
		writeLookupError(w, err, "version not found")
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// RestoreVersion makes a stored version the note's content again (#417), as
// a new version. Write access required; a stale prev_checksum is a 409 with
// the same conflict body as a save.
func (h *NoteHandler) RestoreVersion(w http.ResponseWriter, r *http.Request) {
	existing, err := h.syncService.GetNote(r.Context(), r.PathValue("noteId"))
	if err != nil {
		writeLookupError(w, err, "note not found")
		return
	}
	if !canWrite(r.Context(), h.vaultRepo, existing.VaultID, middleware.GetUserID(r.Context())) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}
	var req struct {
		PrevChecksum string `json:"prev_checksum"`
		DeviceID     string `json:"device_id"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeBodyError(w, err, "invalid request body")
		return
	}
	note, conflict, err := h.syncService.RestoreVersion(r.Context(), existing.ID, r.PathValue("versionId"), req.PrevChecksum, req.DeviceID)
	switch {
	case err == nil:
	case errors.Is(err, service.ErrConflict):
		writeJSON(w, http.StatusConflict, conflict)
		return
	case errors.Is(err, service.ErrNoteBusy):
		w.Header().Set("Retry-After", "1")
		writeError(w, http.StatusServiceUnavailable, "note is being saved by another device, retry")
		return
	default:
		writeLookupError(w, err, "version not found")
		return
	}
	payload, _ := json.Marshal(note)
	h.broadcastToVault(r, note.VaultID, ws.Message{Type: "note:updated", Payload: payload})
	writeJSON(w, http.StatusOK, note)
}

// Versions lists a note's versions, newest first, without content.
func (h *NoteHandler) Versions(w http.ResponseWriter, r *http.Request) {
	note, ok := h.readableNote(w, r)
	if !ok {
		return
	}
	noteID := note.ID

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

	if !canRead(r.Context(), h.vaultRepo, vaultID, userID) {
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
		writeLookupError(w, err, "note not found")
		return
	}
	if !canRead(r.Context(), h.vaultRepo, note.VaultID, userID) {
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

// maxConvertBody caps POST /api/vaults/{id}/encryption/convert, which carries
// every note of the vault re-encrypted.
const maxConvertBody = 64 << 20

// ConvertVault turns the caller's standard vault into an e2ee one (#361): the
// client sends every note encrypted under the new vault key plus the wrapped
// key material. On success every device of the owner and members is told to
// reload the vault, which is now locked for them.
func (h *NoteHandler) ConvertVault(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("id")

	var req struct {
		EncryptionMeta json.RawMessage       `json:"encryption_meta"`
		Notes          []service.ConvertNote `json:"notes"`
		Links          []service.ConvertLink `json:"links"`
	}
	if err := decodeLimited(w, r, &req, maxConvertBody); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	err := h.syncService.ConvertVaultToE2EE(r.Context(), vaultID, userID, req.EncryptionMeta, req.Notes, req.Links)
	switch {
	case err == nil:
	case errors.Is(err, repository.ErrVaultNotFound):
		writeError(w, http.StatusNotFound, "vault not found")
		return
	case errors.Is(err, service.ErrConvertMissingMeta), errors.Is(err, service.ErrConvertMissingTitle),
		errors.Is(err, service.ErrConvertMissingLinkField):
		writeError(w, http.StatusBadRequest, err.Error())
		return
	case errors.Is(err, service.ErrConvertNotesChanged):
		writeError(w, http.StatusConflict, err.Error())
		return
	case errors.Is(err, service.ErrConvertNotStandard), errors.Is(err, service.ErrConvertHasAttachments):
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	default:
		writeError(w, http.StatusInternalServerError, "failed to convert vault")
		return
	}

	vault, err := h.vaultRepo.GetByID(r.Context(), vaultID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load vault")
		return
	}
	payload, _ := json.Marshal(map[string]string{"vault_id": vaultID})
	h.broadcastToVault(r, vaultID, ws.Message{Type: "vault:encrypted", Payload: payload})
	writeJSON(w, http.StatusOK, vault)
}
