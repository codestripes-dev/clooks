// Per-hook turn state: what this hook already did during the current turn.
//
// The first half of this file is pure — scope keys, the intervention
// predicate, materialization, and state transforms. The second half is the
// storage layer: one JSON document per session under the home root, guarded by
// an owned lockfile and written through a staging file plus atomic rename.
//
// The filesystem hardening patterns below (per-component lstat validation,
// realpath containment, single no-follow descriptor for every read, staging +
// rename) are copied from `src/engine/handoff.ts`, which is where they were
// written and security-reviewed. The duplication is deliberate: handoff's
// containment is written against a project root with project-root-specific
// failure semantics, and extracting a shared helper would mean editing
// hardened code to serve a caller whose requirements are not yet proven
// identical. See the Decision Log in the turn-state ExecPlan.

import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import type { Dirent } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { isPlainObject } from 'lodash-es'
import { CLAUDE_CODE_EVENTS } from '../config/constants.js'
import type { EventName, HookName } from '../types/branded.js'
import type { TurnContext, TurnDecision, TurnRecord } from '../types/turn.js'
import type { AgentId } from '../agents/types.js'

/** Bumped when the on-disk format changes. An unrecognized version is treated as corrupt. */
export const TURN_STATE_VERSION = 1

/** On-disk shape: scope key → hook name → that hook's records this turn. */
export interface TurnState {
  version: number
  /**
   * Random per-lifetime identifier, reminted whenever a fresh document is
   * created — including when an unreadable or invalid one is replaced. The
   * generation counter alone cannot survive that: a corrupt read collapses to
   * generation 0, so a boundary would write generation 1 and an ancient
   * tracker still holding generation 1 would compare equal and resurrect its
   * records. Comparing the epoch as well makes that impossible regardless of
   * what the counters happen to be.
   */
  epoch: string
  /** Monotonic within one epoch. Incremented at every destructive turn boundary. */
  generation: number
  updatedAt: string
  scopes: Record<string, Record<string, TurnRecord[]>>
}

/**
 * What a snapshot must carry to prove, at commit time, that the turn it was
 * read from is still the turn being written to. Both halves must match.
 */
export interface TurnStamp {
  epoch: string
  generation: number
}

export function turnStampOf(state: TurnState): TurnStamp {
  return { epoch: state.epoch, generation: state.generation }
}

export function turnStampsEqual(a: TurnStamp, b: TurnStamp): boolean {
  return a.epoch === b.epoch && a.generation === b.generation
}

/** A fresh epoch. 8 random bytes: this is a comparison token, not a secret. */
export function newTurnEpoch(): string {
  return randomBytes(8).toString('hex')
}

/**
 * Dictionaries in this module are keyed by hook names (user configuration) and
 * scope keys (agent payloads). Both are attacker-influenced strings, and a hook
 * named `constructor` or `toString` against an ordinary object literal reads
 * back an inherited function instead of `undefined` — which then either throws
 * on spread or silently corrupts the document. Every dynamic map is therefore
 * null-prototype, and every dynamic lookup goes through `ownValue`.
 */
function emptyDict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

function ownValue<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  if (map === undefined || !Object.hasOwn(map, key)) return undefined
  return map[key]
}

/** Copies own enumerable entries into a fresh null-prototype dictionary. */
function dictFrom<T>(
  source: Record<string, T> | undefined,
  extra: Record<string, T>,
): Record<string, T> {
  const next = emptyDict<T>()
  if (source) {
    for (const key of Object.keys(source)) next[key] = source[key]!
  }
  for (const key of Object.keys(extra)) next[key] = extra[key]!
  return next
}

/**
 * Runtime allowlist for `TurnDecision`. Declared as a `Record` keyed by the
 * type so the build fails if `ResultTag` ever gains a member without this list
 * being updated — there is no runtime enumeration of result tags to derive it
 * from, and adding one to `src/types/` would put a runtime value into the
 * hook-author type bundle.
 */
const TURN_DECISIONS: Record<TurnDecision, true> = {
  allow: true,
  ask: true,
  block: true,
  defer: true,
  skip: true,
  success: true,
  failure: true,
  continue: true,
  stop: true,
  retry: true,
  error: true,
}

/** Is this a decision the engine could legitimately have recorded? */
export function isTurnDecision(value: unknown): value is TurnDecision {
  return typeof value === 'string' && Object.hasOwn(TURN_DECISIONS, value)
}

function isKnownEvent(value: unknown): value is EventName {
  return typeof value === 'string' && CLAUDE_CODE_EVENTS.has(value as EventName)
}

/**
 * A record the engine is willing to surface to a hook. Anything else in the
 * file — a decision outside the union, an event name that is not one of the 22
 * — is dropped rather than handed to hook code that will switch on it.
 */
export function isValidTurnRecord(value: unknown): value is TurnRecord {
  if (!isPlainObject(value)) return false
  const record = value as Record<string, unknown>
  return (
    isKnownEvent(record.event) && isTurnDecision(record.decision) && typeof record.at === 'string'
  )
}

/** Events whose payloads carry no agent identifier, only team and teammate names. */
const TEAM_EVENTS: ReadonlySet<EventName> = new Set<EventName>([
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
])

