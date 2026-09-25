#!/usr/bin/env bash
# Sets the NexusNotes release version everywhere it lives.
#   ./scripts/set-version.sh 0.6.0   write VERSION, then sync the manifests
#   ./scripts/set-version.sh         re-sync the manifests from VERSION
# VERSION (repo root) is the source of truth; package.json, tauri.conf.json and
# Cargo.toml are derived. The backend gets it at build time (see the Dockerfile).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ $# -gt 1 ]; then echo "usage: $0 [x.y.z]" >&2; exit 2; fi
if [ $# -eq 1 ]; then
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not a valid x.y.z version: $1" >&2; exit 2; }
  printf '%s\n' "$1" > "$ROOT/VERSION"
fi
V="$(tr -d '[:space:]' < "$ROOT/VERSION")"

# Only the first "version" key / line is touched, and line endings are preserved.
sed -i -E '0,/"version": "[^"]*"/s//"version": "'"$V"'"/' "$ROOT/desktop/package.json" "$ROOT/desktop/src-tauri/tauri.conf.json"
sed -i -E '0,/^version = "[^"]*"/s//version = "'"$V"'"/' "$ROOT/desktop/src-tauri/Cargo.toml"

# Lockfiles carry the app's own version too (package-lock: top of file, twice;
# Cargo.lock: the entry right after `name = "nexusnotes"`).
sed -i -E '1,12s/"version": "[^"]*"/"version": "'"$V"'"/' "$ROOT/desktop/package-lock.json"
sed -i -E '/^name = "nexusnotes"$/{n;s/^version = "[^"]*"/version = "'"$V"'"/}' "$ROOT/desktop/src-tauri/Cargo.lock"

echo "NexusNotes version set to $V"
