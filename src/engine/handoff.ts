import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, open, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, sep } from 'node:path'
import type { EventName, HookName } from '../types/branded.js'
import type { ClooksConfig } from '../config/schema.js'
import type { HandoffSetting } from '../config/constants.js'
import { INJECTABLE_EVENTS } from '../config/constants.js'
import { CONTINUATION_EVENTS } from './events.js'
import type { EngineResult } from './types.js'
import type { InvocationResultPolicy } from '../agents/types.js'

/**
 * Backstop cap on handoff files in `.clooks/tmp/`. Content addressing collapses
 * repeated identical messages onto one file, so this only bounds accumulation
 * of many DISTINCT messages between SessionStart prunes.
 */
export const HANDOFF_MAX_FILES = 200

/** Age after which a handoff file (or leaked staging file) is pruned on SessionStart. */
export const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000

const HANDOFF_FILE_PATTERN = /^handoff-.*\.md$/
const HANDOFF_STAGING_PATTERN = /^\.handoff-.*\.tmp$/

/** Events whose `block` reason is delivered to the model rather than the human. */
const BLOCK_REASON_EVENTS: Set<EventName> = new Set<EventName>([
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
])

/**
 * Resolves the effective handoff policy for a hook+event pair via cascade:
 * hook+event → hook → global.
 */
export function resolveHandoff(
  hookName: HookName,
  eventName: EventName,
  config: ClooksConfig,
): HandoffSetting {
  const hookEntry = config.hooks[hookName]
  const hookEventOverride = hookEntry?.events?.[eventName]?.handoff
  if (hookEventOverride !== undefined) return hookEventOverride

  const hookLevel = hookEntry?.handoff
  if (hookLevel !== undefined) return hookLevel

  return config.global.handoff
}

/** `false` never hands off; `true` hands off any non-empty text; N hands off text longer than N. */
export function shouldHandoff(setting: HandoffSetting, text: string): boolean {
  if (setting === false) return false
  if (setting === true) return text.length > 0
  return text.length > setting
}

function sanitizeHookName(hookName: string): string {
  const filtered = hookName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
  return filtered.length > 0 ? filtered : 'hook'
}