/**
 * A fresh empty turn context. Always allocates — no shared singleton, because
 * a shared `prior` array would let one hook's push rewrite what a later hook
 * sees, and freezing it instead would throw inside third-party hook code.
 */
export function emptyTurn(): TurnContext {
  return { prior: [], priorRuns: 0, priorInterventions: 0 }
}

/**
 * A fresh empty state document, with a new epoch. Every caller that mints one
 * is by definition abandoning whatever was there before — a missing file, a
 * corrupt file, an oversized file — so no tracker holding a stamp from the
 * abandoned document may ever compare equal to it.
 */
export function emptyTurnState(): TurnState {
  return {
    version: TURN_STATE_VERSION,
    epoch: newTurnEpoch(),
    generation: 0,
    updatedAt: new Date(0).toISOString(),
    scopes: emptyDict(),
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Which partition of turn history this invocation belongs to. The main agent,
 * each subagent, and each teammate get their own, so a subagent's runs never
 * show up in the main agent's `ctx.turn`.
 *
 * Team events are encoded as a JSON tuple: team and teammate names are
 * free-form and may contain the delimiter a joined string would use, and an
 * absent name must not collide with a teammate literally named `unknown`.
 */
export function turnScopeKey(eventName: EventName, context: Record<string, unknown>): string {
  if (TEAM_EVENTS.has(eventName)) {
    return JSON.stringify([
      'team',
      stringOrNull(context.teamName),
      stringOrNull(context.teammateName),
    ])
  }
  const agentId = context.agentId
  if (typeof agentId === 'string' && agentId.length > 0) {
    return `agent:${agentId}`
  }
  return 'main'
}

/**
 * Did this decision actually intervene? Reads the raw decision the hook
 * returned, not what was ultimately delivered to anyone.
 */
export function isTurnIntervention(eventName: EventName, decision: TurnDecision): boolean {
  if (decision === 'block') return true
  if (decision === 'continue') return TEAM_EVENTS.has(eventName)
  if (decision === 'retry') return eventName === 'PermissionDenied'
  return false
}

/**
 * Map what a hook lifecycle returned to a recordable decision.
 *
 * Returning nothing — `undefined`, `null`, or anything that is not a result
 * object — is behaviorally identical to skipping, so it records as `skip`. A
 * result object carrying a tag outside the union is a different thing: the
 * hook returned something the engine does not understand, and recording it
 * verbatim would put an arbitrary string into a field hook authors switch on.
 * That records as `error`, which is what an unintelligible return is.
 */
export function decisionForResult(result: unknown): TurnDecision {
  if (!isPlainObject(result)) return 'skip'
  const tag = (result as { result?: unknown }).result
  if (tag === undefined || tag === null) return 'skip'
  return isTurnDecision(tag) ? tag : 'error'
}

/** Build the `ctx.turn` a single hook sees, from one scope's records. */
export function materializeTurn(
  scopeRecords: Record<string, TurnRecord[]> | undefined,
  hookName: HookName,
  eventName: EventName,
): TurnContext {
  const records = ownValue(scopeRecords, hookName)
  if (!Array.isArray(records) || records.length === 0) return emptyTurn()

  // Concurrent invocations commit independently, so append order is not time
  // order. Sort on read. Records that fail validation never reach hook code:
  // a hook switches on `decision`, so an unrecognized value is worse than a
  // missing record.
  const prior = records.filter(isValidTurnRecord).sort(compareByTimestamp)
  if (prior.length === 0) return emptyTurn()

  let priorRuns = 0
  let priorInterventions = 0
  for (const record of prior) {
    if (record.event !== eventName) continue
    priorRuns++
    if (isTurnIntervention(record.event, record.decision)) priorInterventions++
  }

  return { prior, priorRuns, priorInterventions }
}

function compareByTimestamp(a: TurnRecord, b: TurnRecord): number {
  const ta = Date.parse(a.at)
  const tb = Date.parse(b.at)
  if (Number.isNaN(ta) || Number.isNaN(tb)) {
    return a.at < b.at ? -1 : a.at > b.at ? 1 : 0
  }
  return ta - tb
}

/** Append one record, returning a new state. Never mutates its input. */
export function appendTurnRecord(
  state: TurnState,
  scopeKey: string,
  hookName: HookName,
  record: TurnRecord,
): TurnState {
  const scope = ownValue(state.scopes, scopeKey)
  const existing = ownValue(scope, hookName) ?? []
  return {
    ...state,
    scopes: dictFrom(state.scopes, {
      [scopeKey]: dictFrom(scope, { [hookName]: [...existing, record] }),
    }),
  }
}

/**
 * The next generation, or `null` when the counter cannot advance any further.
 * A counter that cannot advance is not a theoretical concern to wave away: at
 * `Number.MAX_SAFE_INTEGER`, `+ 1` returns a value that compares equal, so a
 * boundary would silently stop separating turns and every stale tracker would
 * match forever.
 */
function nextGeneration(current: number): number | null {
  if (!Number.isSafeInteger(current) || current < 0) return null
  const next = current + 1
  return Number.isSafeInteger(next) && next > current ? next : null
}

/**
 * End the turn: drop every scope's records and advance the generation. There
 * is deliberately no transform that clears records without advancing, because
 * an in-flight commit holding an equal stamp would write the cleared records
 * straight back.
 *
 * When the counter is exhausted the document is reborn under a fresh epoch,
 * which is a strictly stronger separation than any counter value.
 */
export function clearTurnScopes(state: TurnState): TurnState {
  const next = nextGeneration(state.generation)
  if (next === null) return emptyTurnState()
  return { ...state, generation: next, scopes: emptyDict() }
}

/** Advance the generation, keeping records. */
export function advanceTurnGeneration(state: TurnState): TurnState {
  const next = nextGeneration(state.generation)
  if (next === null) return emptyTurnState()
  return { ...state, generation: next }
}

function isRecordShape(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.event === 'string' &&
    typeof record.decision === 'string' &&
    typeof record.at === 'string'
  )
}

/**
 * Recursive validation of a parsed state document. Genuinely recursive on
 * purpose: a file whose top level looks right but whose per-hook value is a
 * string must be rejected, not indexed into.
 */
export function isTurnStateShape(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  const state = value as Record<string, unknown>
  if (typeof state.version !== 'number') return false
  if (typeof state.epoch !== 'string' || state.epoch.length === 0) return false
  // A generation that is negative, fractional, or beyond the safe-integer
  // range cannot be advanced monotonically, so it is not a usable document.
  if (!Number.isSafeInteger(state.generation) || (state.generation as number) < 0) return false
  if (typeof state.updatedAt !== 'string') return false
  if (!isPlainObject(state.scopes)) return false

  for (const scope of Object.values(state.scopes as Record<string, unknown>)) {
    if (!isPlainObject(scope)) return false
    for (const records of Object.values(scope as Record<string, unknown>)) {
      if (!Array.isArray(records)) return false
      for (const record of records) {
        if (!isRecordShape(record)) return false
      }
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Refuse to read or write a state document larger than this. */
export const TURN_STATE_MAX_BYTES = 1024 * 1024

/** At most this many records for one hook in one scope. Excess drops the NEW records. */
export const TURN_STATE_MAX_RECORDS_PER_HOOK = 200

/** Age after which a session file or a leaked staging file is pruned on SessionStart. */
export const TURN_STATE_TTL_MS = 24 * 60 * 60 * 1000

/** Backstop cap on session files, enforced oldest-first after the TTL sweep. */
export const TURN_STATE_MAX_FILES = 200

/**
 * Age after which a lockfile is considered abandoned and may be taken over.
 *
 * Deliberately generous, and aligned with `TURN_STATE_LOCK_TTL_MS`. The lock
 * guards a critical section of one read plus one write — a millisecond-scale
 * operation — so a live owner still inside it after a full minute is not a
 * scenario worth optimizing for, while a *crashed* owner's lock wedging writes
 * for up to a minute is a benign degrade: records are skipped, no decision
 * changes. A short threshold bought faster recovery from crashes at the price
 * of routinely stealing from live owners, which is the wrong trade.
 *
 * The threshold buys *rarity*, not safety. No fixed timeout can guarantee a
 * suspended-but-live owner is never taken over. What makes takeover safe is
 * the ownership token: the old owner re-verifies immediately before it renames
 * and immediately before it unlinks, and abandons on a mismatch.
 */
export const TURN_STATE_LOCK_STALE_MS = 60 * 1000

/** Age after which a leftover lockfile (or `.stale-*` takeover residue) is pruned. */
export const TURN_STATE_LOCK_TTL_MS = 60 * 1000

/** Total time an acquisition may spend waiting before giving up and skipping the write. */
export const TURN_STATE_LOCK_MAX_WAIT_MS = 200

const LOCK_BACKOFF_MS = [5, 10, 20, 40, 80]

/** Bound on acquisition loop iterations, so a pathological rename race cannot spin. */
const LOCK_MAX_ATTEMPTS = 32

/** A lockfile is a few dozen bytes; anything larger is not ours. */
const LOCK_MAX_BYTES = 4096

const SESSION_FILE_PATTERN = /^[0-9a-f]{16}\.json$/
const LOCK_FILE_PATTERN = /^[0-9a-f]{16}\.json\.lock(\.stale-[0-9a-f]+)?$/
const STAGING_FILE_PATTERN = /^[0-9a-f]{16}\.json\.\d+-[0-9a-f]+\.tmp$/

/** One buffered record waiting to be committed. */
export interface PendingTurnRecord {
  scopeKey: string
  hookName: HookName
  record: TurnRecord
}

/** Ceiling bookkeeping key. JSON-encoded because both halves are free-form. */
function pairKey(scopeKey: string, hookName: string): string {
  return JSON.stringify([scopeKey, hookName])
}

/**
 * One warning per process. A real invocation is one process, so this enforces
 * the "at most one warning per invocation" guarantee in a single place rather
 * than at every call site.
 */
let alreadyWarned = false

function warnOnce(message: string): void {
  if (alreadyWarned) return
  alreadyWarned = true
  process.stderr.write(`clooks: warning: ${message}\n`)
}

/**
 * Emit a turn-state warning, sharing the one-per-invocation budget with the
 * storage layer. Exported so the engine's recording call sites draw from the
 * same budget rather than opening a second one.
 */
export function warnTurnStateOnce(message: string): void {
  warnOnce(message)
}

/**
 * Test-only. The flag is per-process and never needs resetting in production,
 * but a test file exercising several failure paths in one process does.
 */
export function resetTurnStateWarnings(): void {
  alreadyWarned = false
}

function errorCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code
}

function isStrictlyInside(parent: string, child: string): boolean {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

function sleep(msec: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, msec))
}

/**
 * Where this session's state lives. The session id is hashed, never
 * interpolated: it is an externally supplied string, and hashing keeps it out
 * of every path, filename, and warning this module can emit.
 */
export function turnStatePath(
  homeRoot: string,
  sessionId: string,
  provider: AgentId = 'claude-code',
): string {
  const hash = createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
  return join(turnStateDirectory(homeRoot, provider), `${hash}.json`)
}

function turnStateDirectory(homeRoot: string, provider: AgentId): string {
  const base = join(homeRoot, '.clooks', 'turn-state')
  return provider === 'codex' ? join(base, provider) : base
}

function lockPathFor(statePath: string): string {
  return `${statePath}.lock`
}

/**
 * Reads a whole small file through a single no-follow descriptor: open, fstat
 * that descriptor for the size bound, read the body through the same handle.
 * Never a path-based stat-then-read — that follows symlinks and measures a
 * different thing than it reads. Pattern origin: `inspectTarget` in
 * `src/engine/handoff.ts`.
 */
async function readBounded(
  path: string,
  maxBytes: number,
): Promise<
  { ok: true; text: string } | { ok: false; reason: 'absent' | 'unusable' | 'too-large' }
> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (e) {
    // ELOOP means a symlink was planted at the path; ENOENT means fresh.
    return { ok: false, reason: errorCode(e) === 'ENOENT' ? 'absent' : 'unusable' }
  }
  try {
    const st = await handle.stat()
    if (!st.isFile()) return { ok: false, reason: 'unusable' }
    if (st.size > maxBytes) return { ok: false, reason: 'too-large' }
    return { ok: true, text: await handle.readFile('utf8') }
  } catch {
    return { ok: false, reason: 'unusable' }
  } finally {
    await handle.close().catch(() => {})
  }
}

/**
 * The stored state for one session, or a fresh empty document. Never throws:
 * every failure — missing, symlinked, oversized, corrupt, or of an
 * unrecognized version — degrades to empty state, because turn history is an
 * optimization signal and must never be able to wedge an invocation.
 */
export async function readTurnState(
  path: string,
  access?: { homeRoot: string; provider: AgentId },
): Promise<TurnState> {
  if (access?.provider === 'codex') {
    try {
      const dir = turnStateDirectory(access.homeRoot, access.provider)
      if (resolve(dirname(path)) !== resolve(dir)) {
        throw new Error('turn snapshot path is outside its provider directory')
      }
      await assertRealDirectory(join(access.homeRoot, '.clooks'))
      await assertRealDirectory(join(access.homeRoot, '.clooks', 'turn-state'))
      await assertRealDirectory(dir)
      const resolvedHome = await realpath(access.homeRoot)
      const resolvedDir = await realpath(dir)
      if (!isStrictlyInside(resolvedHome, resolvedDir)) {
        throw new Error('turn snapshot directory resolves outside the home root')
      }
      path = join(resolvedDir, basename(path))
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        warnOnce(
          `turn snapshot skipped (${error instanceof Error ? error.message : String(error)})`,
        )
      }
      return emptyTurnState()
    }
  }
  return (await loadTurnState(path)) ?? emptyTurnState()
}

