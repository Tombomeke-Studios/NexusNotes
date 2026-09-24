#!/usr/bin/env bash
# Builds the Go backend as a Tauri sidecar binary, named per Tauri's
# externalBin convention (<name>-<rust-target-triple>[.exe]) so `tauri build`
# picks it up and bundles it into the desktop installer.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

triple="$(rustc -vV | awk '/^host:/ { print $2 }')"
out="$ROOT/desktop/src-tauri/binaries/sync-service-$triple"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) out="$out.exe" ;; esac

mkdir -p "$ROOT/desktop/src-tauri/binaries"
echo "▶ Building backend sidecar for $triple -> $out"
( cd "$ROOT/services/sync-service" && go build -o "$out" ./cmd/server )
