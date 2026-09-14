// Using string concatenation to avoid template literal escaping issues with
// bash $() command substitutions and ${} variable expansions.

const ENTRYPOINT_PREAMBLE = '#!/usr/bin/env bash\n' + 'set -euo pipefail\n'

/** Type header identifying the script variant. Prevents silent misplacement. */
const PROJECT_HEADER =
  '\n' +
  '# clooks entrypoint: project\n' +
  '# Do not copy this file to ~/.clooks/bin/ — use `clooks init --global` instead.\n'

const GLOBAL_HEADER =
  '\n' +
  '# clooks entrypoint: global\n' +
  '# Do not copy this file to a project — use `clooks init` instead.\n'

const SKIP_CLOOKS_CHECK =
  '\n' +
  '# Bypass: allow disabling all Clooks processing via environment variable.\n' +
  'if [ "${SKIP_CLOOKS:-}" = "true" ]; then\n' +
  '  exit 0\n' +
  'fi\n'

/** Persisted registration freshness, not proof that the native global hook will fire. */
const DEDUP_CHECK =
  '\n' +
  '# Global entrypoint dedup: if a global entrypoint is active, this project\n' +
  '# entrypoint is a noop for that same agent (the global one handles the merged pipeline).\n' +
  'CLOOKS_DEDUP_AGENT="${CLOOKS_AGENT:-claude-code}"\n' +
  'if [ "$CLOOKS_DEDUP_AGENT" = "claude-code" ] && [ -f "$HOME/.clooks/.global-entrypoint-active" ]; then\n' +
  '  exit 0\n' +
  'fi\n' +
  'clooks_codex_receipt_matches() {\n' +
  '  local receipt version home codex checksum extra physical_home physical_codex runtime_home actual\n' +
  '  case "${HOME:-}" in /*) ;; *) return 1 ;; esac\n' +
  "  case \"$HOME\" in *$'\\r'*|*$'\\n'*) return 1 ;; esac\n" +
  '  receipt="$HOME/.clooks/.global-entrypoint-active.codex"\n' +
  '  [ ! -L "$receipt" ] && [ -f "$receipt" ] && [ -r "$receipt" ] || return 1\n' +
  '  # Bash line reads ignore NUL bytes; reject them before parsing the wire format.\n' +
  '  if IFS= read -r -d "" extra < "$receipt"; then return 1; fi\n' +
  '  {\n' +
  '    IFS= read -r version && IFS= read -r home &&\n' +
  '      IFS= read -r codex && IFS= read -r checksum || return 1\n' +
  '    if IFS= read -r extra || [ -n "$extra" ]; then return 1; fi\n' +
  '  } < "$receipt" || return 1\n' +
  '  [ "$version" = "clooks-codex-registration-v1" ] || return 1\n' +
  '  case "$home" in /*) ;; *) return 1 ;; esac\n' +
  '  case "$codex" in /*) ;; *) return 1 ;; esac\n' +
  "  case \"$home$codex\" in *$'\\r'*|*$'\\n'*) return 1 ;; esac\n" +
  '  [[ "$checksum" =~ ^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$ ]] || return 1\n' +
  '  physical_home=$(cd -P -- "$HOME" && pwd -P) || return 1\n' +
  '  [ "$home" = "$physical_home" ] || return 1\n' +
  '  if [ "${CLOOKS_HOME_ROOT+x}" = x ]; then\n' +
  '    case "$CLOOKS_HOME_ROOT" in /*) ;; *) return 1 ;; esac\n' +
  "    case \"$CLOOKS_HOME_ROOT\" in *$'\\r'*|*$'\\n'*) return 1 ;; esac\n" +
  '    runtime_home=$(cd -P -- "$CLOOKS_HOME_ROOT" && pwd -P) || return 1\n' +
  '    [ "$runtime_home" = "$home" ] || return 1\n' +
  '  fi\n' +
  '  physical_codex="${CODEX_HOME:-$HOME/.codex}"\n' +
  '  case "$physical_codex" in /*) ;; *) return 1 ;; esac\n' +
  "  case \"$physical_codex\" in *$'\\r'*|*$'\\n'*) return 1 ;; esac\n" +
  '  physical_codex=$(cd -P -- "$physical_codex" && pwd -P) || return 1\n' +
  '  [ "$codex" = "$physical_codex" ] || return 1\n' +
  '  [ -f "$home/.clooks/bin/entrypoint.sh" ] && [ -x "$home/.clooks/bin/entrypoint.sh" ] || return 1\n' +
  '  [ ! -L "$codex/hooks.json" ] && [ -f "$codex/hooks.json" ] && [ -r "$codex/hooks.json" ] || return 1\n' +
  '  actual=$(cksum < "$codex/hooks.json") || return 1\n' +
  '  [[ "$actual" =~ ^(0|[1-9][0-9]*)[[:blank:]]+(0|[1-9][0-9]*)$ ]] || return 1\n' +
  '  [ "$checksum" = "${BASH_REMATCH[1]}:${BASH_REMATCH[2]}" ]\n' +
  '}\n' +
  'if [ "$CLOOKS_DEDUP_AGENT" = "codex" ] && clooks_codex_receipt_matches 2>/dev/null; then\n' +
  '  exit 0\n' +
  'fi\n' +
  'if [ "$CLOOKS_DEDUP_AGENT" != "codex" ] && [ -f "$HOME/.clooks/.global-entrypoint-active.$CLOOKS_DEDUP_AGENT" ]; then\n' +
  '  exit 0\n' +
  'fi\n'

const ENTRYPOINT_BODY =
  '\n' +
  '# Locate the Clooks binary on PATH.\n' +
  'CLOOKS_BIN=$(command -v clooks 2>/dev/null) || true\n' +
  '\n' +
  '# Bootstrap advisory: allow the action to proceed and print install guidance.\n' +
  '# A missing binary is a setup state, not a runtime failure — blocking here would\n' +
  '# deadlock /clooks:setup itself, which invokes the Bash tool that this hook guards.\n' +
  'if [ -z "$CLOOKS_BIN" ]; then\n' +
  "  cat >&2 <<'MSG'\n" +
  '[clooks] Binary not found. This project uses Clooks but it is not installed.\n' +
  'Install (Claude Code): run /clooks:setup\n' +
  'Install (manual):      https://github.com/codestripes-dev/clooks/releases/latest or check out https://clooks.cc\n' +
  'Bypass:                export SKIP_CLOOKS=true\n' +
  'MSG\n' +
  '  exit 0\n' +
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

export const ENTRYPOINT_SCRIPT =
  ENTRYPOINT_PREAMBLE + PROJECT_HEADER + SKIP_CLOOKS_CHECK + DEDUP_CHECK + ENTRYPOINT_BODY

/**
 * The global entrypoint must not suppress itself through the project's dedup check.
 */
export const GLOBAL_ENTRYPOINT_SCRIPT =
  ENTRYPOINT_PREAMBLE + GLOBAL_HEADER + SKIP_CLOOKS_CHECK + ENTRYPOINT_BODY