/**
 * The stored document, or `null` when there is nothing usable on disk.
 *
 * The writers need this distinction and `readTurnState` cannot give it to
 * them: it mints a fresh epoch for every unusable document, so two calls
 * against the same missing file return two documents that do not compare
 * equal. A commit that treated "absent" as a stamp mismatch would discard the
 * first records of every new session.
 */
async function loadTurnState(path: string): Promise<TurnState | null> {
  const read = await readBounded(path, TURN_STATE_MAX_BYTES)
  if (!read.ok) {
    if (read.reason === 'too-large')
      warnOnce('turn state file exceeds the size bound — ignoring it')
    else if (read.reason === 'unusable') warnOnce('turn state file is unreadable — ignoring it')
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(read.text)
  } catch {
    warnOnce('turn state file is not valid JSON — starting from empty state')
    return null
  }

  // isTurnStateShape deliberately does not own the version policy, so the read
  // path checks it explicitly.
  if (!isTurnStateShape(parsed)) {
    warnOnce('turn state file has an unexpected shape — starting from empty state')
    return null
  }
  const state = parsed as TurnState
  if (state.version !== TURN_STATE_VERSION) {
    warnOnce('turn state file has an unrecognized version — starting from empty state')
    return null
  }
  return sanitizeTurnState(state)
}

