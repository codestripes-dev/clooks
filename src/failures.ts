import { join, dirname, basename, relative, resolve, sep } from 'path'
import { unlink, lstat, mkdir, open, realpath, rename } from 'fs/promises'
import { mkdirSync, constants } from 'fs'
import { createHash, randomBytes } from 'crypto'
import type { EventName, HookName } from './types/branded.js'
import { isPlainObject } from 'lodash-es'
import type { AgentId } from './agents/types.js'

/**
 * Synthetic event key for load/import errors.
 * Load errors are event-independent — a hook that fails to import should
 * accumulate failures in a single counter regardless of which event triggered
 * the invocation. This avoids the N-events × threshold multiplication problem.
 */
export const LOAD_ERROR_EVENT = '__load__' as EventName

export interface HookEventFailure {
  consecutiveFailures: number
  lastError: string
  lastFailedAt: string // ISO 8601
}

// Top-level: hook name → event name → failure data
export type FailureState = Record<HookName, Partial<Record<EventName, HookEventFailure>>>

export type FailureLocation = string | { path: string; root: string }

/**
 * Computes the failure state file path.
 *
 * - If a project config exists, failures are stored in the project's `.clooks/.failures`.
 * - If home-only (no project config), failures are stored centrally in
 *   `~/.clooks/failures/<hash>.json` where hash is a truncated SHA-256 of the project root.
 *
 * This is a pure path computation function — no side effects.
 */
export function getFailurePath(
  projectRoot: string,
  homeRoot: string,
  hasProjectConfig: boolean,
  agent: AgentId = 'claude-code',
): string {
  if (hasProjectConfig) {
    if (agent === 'codex') {
      return join(projectRoot, '.clooks', '.cache', 'agents', agent, 'failures.json')
    }
    return join(projectRoot, '.clooks/.failures')
  }
  const hash = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12)
  if (agent === 'codex') {
    return join(homeRoot, '.clooks/failures', agent, `${hash}.json`)
  }
  return join(homeRoot, '.clooks/failures', `${hash}.json`)
}

export function getConfigFailurePath(
  projectRoot: string,
  homeRoot: string,
  hasProjectConfig: boolean,
  agent: AgentId = 'claude-code',
): string {
  return agent === 'claude-code'
    ? join(projectRoot, '.clooks/.failures')
    : getFailurePath(projectRoot, homeRoot, hasProjectConfig, agent)
}

export function getFailureLocation(
  projectRoot: string,
  homeRoot: string,
  hasProjectConfig: boolean,
  agent: AgentId,
  configError = false,
): FailureLocation {
  const path = configError
    ? getConfigFailurePath(projectRoot, homeRoot, hasProjectConfig, agent)
    : getFailurePath(projectRoot, homeRoot, hasProjectConfig, agent)
  return agent === 'claude-code' ? path : { path, root: hasProjectConfig ? projectRoot : homeRoot }
}

