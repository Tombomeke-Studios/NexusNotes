// Package buildinfo exposes the release version of this build and the
// /health (liveness) and /ready (readiness) probes.
package buildinfo

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

// Version is the NexusNotes release this binary was built from. Release and
// Docker builds inject it with -ldflags "-X .../buildinfo.Version=x.y.z"
// (from the repo-root VERSION file); a plain `go build` reports "dev".
var Version = "dev"

// HealthHandler answers GET /health with liveness plus the build version, so
// clients can detect an app/server version mismatch.
func HealthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok", "version": Version})
}

// ReadyHandler answers GET /ready: 200 when check (e.g. a database ping)
// succeeds within timeout, 503 otherwise (#327). Unlike /health it reflects
// whether the service can do useful work, so it suits a container HEALTHCHECK
// or a load balancer. The failure reason is logged, never returned, so the
// probe does not reveal internal addresses.
func ReadyHandler(check func(context.Context) error, timeout time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		w.Header().Set("Content-Type", "application/json")
		if err := check(ctx); err != nil {
			slog.Warn("readiness check failed", "error", err)
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "unavailable"})
			return
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
	}
}