/**
 * Rebuilds a parsed document into prototype-safe dictionaries and drops any
 * record whose decision or event is outside the known sets, so nothing
 * downstream — hook code included — ever sees a value it cannot switch on.
 * Individual bad records are dropped; they do not condemn the whole document,
 * because discarding a whole turn's history over one malformed entry is the
 * record loss the feature exists to prevent.
 */
function sanitizeTurnState(state: TurnState): TurnState {
  const scopes = emptyDict<Record<string, TurnRecord[]>>()
  for (const scopeKey of Object.keys(state.scopes)) {
    const scope = ownValue(state.scopes, scopeKey)
    if (scope === undefined) continue
    const hooks = emptyDict<TurnRecord[]>()
    for (const hookName of Object.keys(scope)) {
      const records = ownValue(scope, hookName)
      if (!Array.isArray(records)) continue
      hooks[hookName] = records.filter(isValidTurnRecord)
    }
    scopes[scopeKey] = hooks
  }
  return { ...state, scopes }
}

type LockProbe = { kind: 'held'; mtimeMs: number } | { kind: 'gone' } | { kind: 'unusable' }

async function probeLock(lockPath: string): Promise<LockProbe> {
  let handle
  try {
    handle = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (e) {
    if (errorCode(e) === 'ENOENT') return { kind: 'gone' }
    return { kind: 'unusable' }
  }
  try {
    const st = await handle.stat()
    if (!st.isFile()) return { kind: 'unusable' }
    return { kind: 'held', mtimeMs: st.mtimeMs }
  } catch {
    return { kind: 'unusable' }
  } finally {
    await handle.close().catch(() => {})
  }
}

/**
 * Takes the lock and returns the ownership token, or `null` when the bounded
 * wait ran out. Holding the lock is not a boolean: the token returned here must
 * be re-verified with `verifyTurnLock` before the commit rename and before the
 * release unlink.
 *
 * Stale-lock takeover is a `rename` of the stale pathname, never
 * unlink-then-create. `rename` on a specific pathname succeeds for exactly one
 * caller, so two contenders that both observed the same stale lock cannot both
 * proceed — the loser gets ENOENT and re-enters the wait loop.
 */
export async function acquireTurnLock(path: string): Promise<string | null> {
  const lockPath = lockPathFor(path)
  const deadline = Date.now() + TURN_STATE_LOCK_MAX_WAIT_MS
  let waitIndex = 0

  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    const token = randomBytes(16).toString('hex')
    try {
      await writeFile(
        lockPath,
        JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() }),
        { flag: 'wx', mode: 0o600 },
      )
      return token
    } catch (e) {
      if (errorCode(e) !== 'EEXIST') {
        warnOnce('turn state lock could not be created — skipping write')
        return null
      }
    }

    const probe = await probeLock(lockPath)
    if (probe.kind === 'unusable') {
      // A symlink or a directory at the lock path. Repairing it would mean
      // deleting something we did not create; refuse instead.
      warnOnce('turn state lock is not a regular file — skipping write')
      return null
    }

    if (probe.kind === 'held' && Date.now() - probe.mtimeMs <= TURN_STATE_LOCK_STALE_MS) {
      const remaining = deadline - Date.now()
      if (waitIndex >= LOCK_BACKOFF_MS.length || remaining <= 0) break
      // Clip to the remaining budget: an unclipped final sleep would overshoot
      // the advertised bound by most of its own duration.
      await sleep(Math.min(LOCK_BACKOFF_MS[waitIndex++]!, remaining))
      continue
    }

    if (probe.kind === 'held') {
      const aside = `${lockPath}.stale-${token}`
      try {
        await rename(lockPath, aside)
        await unlink(aside).catch(() => {})
      } catch {
        // ENOENT: another contender took it over first, or the owner released
        // it. Either way the next create attempt resolves who holds it.
      }
    }

    if (Date.now() >= deadline) break
  }

  warnOnce('turn state lock is busy — skipping write for this invocation')
  return null
}

