#!/usr/bin/env bash
set -euo pipefail

# Bypass: allow disabling all Clooks processing via environment variable.
if [ "${SKIP_CLOOKS:-}" = "true" ]; then
  exit 0
fi

# Global entrypoint dedup: if a global entrypoint is active, this project
# entrypoint is a noop (the global one handles the merged pipeline).
if [ -f "$HOME/.clooks/.global-entrypoint-active" ]; then
  exit 0
fi

# Locate the compiled Clooks binary.
CLOOKS_BIN="${CLOOKS_HOME:-$HOME/.clooks}/bin/clooks"

# Bootstrap detection: block if binary missing (fail-closed).
if [ ! -x "$CLOOKS_BIN" ]; then
  cat >&2 <<'MSG'
[clooks] Binary not found. This project uses Clooks but it is not installed.
Install: curl -fsSL https://clooks.cc/install | bash
Bypass:  export SKIP_CLOOKS=true
MSG
  exit 2
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
