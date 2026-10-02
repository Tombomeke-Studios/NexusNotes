package middleware

import (
	"net/http"
	"time"
)

// Deadlines gives a route its own read and write deadlines, replacing the
// server-wide ReadTimeout/WriteTimeout that suit ordinary API calls (#332).
// Long transfers (attachment uploads and downloads, account export, proxied
// linked-file fetches) would otherwise be cut off mid-way on a slow link.
// Deadlines are absolute: they are set from the moment the route is reached.
func Deadlines(read, write time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rc := http.NewResponseController(w)
			now := time.Now()
			// Best effort: a writer that does not support deadlines keeps the
			// server's.
			_ = rc.SetReadDeadline(now.Add(read))
			_ = rc.SetWriteDeadline(now.Add(write))
			next.ServeHTTP(w, r)
		})
	}
}