/**
 * Is the lock still ours? Re-reads the lockfile through a fresh no-follow
 * descriptor and compares tokens. A missing lockfile, a replaced one, or a
 * different token all mean this process was taken over while it was paused and
 * must abandon rather than clobber the new holder's work.
 */
export async function verifyTurnLock(path: string, token: string): Promise<boolean> {
  const read = await readBounded(lockPathFor(path), LOCK_MAX_BYTES)
  if (!read.ok) return false
  try {
    const parsed = JSON.parse(read.text) as { token?: unknown }
    return parsed.token === token
  } catch {
    return false
  }
}

/**
 * Releases the lock, but only if it is still ours. There is an unavoidable
 * window between the check and the unlink; POSIX offers no compare-and-unlink,
 * and narrowing it is the best available. A mismatch is a no-op.
 */
export async function releaseTurnLock(path: string, token: string): Promise<void> {
  if (!(await verifyTurnLock(path, token))) {
    warnOnce('turn state lock was taken over — not releasing it')
    return
  }
  await unlink(lockPathFor(path)).catch(() => {})
}

/**
 * Refuses a path component that is a symlink or is not a directory, without
 * following it. Used both before creating anything and before pruning, so the
 * two paths apply the same discipline.
 */
async function assertRealDirectory(path: string): Promise<void> {
  const existing = await lstat(path)
  if (existing.isSymbolicLink()) {
    throw new Error('turn state directory component is a symlink — refusing to work through it')
  }
  if (!existing.isDirectory()) {
    throw new Error('turn state directory component exists and is not a directory')
  }
}

/**
 * Tightens an existing directory's mode through a no-follow directory
 * descriptor. Path-based `chmod` would follow a symlink swapped in after the
 * check; `fchmod` on a descriptor opened with `O_DIRECTORY | O_NOFOLLOW` acts
 * on the inode that was actually validated.
 */
