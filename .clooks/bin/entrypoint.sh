#!/usr/bin/env bash
set -euo pipefail

# clooks entrypoint: project
# Do not copy this file to ~/.clooks/bin/ — use `clooks init --global` instead.

# Bypass: allow disabling all Clooks processing via environment variable.
if [ "${SKIP_CLOOKS:-}" = "true" ]; then
  exit 0
fi

# Global entrypoint dedup: if a global entrypoint is active, this project
# entrypoint is a noop (the global one handles the merged pipeline).
if [ -f "$HOME/.clooks/.global-entrypoint-active" ]; then
  exit 0
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
