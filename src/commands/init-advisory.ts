import { valid } from 'semver'
import { MIN_RUNTIME_VERSION } from '../installation-metadata.js'

export type RuntimeAdvisoryScope = 'project' | 'global'

export const RUNTIME_ADVISORY_RELATIVE_PATH = '.clooks/bin/runtime-advisory.sh'

const header = (scope: RuntimeAdvisoryScope) => `# clooks runtime advisory: ${scope}`

export function renderRuntimeAdvisoryScript(
  scope: RuntimeAdvisoryScope,
  minimumRuntime = MIN_RUNTIME_VERSION,
): string {
  if (scope !== 'project' && scope !== 'global') throw new Error('Invalid runtime advisory scope.')
  // semver.valid accepts a leading v and drops build metadata. Validate the
  // literal's grammar separately instead of comparing its normalized value.
  const canonical =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/
  if (
    minimumRuntime.trim() !== minimumRuntime ||
    !canonical.test(minimumRuntime) ||
    valid(minimumRuntime) === null
  )
    throw new Error('Minimum runtime must be canonical SemVer.')
  const subject = scope === 'project' ? 'This project' : 'This global installation'
  return `#!/usr/bin/env bash
set -euo pipefail

${header(scope)}
CLOOKS_REQUIRED_RUNTIME='${minimumRuntime}'

cat >/dev/null 2>&1 || true
[ "\${SKIP_CLOOKS:-}" != true ] || exit 0

component_less() {
  local left="$1" right="$2" LC_ALL=C
  [ "\${#left}" -lt "\${#right}" ] && return 0
  [ "\${#left}" -gt "\${#right}" ] && return 1
  [[ "$left" < "$right" ]]
}
core_less() {
  local left="$1" right="$2" left_part right_part
  while :; do
    left_part="\${left%%.*}"; right_part="\${right%%.*}"
    component_less "$left_part" "$right_part" && return 0
    component_less "$right_part" "$left_part" && return 1
    [ "$left" = "$left_part" ] && return 1
    left="\${left#*.}"; right="\${right#*.}"
  done
}
valid_prerelease() {
  local value="$1" identifier
  while :; do
    identifier="\${value%%.*}"
    if [[ "$identifier" =~ ^[0-9]+$ ]] && [ "\${#identifier}" -gt 1 ] && [ "\${identifier#0}" != "$identifier" ]; then return 1; fi
    [ "$value" = "$identifier" ] && return 0
    value="\${value#*.}"
  done
}
semver_body='(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?'
semver_pattern="^\${semver_body}$"
valid_semver() {
  local version="$1" without_build
  [[ "$version" =~ $semver_pattern ]] || return 1
  without_build="\${version%%+*}"
  [ "$without_build" = "\${without_build#*-}" ] || valid_prerelease "\${without_build#*-}"
}
prerelease_less() {
  local left="$1" right="$2" left_id right_id left_numeric right_numeric LC_ALL=C
  while :; do
    left_id="\${left%%.*}"; right_id="\${right%%.*}"; left_numeric=false; right_numeric=false
    [[ "$left_id" =~ ^[0-9]+$ ]] && left_numeric=true
    [[ "$right_id" =~ ^[0-9]+$ ]] && right_numeric=true
    if [ "$left_numeric" = true ] && [ "$right_numeric" = true ]; then
      component_less "$left_id" "$right_id" && return 0
      component_less "$right_id" "$left_id" && return 1
    elif [ "$left_numeric" = true ]; then return 0
    elif [ "$right_numeric" = true ]; then return 1
    elif [[ "$left_id" < "$right_id" ]]; then return 0
    elif [[ "$left_id" > "$right_id" ]]; then return 1
    fi
    [ "$left" = "$left_id" ] && [ "$right" = "$right_id" ] && return 1
    [ "$left" = "$left_id" ] && return 0
    [ "$right" = "$right_id" ] && return 1
    left="\${left#*.}"; right="\${right#*.}"
  done
}
semver_less() {
  local left="\${1%%+*}" right="\${2%%+*}" left_core right_core left_prerelease='' right_prerelease=''
  left_core="\${left%%-*}"; right_core="\${right%%-*}"
  core_less "$left_core" "$right_core" && return 0
  core_less "$right_core" "$left_core" && return 1
  [ "$left" = "$left_core" ] || left_prerelease="\${left#*-}"
  [ "$right" = "$right_core" ] || right_prerelease="\${right#*-}"
  [ -n "$left_prerelease" ] || return 1
  [ -n "$right_prerelease" ] || return 0
  prerelease_less "$left_prerelease" "$right_prerelease"
}

CLOOKS_BIN=$(command -v clooks 2>/dev/null) || exit 0
probe=$("$CLOOKS_BIN" --version </dev/null 2>/dev/null) || exit 0
version_pattern="^(clooks[[:blank:]]+)?v?(\${semver_body})$"
[[ "$probe" =~ $version_pattern ]] || exit 0
installed="\${BASH_REMATCH[2]}"
valid_semver "$installed" && valid_semver "$CLOOKS_REQUIRED_RUNTIME" || exit 0
semver_less "$installed" "$CLOOKS_REQUIRED_RUNTIME" || exit 0

setup='/clooks:setup update'
[ "\${CLOOKS_AGENT:-claude-code}" != codex ] || setup='$clooks:setup update'
message='[clooks] ${subject} requires Clooks '"$CLOOKS_REQUIRED_RUNTIME"' or newer; installed: '"$installed"'. Run '"$setup"', or update Clooks using its original installation method.'
context="$message Tell the user; do not update automatically."
printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\\n' "$message" "$context"
`
}

export const PROJECT_RUNTIME_ADVISORY_SCRIPT = renderRuntimeAdvisoryScript('project')
export const GLOBAL_RUNTIME_ADVISORY_SCRIPT = renderRuntimeAdvisoryScript('global')
