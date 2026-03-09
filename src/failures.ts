import { join, dirname } from "path"
import { unlink } from "fs/promises"
import { mkdirSync } from "fs"
import { createHash } from "crypto"
import type { EventName, HookName } from "./types/branded.js"

export interface HookEventFailure {
  consecutiveFailures: number
  lastError: string
  lastFailedAt: string // ISO 8601
}

// Top-level: hook name → event name → failure data
export type FailureState = Record<HookName, Partial<Record<EventName, HookEventFailure>>>

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val)
}

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
): string {
  if (hasProjectConfig) {
    return join(projectRoot, ".clooks/.failures")
  }
  const hash = createHash("sha256")
    .update(projectRoot)
    .digest("hex")
    .slice(0, 12)
  return join(homeRoot, ".clooks/failures", `${hash}.json`)
}

export async function readFailures(failurePath: string): Promise<FailureState> {
  const file = Bun.file(failurePath)

  if (!(await file.exists())) {
    return {}
  }

  let text: string
  try {
    text = await file.text()
  } catch {
    return {}
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

export async function writeFailures(
  failurePath: string,
  state: FailureState,
): Promise<void> {
  if (Object.keys(state).length === 0) {
    try {
      await unlink(failurePath)
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e
    }
    return
  }

  // Ensure parent directory exists (needed for home-only case where
  // ~/.clooks/failures/ may not exist yet)
  mkdirSync(dirname(failurePath), { recursive: true })

  await Bun.write(failurePath, JSON.stringify(state, null, 2) + "\n")
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
