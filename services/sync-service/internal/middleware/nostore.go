package middleware

import (
	"net/http"
	"strings"
)

// NoStore marks every /api/ response "Cache-Control: private, no-store"
// (#553): they carry account data and tokens, which no browser or proxy cache
// should keep. It sets the header before the handler runs, so a handler with
// its own policy (attachment bytes are immutable) replaces it, and error
// responses get it too.
func NoStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "private, no-store")
		}
		next.ServeHTTP(w, r)
	})
}
