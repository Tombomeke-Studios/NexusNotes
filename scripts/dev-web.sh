#!/usr/bin/env bash
# Quick UI testing in a browser: full backend + the web UI (Vite) at
# http://localhost:1420. No Rust compile. Ctrl+C stops everything.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/_stack.sh"

start_stack

log "Starting web UI at http://localhost:1420 (Ctrl+C to stop)…"
cd "$DIR/../desktop"
[ -d node_modules ] || npm install
npm run dev