/** Validate managed components without following a link into another agent's state. */
async function managedFailurePath(
  location: Exclude<FailureLocation, string>,
  create: boolean,
): Promise<string> {
  const root = resolve(location.root)
  const path = resolve(location.path)
  const parts = relative(root, dirname(path)).split(sep)
  if (parts[0] !== '.clooks' || parts.includes('..')) {
    throw new Error('failure state path is outside its selected managed root')
  }
  let directory = root
  for (const part of parts) {
    directory = join(directory, part)
    if (create) {
      try {
        await mkdir(directory, { mode: 0o700 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    const entry = await lstat(directory)
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error('failure state parent is not a real directory')
    }
  }
  const resolvedRoot = await realpath(root)
  const resolvedDirectory = await realpath(directory)
  if (
    !resolvedDirectory.startsWith(resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep)
  ) {
    throw new Error('failure state directory resolves outside its selected root')
  }
  return join(resolvedDirectory, basename(path))
}

async function assertFailureFile(path: string): Promise<void> {
  try {
    const entry = await lstat(path)
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) {
      throw new Error('failure state file is not a single-link regular file')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function readManagedFailures(
  location: Exclude<FailureLocation, string>,
): Promise<string | null> {
  let handle
  try {
    const path = await managedFailurePath(location, false)
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const entry = await handle.stat()
    if (!entry.isFile() || entry.nlink !== 1)
      throw new Error('failure state file is not a single-link regular file')
    return await handle.readFile('utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  } finally {
    await handle?.close()
  }
}

export async function readFailures(location: FailureLocation): Promise<FailureState> {
  const failurePath = typeof location === 'string' ? location : location.path
  let text: string
  if (typeof location !== 'string') {
    const content = await readManagedFailures(location)
    if (content === null) return {}
    text = content
  } else {
    const file = Bun.file(failurePath)

    if (!(await file.exists())) {
      return {}
    }

    try {
      text = await file.text()
    } catch {
      return {}
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    process.stderr.write(
      `clooks: warning: failure state at ${failurePath} is malformed, resetting\n`,
    )
    return {}
  }

  if (!isPlainObject(parsed)) {
    process.stderr.write(
      `clooks: warning: failure state at ${failurePath} is malformed, resetting\n`,
    )
    return {}
  }

  // Deserialization boundary: cast from untyped JSON into branded types.
  // Safe because the failure state file is written exclusively by the engine
  // (via writeFailures()), so the data is known to conform.
  return parsed as FailureState
}

export async function writeFailures(location: FailureLocation, state: FailureState): Promise<void> {
  if (typeof location !== 'string') {
    const empty = Object.keys(state).length === 0
    let path: string
    try {
      path = await managedFailurePath(location, !empty)
    } catch (error) {
      if (empty && (error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    await assertFailureFile(path)
    if (empty) {
      try {
        await unlink(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      return
    }
    const staging = join(
      dirname(path),
      `.failures-${process.pid}-${randomBytes(8).toString('hex')}.tmp`,
    )
    const handle = await open(staging, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify(state, null, 2) + '\n')
      await managedFailurePath(location, false)
      await assertFailureFile(path)
      await rename(staging, path)
    } finally {
      await handle.close().catch(() => {})
      await unlink(staging).catch(() => {})
    }
    return
  }
  const failurePath = location
  if (Object.keys(state).length === 0) {
    try {
      await unlink(failurePath)
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    return
  }

  // Ensure parent directory exists (needed for home-only case where
  // ~/.clooks/failures/ may not exist yet)
  mkdirSync(dirname(failurePath), { recursive: true })

  await Bun.write(failurePath, JSON.stringify(state, null, 2) + '\n')
}

export function recordFailure(
  state: FailureState,
  hookName: HookName,
  eventName: EventName,
  error: string,
): FailureState {
  const existing = state[hookName]?.[eventName]
  const entry: HookEventFailure = {
    consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
    lastError: error,
    lastFailedAt: new Date().toISOString(),
  }
  return {
    ...state,
    [hookName]: {
      ...state[hookName],
      [eventName]: entry,
    },
  }
}

export function clearFailure(
  state: FailureState,
  hookName: HookName,
  eventName: EventName,
): FailureState {
  const hookEvents = state[hookName]
  if (!hookEvents || !(eventName in hookEvents)) {
    return state
  }

  const { [eventName]: _, ...remainingEvents } = hookEvents

  if (Object.keys(remainingEvents).length === 0) {
    const { [hookName]: __, ...remainingHooks } = state
    // Re-assert brand lost by computed destructuring spread
    return remainingHooks as FailureState
  }

  return {
    ...state,
    [hookName]: remainingEvents as Partial<Record<EventName, HookEventFailure>>,
  }
}

export function getFailureCount(
  state: FailureState,
  hookName: HookName,
  eventName: EventName,
): number {
  return state[hookName]?.[eventName]?.consecutiveFailures ?? 0
}
