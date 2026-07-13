package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
)

type ctxKeyRequestID struct{}

// RequestID assigns every request a correlation id (#56): an inbound
// X-Request-ID is honoured (so ids can flow through proxies), otherwise a
// random one is generated. The id is stored on the context for log lines and
// echoed in the response header for client-side correlation.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" || len(id) > 64 {
			buf := make([]byte, 8)
			_, _ = rand.Read(buf)
			id = hex.EncodeToString(buf)
		}
		ctx := context.WithValue(r.Context(), ctxKeyRequestID{}, id)
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetRequestID returns the request's correlation id, or "" outside a request.
func GetRequestID(ctx context.Context) string {
	id, _ := ctx.Value(ctxKeyRequestID{}).(string)
	return id
}