async function enforceDirectoryMode(path: string, mode: number): Promise<void> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  } catch {
    return
  }
  try {
    const st = await handle.stat()
    if (!st.isDirectory()) return
    if ((st.mode & 0o777) !== mode) await handle.chmod(mode)
  } catch {
    // Best-effort tightening: a directory we cannot chmod is still usable, and
    // failing the write over it would be a worse outcome than a loose mode.
  } finally {
    await handle.close().catch(() => {})
  }
}

/**
 * Ensures `path` is a real directory, creating it if absent. A symlink or a
 * non-directory is refused rather than followed. Pattern origin:
 * `ensureRealDirectory` in `src/engine/handoff.ts`.
 *
 * `enforceMode` tightens a directory that already existed. It is applied to
 * the managed `turn-state` directory but deliberately not to `.clooks`, which
 * is shared with the configuration tooling and is not this subsystem's to
 * re-permission.
 */
async function ensureRealDirectory(path: string, mode: number, enforceMode = false): Promise<void> {
  const existing = await lstat(path).catch(() => undefined)
  if (existing) {
    await assertRealDirectory(path)
    if (enforceMode) await enforceDirectoryMode(path, mode)
    return
  }

  try {
    await mkdir(path, { mode })
  } catch (e) {
    if (errorCode(e) !== 'EEXIST') throw e
    // Lost a creation race — re-validate, since the winner may have made a symlink.
    const raced = await lstat(path)
    if (raced.isSymbolicLink() || !raced.isDirectory()) {
      throw new Error('turn state directory component is not a directory', { cause: e })
    }
    if (enforceMode) await enforceDirectoryMode(path, mode)
  }
}

async function ensureTurnStateDirectory(homeRoot: string, provider: AgentId): Promise<string> {
  await ensureRealDirectory(join(homeRoot, '.clooks'), 0o700)

  const base = join(homeRoot, '.clooks', 'turn-state')
  await ensureRealDirectory(base, 0o700, true)
  const dir = turnStateDirectory(homeRoot, provider)
  if (dir !== base) await ensureRealDirectory(dir, 0o700, true)

  // Backstop: per-component checks cannot see a symlink higher up the chain
  // (a symlinked home root, say), and realpath collapses the whole chain.
  const resolvedHome = await realpath(homeRoot)
  const resolvedDir = await realpath(dir)
  if (!isStrictlyInside(resolvedHome, resolvedDir)) {
    throw new Error('turn state directory resolves outside the home root')
  }
  return resolvedDir
}

/**
 * Writes `text` to a private staging file and returns its path. Staging and
 * publishing are separate steps so the caller can put its ownership check
 * immediately before the rename, with no filesystem work in between.
 *
 * An `EEXIST` collision means the name belongs to another writer: retry with
 * fresh randomness and leave their file alone. Unlinking it — which an earlier
 * revision did — deletes a file this process did not create. Pattern origin:
 * `writeViaStaging` in `src/engine/handoff.ts`.
 */
async function stageWrite(dir: string, target: string, text: string): Promise<string> {
  let collision: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    const staging = join(
      dir,
      `${basename(target)}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`,
    )
    try {
      await writeFile(staging, text, { flag: 'wx', mode: 0o600 })
      return staging
    } catch (e) {
      if (errorCode(e) === 'EEXIST') {
        collision = e
        continue
      }
      // Any other failure may have left a partial file of ours behind.
      await unlink(staging).catch(() => {})
      throw e
    }
  }
  throw collision
}

/** Publishes a staged file onto the target, removing the staging file on failure. */
async function publishStaging(staging: string, target: string): Promise<void> {
  try {
    await rename(staging, target)
  } catch (e) {
    await unlink(staging).catch(() => {})
    throw e
  }
}

/**
 * Applies pending records under both growth ceilings. Both drop the *new*
 * record and never an existing one, because the feature forbids any truncation
 * that could erase the single earlier intervention a dedup hook depends on.
 *
 * A `null` state means nothing survived the ceilings and there is nothing to write.
 */
function boundedAppend(
  base: TurnState,
  pending: PendingTurnRecord[],
): { state: TurnState | null; dropped: boolean } {
  let dropped = false

  // Per-(scope, hook) ceiling. Not a global one: a global cap would let one
  // hammering hook consume the budget and prevent an unrelated hook from
  // recording its first intervention.
  const counts = new Map<string, number>()
  const accepted: PendingTurnRecord[] = []
  for (const item of pending) {
    const key = pairKey(item.scopeKey, item.hookName)
    const existing =
      counts.get(key) ?? ownValue(ownValue(base.scopes, item.scopeKey), item.hookName)?.length ?? 0
    if (existing >= TURN_STATE_MAX_RECORDS_PER_HOOK) {
      dropped = true
      continue
    }
    counts.set(key, existing + 1)
    accepted.push(item)
  }

  // Serialized byte ceiling. Hook names come from user configuration and scope
  // keys from agent payloads — both unbounded strings — so a document can
  // exceed the read bound long before any record count does, and a document
  // that exceeds the read bound is silently unreadable on the next invocation.
  //
  // Each entry is judged on its own. Dropping a tail until the whole batch fits
  // would let one oversized record starve every legitimate record behind it,
  // which is the same noisy-neighbor failure the per-hook ceiling exists to
  // prevent.
  let candidate = base
  let changed = false
  for (const item of accepted) {
    const next = appendTurnRecord(candidate, item.scopeKey, item.hookName, item.record)
    if (Buffer.byteLength(JSON.stringify(next), 'utf8') > TURN_STATE_MAX_BYTES) {
      dropped = true
      continue
    }
    candidate = next
    changed = true
  }

  return { state: changed ? candidate : null, dropped }
}

