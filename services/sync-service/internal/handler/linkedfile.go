package handler

import (
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// maxLinkedContentBytes caps the size of a proxied URL fetch.
const maxLinkedContentBytes = 5 << 20 // 5 MiB

// LinkedFileHandler manages external file references linked into a vault plus
// their per-user annotations (#64). URL content is proxied server-side to
// avoid browser CORS and keep the fetch off the client.
type LinkedFileHandler struct {
	repo      *repository.LinkedFileRepo
	vaultRepo *repository.VaultRepo
	client    *http.Client
}

func NewLinkedFileHandler(repo *repository.LinkedFileRepo, vaultRepo *repository.VaultRepo) *LinkedFileHandler {
	return &LinkedFileHandler{repo: repo, vaultRepo: vaultRepo, client: &http.Client{Timeout: 15 * time.Second}}
}

// validLinkedSourceType reports whether s is an accepted linked-file source type.
func validLinkedSourceType(s string) bool {
	switch s {
	case model.LinkedSourceURL, model.LinkedSourceLocal, model.LinkedSourceGitHub:
		return true
	default:
		return false
	}
}

// Create registers a linked file. Write access (owner/editor) required.
func (h *LinkedFileHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("id")

	if !canWrite(r.Context(), h.vaultRepo, vaultID, userID) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	var req struct {
		DisplayName string `json:"display_name"`
		SourceType  string `json:"source_type"`
		SourceRef   string `json:"source_ref"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.SourceRef == "" {
		writeError(w, http.StatusBadRequest, "source_ref is required")
		return
	}
	if !validLinkedSourceType(req.SourceType) {
		writeError(w, http.StatusBadRequest, "source_type must be url, local_path or github_path")
		return
	}
	if req.DisplayName == "" {
		req.DisplayName = req.SourceRef
	}

	lf := &model.LinkedFile{
		VaultID:     vaultID,
		DisplayName: req.DisplayName,
		SourceType:  req.SourceType,
		SourceRef:   req.SourceRef,
		ReadOnly:    true,
	}
	if err := h.repo.Create(r.Context(), lf); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create link")
		return
	}
	writeJSON(w, http.StatusCreated, lf)
}

// List returns a vault's linked files. Read access required.
func (h *LinkedFileHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("id")

	if !canRead(r.Context(), h.vaultRepo, vaultID, userID) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}
	links, err := h.repo.ListByVault(r.Context(), vaultID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list links")
		return
	}
	if links == nil {
		links = []model.LinkedFile{}
	}
	writeJSON(w, http.StatusOK, links)
}

// Delete removes a link. Write access required.
func (h *LinkedFileHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	vaultID := r.PathValue("id")
	linkID := r.PathValue("linkId")

	if !canWrite(r.Context(), h.vaultRepo, vaultID, userID) {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}
	if err := h.repo.Delete(r.Context(), linkID, vaultID); err != nil {
		writeError(w, http.StatusNotFound, "link not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// linkedAccess loads a link and verifies vault read access; write=true requires editor.
func (h *LinkedFileHandler) linkedAccess(w http.ResponseWriter, r *http.Request, write bool) (*model.LinkedFile, bool) {
	userID := middleware.GetUserID(r.Context())
	lf, err := h.repo.GetByID(r.Context(), r.PathValue("linkId"))
	if err != nil {
		writeError(w, http.StatusNotFound, "link not found")
		return nil, false
	}
	ok := write && canWrite(r.Context(), h.vaultRepo, lf.VaultID, userID) ||
		!write && canRead(r.Context(), h.vaultRepo, lf.VaultID, userID)
	if !ok {
		writeError(w, http.StatusForbidden, "access denied")
		return nil, false
	}
	return lf, true
}

// Content proxies the current content of a URL-linked file (fetch on open).
// Local/GitHub sources aren't fetchable server-side and return 422.
func (h *LinkedFileHandler) Content(w http.ResponseWriter, r *http.Request) {
	lf, ok := h.linkedAccess(w, r, false)
	if !ok {
		return
	}
	if lf.SourceType != model.LinkedSourceURL {
		writeError(w, http.StatusUnprocessableEntity, "this link type is read on the client, not the server")
		return
	}
	if !strings.HasPrefix(lf.SourceRef, "http://") && !strings.HasPrefix(lf.SourceRef, "https://") {
		writeError(w, http.StatusBadRequest, "invalid URL")
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, lf.SourceRef, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch source")
		return
	}
	resp, err := h.client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch source")
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		writeError(w, http.StatusBadGateway, "source returned an error")
		return
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxLinkedContentBytes))
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to read source")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"content":      string(body),
		"content_type": resp.Header.Get("Content-Type"),
		"fetched_at":   time.Now().UTC().Format(time.RFC3339),
	})
}

// GetAnnotation returns the caller's annotation for a linked file (#64).
func (h *LinkedFileHandler) GetAnnotation(w http.ResponseWriter, r *http.Request) {
	lf, ok := h.linkedAccess(w, r, false)
	if !ok {
		return
	}
	content, err := h.repo.GetAnnotation(r.Context(), lf.ID, middleware.GetUserID(r.Context()))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load annotation")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"content": content})
}

// PutAnnotation upserts the caller's annotation for a linked file (#64).
func (h *LinkedFileHandler) PutAnnotation(w http.ResponseWriter, r *http.Request) {
	lf, ok := h.linkedAccess(w, r, false) // any member may keep their own notes
	if !ok {
		return
	}
	var req struct {
		Content string `json:"content"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.repo.UpsertAnnotation(r.Context(), lf.ID, middleware.GetUserID(r.Context()), req.Content); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save annotation")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
