package handler

import (
	"encoding/json"
	"errors"
	"net/http"
)

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// Request-body caps. Without them any client could stream an arbitrarily large
// body into memory (and on into Postgres); only the read timeout bounded it.
const (
	// maxJSONBody covers note content (E2EE payloads are base64, so larger than
	// the plaintext) and vault/tag/member payloads.
	maxJSONBody = 8 << 20
	// maxSmallJSONBody covers the auth endpoints, whose bodies are a few fields.
	maxSmallJSONBody = 64 << 10
)

func decodeJSON(w http.ResponseWriter, r *http.Request, v interface{}) error {
	return decodeLimited(w, r, v, maxJSONBody)
}

// decodeSmallJSON is decodeJSON with the tight cap used by the auth endpoints.
func decodeSmallJSON(w http.ResponseWriter, r *http.Request, v interface{}) error {
	return decodeLimited(w, r, v, maxSmallJSONBody)
}

func decodeLimited(w http.ResponseWriter, r *http.Request, v interface{}, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	defer func() { _ = r.Body.Close() }()
	return json.NewDecoder(r.Body).Decode(v)
}

// isBodyTooLarge reports whether err came from exceeding a body cap.
func isBodyTooLarge(err error) bool {
	var tooLarge *http.MaxBytesError
	return errors.As(err, &tooLarge)
}

// writeBodyError answers a failed body decode or validation: 413 when the body
// exceeded its cap, otherwise 400 with the handler's own message (err may be
// nil when the body decoded but a required field was missing).
func writeBodyError(w http.ResponseWriter, err error, badRequestMessage string) {
	if isBodyTooLarge(err) {
		writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
		return
	}
	writeError(w, http.StatusBadRequest, badRequestMessage)
}