function isStrictlyInside(parent: string, child: string): boolean {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

/**
 * Ensures `path` is a real directory, creating it if absent. A symlink or a
 * non-directory at that path is refused rather than followed — validating
 * before creating is what keeps a symlinked `.clooks` from getting a `tmp`
 * directory materialized at its external target.
 */
async function ensureRealDirectory(path: string, mode: number): Promise<void> {
  const existing = await lstat(path).catch(() => undefined)
  if (existing) {
    if (existing.isSymbolicLink()) {
      throw new Error(`${path} is a symlink — refusing to write handoff files through it`)
    }
    if (!existing.isDirectory()) {
      throw new Error(`${path} exists and is not a directory`)
    }
    return
  }

  try {
    await mkdir(path, { mode })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    // Lost a creation race — re-validate, since the winner may have made a symlink.
    const raced = await lstat(path)
    if (raced.isSymbolicLink() || !raced.isDirectory()) {
      throw new Error(`${path} is not a directory — refusing to write handoff files there`, {
        cause: e,
      })
    }
  }
}

/**
 * Creates `<projectRoot>/.clooks/tmp` if needed and returns its resolved path.
 * `.clooks` is left at the default directory mode because config tooling shares
 * it; only `tmp` is 0700.
 */
async function ensureHandoffDirectory(projectRoot: string): Promise<string> {
  const clooksDir = join(projectRoot, '.clooks')
  await ensureRealDirectory(clooksDir, 0o755)

  const dir = join(clooksDir, 'tmp')
  await ensureRealDirectory(dir, 0o700)

  // Backstop: the per-component checks above cannot see a symlink higher up
  // (a symlinked projectRoot, say), and realpath collapses the whole chain.
  const resolvedRoot = await realpath(projectRoot)
  const resolvedDir = await realpath(dir)
  if (!isStrictlyInside(resolvedRoot, resolvedDir)) {
    throw new Error(
      `handoff directory ${resolvedDir} resolves outside the project root ${resolvedRoot}`,
    )
  }
  return resolvedDir
}

/**
 * Creates `.clooks/tmp/.gitignore` containing `*` if absent. Exclusive create
 * means an existing file — or a symlink planted at that path — is left alone.
 */
async function ensureGitignore(dir: string): Promise<void> {
  try {
    await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx', mode: 0o600 })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
}

/** Deletes oldest-by-mtime handoff files so the post-write count stays at the cap. */
async function enforceFileCap(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  const candidates = entries.filter((e) => e.isFile() && HANDOFF_FILE_PATTERN.test(e.name))
  if (candidates.length < HANDOFF_MAX_FILES) return

  const aged: { path: string; mtimeMs: number }[] = []
  for (const entry of candidates) {
    const path = join(dir, entry.name)
    try {
      const st = await lstat(path)
      if (!st.isFile()) continue
      aged.push({ path, mtimeMs: st.mtimeMs })
    } catch {
      // Raced away by a concurrent writer's prune — nothing to delete.
    }
  }
  aged.sort((a, b) => a.mtimeMs - b.mtimeMs)

  const excess = aged.length - (HANDOFF_MAX_FILES - 1)
  for (let i = 0; i < excess; i++) {
    try {
      await unlink(aged[i]!.path)
    } catch {
      // Concurrent deletion — the cap is advisory, not transactional.
    }
  }
}

/**
 * What is currently sitting at the content-addressed path.
 * `reused` means the existing file was accepted as-is (and refreshed).
 */
type TargetState = 'reused' | 'stale-regular-file' | 'absent-or-foreign'

/**
 * Inspects the target through a single no-follow file descriptor and, when it
 * already holds exactly `text`, refreshes it in place. Every operation goes
 * through the fd rather than the path, so a symlink swapped in after the open
 * cannot redirect the read, the chmod, or the mtime bump.
 */
async function inspectTarget(target: string, text: string): Promise<TargetState> {
  let handle
  try {
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    // ENOENT (absent), ELOOP (symlink), ENOTDIR, EACCES — all mean "replace it".
    return 'absent-or-foreign'
  }

  try {
    const st = await handle.stat()
    if (!st.isFile()) return 'absent-or-foreign'

    let existing: string
    try {
      existing = await handle.readFile('utf8')
    } catch {
      return 'stale-regular-file'
    }
    if (existing !== text) return 'stale-regular-file'

    if ((st.mode & 0o777) !== 0o600) {
      await handle.chmod(0o600)
    }
    const now = new Date()
    try {
      await handle.utimes(now, now)
    } catch {
      // Best-effort liveness signal for pruning; reuse is still correct without it.
    }
    return 'reused'
  } finally {
    await handle.close().catch(() => {})
  }
}

/**
 * Writes `text` through a private staging file and atomically renames it onto
 * `target`, replacing whatever is there — including a symlink, which `rename`
 * unlinks rather than follows.
 */
async function writeViaStaging(dir: string, target: string, text: string): Promise<void> {
  let collision: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    const staging = join(dir, `.handoff-${process.pid}-${randomBytes(8).toString('hex')}.tmp`)
    try {
      await writeFile(staging, text, { flag: 'wx', mode: 0o600 })
    } catch (e) {
      // EEXIST means the name belongs to another writer — retry with fresh
      // randomness and leave their file alone. Any other failure may have left
      // a partial file of ours behind.
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        collision = e
        continue
      }
      await unlink(staging).catch(() => {})
      throw e
    }
    try {
      await rename(staging, target)
      return
    } catch (e) {
      await unlink(staging).catch(() => {})
      throw e
    }
  }
  throw collision
}

/**
 * Writes `text` to a content-addressed file under `<projectRoot>/.clooks/tmp/`
 * and returns its absolute path. Identical text in an existing regular file is
 * reused (mtime refreshed); anything else at that path — stale content, a
 * symlink, a directory — is atomically replaced. Throws if the directory
 * resolves outside the project root.
 */
export async function writeHandoffFile(
  projectRoot: string,
  hookName: HookName,
  text: string,
): Promise<string> {
  const resolvedDir = await ensureHandoffDirectory(projectRoot)
  await ensureGitignore(resolvedDir)

  const digest = createHash('sha256').update(text).digest('hex').slice(0, 12)
  const target = join(resolvedDir, `handoff-${sanitizeHookName(hookName)}-${digest}.md`)

  const state = await inspectTarget(target, text)
  if (state === 'reused') return target

  // A stale regular file already counts toward the cap, so replacing it does not
  // grow the directory. Evicting an unrelated pointer's target is only acceptable
  // when this write genuinely adds a file.
  if (state === 'absent-or-foreign') {
    await enforceFileCap(resolvedDir)
  }

  await writeViaStaging(resolvedDir, target, text)
  return target
}

