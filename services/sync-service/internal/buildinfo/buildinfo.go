// Package buildinfo exposes the release version of this build.
package buildinfo

import (
	"encoding/json"
	"net/http"
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
