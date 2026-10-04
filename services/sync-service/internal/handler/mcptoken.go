package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
)

// MCPTokenHandler manages the API tokens AI clients use over MCP (#221).
// These routes are only reachable when signed in: an MCP token cannot list,
// create or revoke tokens itself.
type MCPTokenHandler struct {
	tokens *service.MCPTokenService
}

func NewMCPTokenHandler(tokens *service.MCPTokenService) *MCPTokenHandler {
	return &MCPTokenHandler{tokens: tokens}
}

// List returns the caller's tokens (never their values), newest first.
func (h *MCPTokenHandler) List(w http.ResponseWriter, r *http.Request) {
	tokens, err := h.tokens.List(r.Context(), middleware.GetUserID(r.Context()))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list tokens")
		return
	}
	writeJSON(w, http.StatusOK, tokens)
}

type createMCPTokenRequest struct {
	Name  string `json:"name"`
	Scope string `json:"scope"`
}

type createMCPTokenResponse struct {
	model.MCPToken
	// Token is the secret value, returned only in this response.
	Token string `json:"token"`
}

// Create issues a token; its value is in the response and nowhere else.
func (h *MCPTokenHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createMCPTokenRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeBodyError(w, err, "invalid request body")
		return
	}
	token, secret, err := h.tokens.Create(r.Context(), middleware.GetUserID(r.Context()), req.Name, req.Scope)
	switch {
	case errors.Is(err, service.ErrMCPTokenName), errors.Is(err, service.ErrMCPTokenScope):
		writeError(w, http.StatusBadRequest, err.Error())
		return
	case errors.Is(err, service.ErrMCPTokenLimit):
		writeError(w, http.StatusConflict, err.Error())
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "failed to create token")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, createMCPTokenResponse{MCPToken: *token, Token: secret})
}

// Revoke deletes one of the caller's tokens; it stops working at once.
func (h *MCPTokenHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	removed, err := h.tokens.Revoke(r.Context(), middleware.GetUserID(r.Context()), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to revoke token")
		return
	}
	if !removed {
		writeError(w, http.StatusNotFound, "token not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Audit returns the newest audit entries of the caller's tokens
// (?token_id= narrows it to one, ?limit= 1-500, default 100).
func (h *MCPTokenHandler) Audit(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 500 {
			writeError(w, http.StatusBadRequest, "limit must be 1-500")
			return
		}
		limit = n
	}
	entries, err := h.tokens.Audit(r.Context(), middleware.GetUserID(r.Context()), r.URL.Query().Get("token_id"), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read the audit log")
		return
	}
	writeJSON(w, http.StatusOK, entries)
}
