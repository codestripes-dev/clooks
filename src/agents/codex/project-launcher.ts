import { randomBytes } from 'crypto'
import { lstatSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { APPROVAL_SUPPRESSION_FUNCTION } from '../../registration-approvals.js'

export const CODEX_PROJECT_MARKER = '.clooks/bin/codex-project-id'
export const CODEX_PROJECT_ID_PATTERN = /^[a-f0-9]{32}$/

export function ensureCodexProjectId(projectRoot: string): { id: string; created: boolean } {
  const path = join(projectRoot, CODEX_PROJECT_MARKER)
  const existing = lstatSync(path, { throwIfNoEntry: false })
  if (existing) {
    if (!existing.isFile()) throw new Error(`${path}: expected a regular project ID file`)
    const content = readFileSync(path, 'utf8')
    if (!/^[a-f0-9]{32}\n$/.test(content)) throw new Error(`${path}: invalid project ID`)
    return { id: content.slice(0, -1), created: false }
  }
  const id = randomBytes(16).toString('hex')
  writeFileSync(path, id + '\n', { flag: 'wx' })
  return { id, created: true }
}

const PROJECT_LOCATOR = `d=$(pwd -P) || exit 2
git_root=$(git rev-parse --show-toplevel 2>/dev/null < /dev/null) || git_root=
home=$(CDPATH= cd -P "\${HOME:-/}" 2>/dev/null && pwd -P) || home=
boundary=/
if [ -n "$git_root" ]; then
  case "$d/" in "\${git_root%/}/"*) boundary=$git_root ;; *) git_root= ;; esac
fi
if [ -z "$git_root" ] && [ -n "$home" ]; then
  case "$d/" in "\${home%/}/"*) boundary=$home ;; esac
fi
found=
while :; do
  marker="$d/.clooks/bin/codex-project-id"
  if [ -f "$marker" ] && [ ! -L "$marker" ] && printf '%s\\n' "$1" | cmp -s - "$marker"; then
    if [ -n "$found" ]; then
      printf '%s\\n' '[clooks] Ambiguous Codex project registration ID in ancestor directories. Use distinct project registrations.' >&2
      exit 2
    fi
    found=$d
  fi
  [ "$d" != / ] && [ "$d" != "$boundary" ] || break
  if [ -z "$git_root" ] && [ -e "$d/.git" ]; then break; fi
  d=\${d%/*}
  [ -n "$d" ] || d=/
done
if [ -z "$found" ]; then
  printf '%s\\n' '[clooks] Codex project registration ID not found within the project boundary. Run clooks init --agent codex in the intended project.' >&2
  exit 2
fi
entrypoint="$found/.clooks/bin/entrypoint.sh"
if [ ! -f "$entrypoint" ] || [ ! -r "$entrypoint" ]; then
  printf '[clooks] Project entrypoint missing or unreadable: %s\\n' "$entrypoint" >&2
  exit 2
fi
if [ -z "\${CLOOKS_PROJECT_ROOT:-}" ]; then
  CLOOKS_PROJECT_ROOT=$found
  export CLOOKS_PROJECT_ROOT
fi
exec bash "$entrypoint"`

export const CODEX_PROJECT_LAUNCHER = `if [ "\${SKIP_CLOOKS:-}" = true ]; then exit 0; fi\n${PROJECT_LOCATOR}`
export const CODEX_PAIRED_PROJECT_LAUNCHER = `${APPROVAL_SUPPRESSION_FUNCTION}if [ "\${SKIP_CLOOKS:-}" = true ]; then clooks_suppress; fi\n${PROJECT_LOCATOR}`

export const CODEX_PROJECT_RUNTIME_ADVISORY_LAUNCHER = `d=$(pwd -P) || exit 0
git_root=$(git rev-parse --show-toplevel 2>/dev/null < /dev/null) || git_root=
home=$(CDPATH= cd -P "\${HOME:-/}" 2>/dev/null && pwd -P) || home=
boundary=/
if [ -n "$git_root" ]; then
  case "$d/" in "\${git_root%/}/"*) boundary=$git_root ;; *) git_root= ;; esac
fi
if [ -z "$git_root" ] && [ -n "$home" ]; then
  case "$d/" in "\${home%/}/"*) boundary=$home ;; esac
fi
found=
while :; do
  marker="$d/.clooks/bin/codex-project-id"
  if [ -f "$marker" ] && [ ! -L "$marker" ] && printf '%s\\n' "$1" | cmp -s - "$marker"; then
    [ -z "$found" ] || exit 0
    found=$d
  fi
  [ "$d" != / ] && [ "$d" != "$boundary" ] || break
  if [ -z "$git_root" ] && [ -e "$d/.git" ]; then break; fi
  d=\${d%/*}
  [ -n "$d" ] || d=/
done
[ -n "$found" ] || exit 0
advisory="$found/.clooks/bin/runtime-advisory.sh"
[ -f "$advisory" ] && [ -r "$advisory" ] || exit 0
exec bash "$advisory"`
