#!/usr/bin/env bash
set -euo pipefail

# clooks entrypoint: project
# Do not copy this file to ~/.clooks/bin/ — use `clooks init --global` instead.
clooks_suppress() {
  if [ "${CLOOKS_APPROVAL_PROTOCOL:-}" = 1 ] && [ -n "${CLOOKS_APPROVAL_OWNER:-}" ]; then
    local binary status
    binary=$(command -v clooks 2>/dev/null) || exit 0
    CLOOKS_APPROVAL_DISPOSITION=suppressed "$binary" && status=0 || status=$?
    if [ "$status" -eq 0 ] || [ "$status" -eq 2 ]; then exit "$status"; fi
    printf '%s\n' '[clooks] Suppression completion failed.' >&2
    exit 2
  fi
  exit 0
}

# Bypass: allow disabling all Clooks processing via environment variable.
if [ "${SKIP_CLOOKS:-}" = "true" ]; then
  clooks_suppress
fi

# Global entrypoint dedup: if a global entrypoint is active, this project
# entrypoint is a noop for that same agent (the global one handles the merged pipeline).
CLOOKS_DEDUP_AGENT="${CLOOKS_AGENT:-claude-code}"
if [ "$CLOOKS_DEDUP_AGENT" = "claude-code" ] && [ -f "$HOME/.clooks/.global-entrypoint-active" ]; then
  clooks_suppress
fi
clooks_codex_receipt_matches() {
  local receipt version home codex checksum extra physical_home physical_codex runtime_home actual
  case "${HOME:-}" in /*) ;; *) return 1 ;; esac
  case "$HOME" in *$'\r'*|*$'\n'*) return 1 ;; esac
  receipt="$HOME/.clooks/.global-entrypoint-active.codex"
  [ ! -L "$receipt" ] && [ -f "$receipt" ] && [ -r "$receipt" ] || return 1
  # Bash line reads ignore NUL bytes; reject them before parsing the wire format.
  if IFS= read -r -d "" extra < "$receipt"; then return 1; fi
  {
    IFS= read -r version && IFS= read -r home &&
      IFS= read -r codex && IFS= read -r checksum || return 1
    if IFS= read -r extra || [ -n "$extra" ]; then return 1; fi
  } < "$receipt" || return 1
  [ "$version" = "clooks-codex-registration-v1" ] || return 1
  case "$home" in /*) ;; *) return 1 ;; esac
  case "$codex" in /*) ;; *) return 1 ;; esac
  case "$home$codex" in *$'\r'*|*$'\n'*) return 1 ;; esac
  [[ "$checksum" =~ ^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$ ]] || return 1
  physical_home=$(cd -P -- "$HOME" && pwd -P) || return 1
  [ "$home" = "$physical_home" ] || return 1
  if [ "${CLOOKS_HOME_ROOT+x}" = x ]; then
    case "$CLOOKS_HOME_ROOT" in /*) ;; *) return 1 ;; esac
    case "$CLOOKS_HOME_ROOT" in *$'\r'*|*$'\n'*) return 1 ;; esac
    runtime_home=$(cd -P -- "$CLOOKS_HOME_ROOT" && pwd -P) || return 1
    [ "$runtime_home" = "$home" ] || return 1
  fi
  physical_codex="${CODEX_HOME:-$HOME/.codex}"
  case "$physical_codex" in /*) ;; *) return 1 ;; esac
  case "$physical_codex" in *$'\r'*|*$'\n'*) return 1 ;; esac
  physical_codex=$(cd -P -- "$physical_codex" && pwd -P) || return 1
  [ "$codex" = "$physical_codex" ] || return 1
  [ -f "$home/.clooks/bin/entrypoint.sh" ] && [ -x "$home/.clooks/bin/entrypoint.sh" ] || return 1
  [ ! -L "$codex/hooks.json" ] && [ -f "$codex/hooks.json" ] && [ -r "$codex/hooks.json" ] || return 1
  actual=$(cksum < "$codex/hooks.json") || return 1
  [[ "$actual" =~ ^(0|[1-9][0-9]*)[[:blank:]]+(0|[1-9][0-9]*)$ ]] || return 1
  [ "$checksum" = "${BASH_REMATCH[1]}:${BASH_REMATCH[2]}" ]
}
if [ "$CLOOKS_DEDUP_AGENT" = "codex" ] && clooks_codex_receipt_matches 2>/dev/null; then
  clooks_suppress
fi
if [ "$CLOOKS_DEDUP_AGENT" != "codex" ] && [ -f "$HOME/.clooks/.global-entrypoint-active.$CLOOKS_DEDUP_AGENT" ]; then
  clooks_suppress
fi

# Locate the Clooks binary on PATH.
CLOOKS_BIN=$(command -v clooks 2>/dev/null) || true

# Bootstrap advisory: allow the action to proceed and print install guidance.
# A missing binary is a setup state, not a runtime failure — blocking here would
# deadlock /clooks:setup itself, which invokes the Bash tool that this hook guards.
if [ -z "$CLOOKS_BIN" ]; then
  cat >&2 <<'MSG'
[clooks] Binary not found. This project uses Clooks but it is not installed.
Install (Claude Code): run /clooks:setup
Install (manual):      https://github.com/codestripes-dev/clooks/releases/latest or check out https://clooks.cc
Bypass:                export SKIP_CLOOKS=true
MSG
  exit 0
fi

# Capture stdin so we can log it and replay it to the binary.
STDIN_DATA=$(cat)

# Debug: log input to a file for replay/diagnosis.
if [ "${CLOOKS_DEBUG:-}" = "true" ]; then
  LOGDIR="${CLOOKS_LOGDIR:-/tmp/clooks-debug}"
  mkdir -p "$LOGDIR"
  TIMESTAMP=$(date +%s%N)
  echo "$STDIN_DATA" > "$LOGDIR/$TIMESTAMP.json"
fi

# Delegate to the binary. It reads hook_event_name from stdin JSON.
# The && / || idiom captures the exit code without triggering set -e.
echo "$STDIN_DATA" | "$CLOOKS_BIN" && binary_exit=0 || binary_exit=$?

# Fail-closed exit code translation:
#   0 → success (pass through)
#   2 → intentional block (pass through)
#   any other → unexpected failure → block (fail-closed)
if [ "$binary_exit" -eq 0 ] || [ "$binary_exit" -eq 2 ]; then
  exit "$binary_exit"
fi

echo "[clooks] Binary exited with unexpected code $binary_exit. Blocking action (fail-closed)." >&2
exit 2