/**
 * Merges `pending` into the stored document under the lock. Never throws.
 *
 * `captured` is the stamp — epoch plus generation — the caller's snapshot was
 * read at. If either half has moved on, the turn these records belong to has
 * ended and they are discarded wholesale; keeping them would resurrect a
 * finished turn's history into the current one.
 */
export async function commitTurnRecords(
  path: string,
  homeRoot: string,
  captured: TurnStamp,
  pending: PendingTurnRecord[],
  provider: AgentId = 'claude-code',
): Promise<void> {
  if (pending.length === 0) return

  let dir: string
  try {
    dir = await ensureTurnStateDirectory(homeRoot, provider)
  } catch (e) {
    warnOnce(`turn state write skipped (${e instanceof Error ? e.message : String(e)})`)
    return
  }

  // Everything below addresses the resolved directory rather than the caller's
  // path, so the write and the lock cannot land outside the verified directory.
  const target = join(dir, basename(path))
  const token = await acquireTurnLock(target)
  if (token === null) return

  try {
    const current = await loadTurnState(target)

    // Nothing usable on disk means there is no boundary this commit could have
    // straddled and no history to resurrect, so the caller's stamp is adopted
    // rather than compared. Comparing would be wrong as well as useless: a
    // synthesized empty document carries a fresh epoch every time, so a new
    // session's first commit would always be discarded.
    if (current !== null && !turnStampsEqual(turnStampOf(current), captured)) return

    const base: TurnState = {
      ...(current ?? emptyTurnState()),
      version: TURN_STATE_VERSION,
      epoch: current?.epoch ?? captured.epoch,
      generation: current?.generation ?? captured.generation,
      updatedAt: new Date().toISOString(),
    }
    const { state, dropped } = boundedAppend(base, pending)
    if (dropped) warnOnce('turn state growth ceiling reached — dropping new records')
    if (state === null) return

    // Stage first, verify last: the ownership check has to be the operation
    // immediately before the rename, with no filesystem work in between, or
    // the window between "still ours" and "published" is as wide as the write.
    const staging = await stageWrite(dir, target, JSON.stringify(state))
    if (!(await verifyTurnLock(target, token))) {
      warnOnce('turn state lock was taken over mid-write — abandoning this commit')
      await unlink(staging).catch(() => {})
      return
    }
    await publishStaging(staging, target)
  } catch (e) {
    warnOnce(`turn state write failed (${e instanceof Error ? e.message : String(e)})`)
  } finally {
    await releaseTurnLock(target, token).catch(() => {})
  }
}

/**
 * Ends the current turn under the lock and returns the post-boundary state so
 * the caller can use it as its snapshot without reading the file again.
 *
 * Both kinds clear every scope and advance the generation. The generation is
 * monotonic and never returns to a default: an in-flight commit holding an
 * equal generation would otherwise write its pre-boundary records straight back
 * into the freshly cleared state. `kind` exists to distinguish the
 * `UserPromptSubmit` advance from the `SessionStart` reset for logging and for
 * future divergence.
 *
 * On any failure the on-disk state is returned unchanged, which means a
 * finished turn keeps looking live — the documented failure direction.
 */
