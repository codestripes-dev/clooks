// Using string concatenation to avoid template literal escaping issues with
// bash $() command substitutions and ${} variable expansions.

/** Shebang + strict mode, shared by both entrypoint variants. */
const ENTRYPOINT_PREAMBLE =
  '#!/usr/bin/env bash\n' +
  'set -euo pipefail\n'

/** SKIP_CLOOKS bypass check, shared by both entrypoint variants. */
const SKIP_CLOOKS_CHECK =
  '\n' +
  '# Bypass: allow disabling all Clooks processing via environment variable.\n' +
  'if [ "${SKIP_CLOOKS:-}" = "true" ]; then\n' +
  '  exit 0\n' +
  'fi\n'

/** Dedup check: project entrypoint yields to the global one when active. */
const DEDUP_CHECK =
  '\n' +
  '# Global entrypoint dedup: if a global entrypoint is active, this project\n' +
  '# entrypoint is a noop (the global one handles the merged pipeline).\n' +
  'if [ -f "$HOME/.clooks/.global-entrypoint-active" ]; then\n' +
  '  exit 0\n' +
  'fi\n'

/** Shared body: binary location, bootstrap detection, stdin capture, debug logging, delegation, fail-closed. */
const ENTRYPOINT_BODY =
  '\n' +
  '# Locate the compiled Clooks binary.\n' +
  'CLOOKS_BIN="${CLOOKS_HOME:-$HOME/.clooks}/bin/clooks"\n' +
  '\n' +
  '# Bootstrap detection: block if binary missing (fail-closed).\n' +
  'if [ ! -x "$CLOOKS_BIN" ]; then\n' +
  "  cat >&2 <<'MSG'\n" +
  '[clooks] Binary not found. This project uses Clooks but it is not installed.\n' +
  'Install: curl -fsSL https://clooks.cc/install | bash\n' +
  'Bypass:  export SKIP_CLOOKS=true\n' +
  'MSG\n' +
  '  exit 2\n' +
  'fi\n' +
  '\n' +
  '# Capture stdin so we can log it and replay it to the binary.\n' +
  'STDIN_DATA=$(cat)\n' +
  '\n' +
  '# Debug: log input to a file for replay/diagnosis.\n' +
  'if [ "${CLOOKS_DEBUG:-}" = "true" ]; then\n' +
  '  LOGDIR="${CLOOKS_LOGDIR:-/tmp/clooks-debug}"\n' +
  '  mkdir -p "$LOGDIR"\n' +
  '  TIMESTAMP=$(date +%s%N)\n' +
  '  echo "$STDIN_DATA" > "$LOGDIR/$TIMESTAMP.json"\n' +
  'fi\n' +
  '\n' +
  '# Delegate to the binary. It reads hook_event_name from stdin JSON.\n' +
  '# The && / || idiom captures the exit code without triggering set -e.\n' +
  'echo "$STDIN_DATA" | "$CLOOKS_BIN" && binary_exit=0 || binary_exit=$?\n' +
  '\n' +
  '# Fail-closed exit code translation:\n' +
  '#   0 → success (pass through)\n' +
  '#   2 → intentional block (pass through)\n' +
  '#   any other → unexpected failure → block (fail-closed)\n' +
  'if [ "$binary_exit" -eq 0 ] || [ "$binary_exit" -eq 2 ]; then\n' +
  '  exit "$binary_exit"\n' +
  'fi\n' +
  '\n' +
  'echo "[clooks] Binary exited with unexpected code $binary_exit. Blocking action (fail-closed)." >&2\n' +
  'exit 2\n'

/** Bash entrypoint script content for project init, embedded as a template for `clooks init`. */
export const ENTRYPOINT_SCRIPT =
  ENTRYPOINT_PREAMBLE + SKIP_CLOOKS_CHECK + DEDUP_CHECK + ENTRYPOINT_BODY

/**
 * Bash entrypoint script for global init (`clooks init --global`).
 * Identical to the project entrypoint but WITHOUT the dedup check —
 * it IS the global entrypoint and is the authoritative one.
 */
export const GLOBAL_ENTRYPOINT_SCRIPT =
  ENTRYPOINT_PREAMBLE + SKIP_CLOOKS_CHECK + ENTRYPOINT_BODY
