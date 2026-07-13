package middleware

import (
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/metrics"
)

// idSegment matches uuid-like path segments so per-resource ids never become
// Prometheus label values (r.Pattern is only set on the mux's internal request
// copy, so the matched pattern is not observable from outer middleware).
var idSegment = regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}`)

// RouteLabel normalizes a request path into a bounded-cardinality metric label.
func RouteLabel(path string) string {
	return idSegment.ReplaceAllString(path, ":id")
}

// Metrics records request count and latency per normalized route (#57).
func Metrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(rw, r)

		route := RouteLabel(r.URL.Path)
		metrics.HTTPRequests.WithLabelValues(route, r.Method, strconv.Itoa(rw.status)).Inc()
		metrics.HTTPDuration.WithLabelValues(route).Observe(time.Since(start).Seconds())
	})
}