export async function applyTurnBoundary(
  path: string,
  homeRoot: string,
  kind: 'advance' | 'reset',
  provider: AgentId = 'claude-code',
): Promise<TurnState> {
  // `kind` is intentionally not branched on yet — both boundaries behave
  // identically today; the parameter records the caller's intent.
  void kind

  let dir: string
  try {
    dir = await ensureTurnStateDirectory(homeRoot, provider)
  } catch (e) {
    warnOnce(`turn boundary skipped (${e instanceof Error ? e.message : String(e)})`)
    return emptyTurnState()
  }

  const target = join(dir, basename(path))
  const token = await acquireTurnLock(target)
  if (token === null) return readTurnState(target)

  let current = emptyTurnState()
  try {
    current = (await loadTurnState(target)) ?? emptyTurnState()
    const next: TurnState = {
      ...clearTurnScopes(current),
      version: TURN_STATE_VERSION,
      updatedAt: new Date().toISOString(),
    }

    const staging = await stageWrite(dir, target, JSON.stringify(next))
    if (!(await verifyTurnLock(target, token))) {
      warnOnce('turn state lock was taken over mid-write — abandoning this boundary')
      await unlink(staging).catch(() => {})
      return current
    }
    await publishStaging(staging, target)
    return next
  } catch (e) {
    warnOnce(`turn boundary failed (${e instanceof Error ? e.message : String(e)})`)
    return current
  } finally {
    await releaseTurnLock(target, token).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

/**
 * The engine's handle on turn state for one invocation. It owns the snapshot,
 * the scope key, the captured stamp, and the pending records, so `execute.ts`
 * never touches a raw state document.
 */
export interface TurnTracker {
  materialize(hookName: HookName, eventName: EventName): TurnContext
  record(hookName: HookName, eventName: EventName, decision: TurnDecision): void
  commit(): Promise<void>
}

/**
 * Builds the tracker for one invocation from a snapshot read once, before any
 * hook runs. Every hook in the invocation materializes against that same
 * snapshot: letting an earlier hook's record show up in a later hook's history
 * would behave differently in parallel groups, where completion order is
 * nondeterministic.
 *
 * Nothing here throws. Recording sits on the engine's hook-execution path, and
 * a bookkeeping failure must never change what a hook decided or whether the
 * next one runs.
 */
export function createTurnTracker(input: {
  path: string
  homeRoot: string
  state: TurnState
  scopeKey: string
  provider?: AgentId
}): TurnTracker {
  const captured = turnStampOf(input.state)
  const scopeRecords = ownValue(input.state.scopes, input.scopeKey)
  const pending: PendingTurnRecord[] = []

  return {
    materialize(hookName, eventName) {
      try {
        return materializeTurn(scopeRecords, hookName, eventName)
      } catch {
        return emptyTurn()
      }
    },

    record(hookName, eventName, decision) {
      try {
        pending.push({
          scopeKey: input.scopeKey,
          hookName,
          record: { event: eventName, decision, at: new Date().toISOString() },
        })
      } catch {
        // Buffering is best-effort; a lost record degrades to a missing prior
        // run, which is the same outcome as a failed read.
      }
    },

    /**
     * Buffered records are written exactly once, under a single lock
     * acquisition. Committing per hook would multiply contention on precisely
     * the workload that motivates the lock — parallel tool calls producing
     * overlapping clooks processes.
     */
    async commit() {
      if (pending.length === 0) return
      const batch = pending.splice(0)
      try {
        await commitTurnRecords(input.path, input.homeRoot, captured, batch, input.provider)
      } catch {
        // commitTurnRecords already swallows its own failures; this is the
        // belt to its braces, because the caller is on the engine's return path.
      }
    },
  }
}

type PruneKind = 'session' | 'lock' | 'staging'

function classifyTurnStateFile(name: string): PruneKind | null {
  if (SESSION_FILE_PATTERN.test(name)) return 'session'
  if (LOCK_FILE_PATTERN.test(name)) return 'lock'
  if (STAGING_FILE_PATTERN.test(name)) return 'staging'
  return null
}

/**
 * Sweeps the turn-state directory. Runs on every `SessionStart` regardless of
 * whether any hook matches. Only regular files matching the known patterns are
 * ever touched — never a directory, never a symlink. A missing directory is a
 * silent no-op.
 */
export async function pruneTurnState(
  homeRoot: string,
  provider: AgentId = 'claude-code',
): Promise<void> {
  const dir = turnStateDirectory(homeRoot, provider)

  // Per-component refusal FIRST, containment second. Containment alone is not
  // enough: `realpath` resolves a symlinked `turn-state` before the check runs,
  // so a link pointing at another directory *inside* the home root passes
  // containment and the deletion loop then runs in the link's target. The
  // deletion path gets the same discipline as the write path — a symlinked
  // component is refused, never followed.
  let resolvedDir: string
  try {
    await assertRealDirectory(join(homeRoot, '.clooks'))
    if (provider !== 'claude-code') {
      await assertRealDirectory(join(homeRoot, '.clooks', 'turn-state'))
    }
    await assertRealDirectory(dir)

    resolvedDir = await realpath(dir)
    const resolvedHome = await realpath(homeRoot)
    if (!isStrictlyInside(resolvedHome, resolvedDir)) {
      warnOnce('turn state prune skipped — the directory resolves outside the home root')
      return
    }
  } catch (e) {
    if (errorCode(e) === 'ENOENT') return
    warnOnce(`turn state prune skipped (${e instanceof Error ? e.message : String(e)})`)
    return
  }

  let entries: Dirent[]
  try {
    entries = await readdir(resolvedDir, { withFileTypes: true })
  } catch (e) {
    if (errorCode(e) === 'ENOENT') return
    warnOnce(`turn state prune failed (${e instanceof Error ? e.message : String(e)})`)
    return
  }

  const now = Date.now()
  const survivors: { path: string; mtimeMs: number }[] = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const kind = classifyTurnStateFile(entry.name)
    if (kind === null) continue

    const filePath = join(resolvedDir, entry.name)
    try {
      const st = await lstat(filePath)
      if (!st.isFile()) continue
      const ttl = kind === 'lock' ? TURN_STATE_LOCK_TTL_MS : TURN_STATE_TTL_MS
      if (now - st.mtimeMs > ttl) {
        await unlink(filePath)
        continue
      }
      if (kind === 'session') survivors.push({ path: filePath, mtimeMs: st.mtimeMs })
    } catch {
      // Best-effort: a raced-away file, a permission hiccup, or a symlink swap
      // is not fatal to a housekeeping pass.
    }
  }

  if (survivors.length <= TURN_STATE_MAX_FILES) return
  survivors.sort((a, b) => a.mtimeMs - b.mtimeMs)
  for (const victim of survivors.slice(0, survivors.length - TURN_STATE_MAX_FILES)) {
    await unlink(victim.path).catch(() => {})
  }
}