/** The single source of truth for the pointer sentence delivered in place of the payload. */
export function buildPointer(hookName: HookName, absPath: string): string {
  return `[clooks] Hook "${hookName}": read ${absPath} and follow its instructions.`
}

/**
 * Replaces eligible model-facing payloads on a single hook's result with file
 * pointers. Each payload is measured and written independently. A write failure
 * is fail-safe: the original text stays inline, a warning goes to stderr, and
 * the result's decision is never altered.
 */
export async function applyHandoff(
  result: EngineResult,
  hookName: HookName,
  eventName: EventName,
  config: ClooksConfig,
  handoffRoot: string,
  delivery?: InvocationResultPolicy['handoff'],
  onInlineFallback?: (message: string) => void,
): Promise<EngineResult> {
  const setting = resolveHandoff(hookName, eventName, config)
  if (setting === false) return result

  const fields: ('injectContext' | 'reason' | 'feedback')[] = []
  if (INJECTABLE_EVENTS.has(eventName)) fields.push('injectContext')
  if (result.result === 'block' && BLOCK_REASON_EVENTS.has(eventName)) fields.push('reason')
  if (result.result === 'continue' && CONTINUATION_EVENTS.has(eventName)) fields.push('feedback')
  if (fields.length === 0) return result

  const transformed: EngineResult = { ...result }
  for (const field of fields) {
    const text = transformed[field]
    if (typeof text !== 'string' || !shouldHandoff(setting, text)) continue
    if (delivery && !delivery.isEligible(field)) {
      onInlineFallback?.(delivery.inlineDiagnostic)
      continue
    }
    try {
      const absPath = await writeHandoffFile(handoffRoot, hookName, text)
      transformed[field] = buildPointer(hookName, absPath)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      process.stderr.write(
        `clooks: warning: handoff write failed for hook "${hookName}" (${message}): delivering inline\n`,
      )
    }
  }

  return transformed
}

/**
 * Deletes stale handoff files and leaked staging files from `<projectRoot>/.clooks/tmp/`.
 * Runs on every `SessionStart` regardless of whether any hook matches. Only regular
 * files matching the handoff or staging patterns are ever touched — never symlinks or
 * directories. A missing directory is a silent no-op; per-file failures are swallowed,
 * and a whole-prune failure produces at most one stderr warning.
 */
export async function pruneHandoffFiles(projectRoot: string): Promise<void> {
  const dir = join(projectRoot, '.clooks', 'tmp')

  // Containment first: without it, a symlinked `.clooks` or `tmp` would make the
  // deletion loop below unlink matching files anywhere on the filesystem.
  let resolvedDir: string
  try {
    resolvedDir = await realpath(dir)
    const resolvedRoot = await realpath(projectRoot)
    if (!isStrictlyInside(resolvedRoot, resolvedDir)) {
      process.stderr.write(
        `clooks: warning: handoff prune skipped — ${dir} resolves outside the project root\n`,
      )
      return
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
    const message = e instanceof Error ? e.message : String(e)
    process.stderr.write(`clooks: warning: handoff prune failed (${message})\n`)
    return
  }

  let entries: Dirent[]
  try {
    entries = await readdir(resolvedDir, { withFileTypes: true })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
    const message = e instanceof Error ? e.message : String(e)
    process.stderr.write(`clooks: warning: handoff prune failed (${message})\n`)
    return
  }

  const now = Date.now()
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!HANDOFF_FILE_PATTERN.test(entry.name) && !HANDOFF_STAGING_PATTERN.test(entry.name)) {
      continue
    }
    const path = join(resolvedDir, entry.name)
    try {
      const st = await lstat(path)
      if (!st.isFile()) continue
      if (now - st.mtimeMs > HANDOFF_TTL_MS) {
        await unlink(path)
      }
    } catch {
      // Best-effort: a raced-away file, permission hiccup, or symlink swap is not fatal.
    }
  }
}
