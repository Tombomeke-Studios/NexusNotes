#!/usr/bin/env bash
# Full native app testing: full backend + the Tauri desktop window. First launch
# compiles the Rust shell (slow); later launches are fast. Ctrl+C stops
# everything.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/_stack.sh"

start_stack

log "Launching native app (Tauri) — first run compiles Rust, please wait…"
cd "$DIR/../desktop"
[ -d node_modules ] || npm install
npm run tauri dev
