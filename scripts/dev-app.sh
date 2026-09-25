#!/usr/bin/env bash
# Full native app testing: full backend + the Tauri desktop window. First launch
# compiles the Rust shell (slow); later launches are fast. Ctrl+C stops
# everything.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/_stack.sh"

# Tauri's Windows target needs dlltool.exe, which only the MSVC toolchain
# ships. The GNU toolchain (e.g. Rust from Chocolatey) fails with
# "dlltool.exe: program not found" after a slow Rust compile — catch it
# before that, not after (see README.md).
check_windows_rust_toolchain() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) ;;
    *) return ;;
  esac
  if ! command -v rustup >/dev/null 2>&1; then
    log "Rust isn't installed — the native app needs it. See https://www.rust-lang.org/tools/install"
    log "On Windows, install the MSVC toolchain: rustup default stable-x86_64-pc-windows-msvc"
    exit 1
  fi
  local toolchain
  toolchain="$(rustup show active-toolchain 2>/dev/null || true)"
  if [[ "$toolchain" == *windows-gnu* ]]; then
    log "Rust is set to the GNU toolchain ($toolchain) — Tauri's Windows build needs"
    log "the MSVC toolchain instead, or it fails with 'dlltool.exe: program not found'."
    read -rp "Switch to stable-x86_64-pc-windows-msvc now? [Y/n] " reply
    if [[ ! "$reply" =~ ^[Nn] ]]; then
      rustup default stable-x86_64-pc-windows-msvc
      log "Note: MSVC also needs the Visual Studio C++ build tools (the linker) —"
      log "if the build now fails with 'link.exe not found', install those too."
    else
      log "Skipping — the build will likely fail. See README.md for details."
    fi
  fi
}
check_windows_rust_toolchain

start_stack

log "Launching native app (Tauri) — first run compiles Rust, please wait…"
cd "$DIR/../desktop"
[ -d node_modules ] || npm install
npm run tauri dev
