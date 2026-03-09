import { join } from "path"
import { unlink } from "fs/promises"

export interface HookEventFailure {
  consecutiveFailures: number
  lastError: string
  lastFailedAt: string // ISO 8601
}

// Top-level: hook name → event name → failure data
export type FailureState = Record<string, Record<string, HookEventFailure>>

const FAILURES_PATH = ".clooks/.failures"

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val)
}

export async function readFailures(projectRoot: string): Promise<FailureState> {
  const filePath = join(projectRoot, FAILURES_PATH)
  const file = Bun.file(filePath)

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
      "clooks: warning: .clooks/.failures is malformed, resetting failure state\n",
    )
    return {}
  }

  if (!isPlainObject(parsed)) {
    process.stderr.write(
      "clooks: warning: .clooks/.failures is malformed, resetting failure state\n",
    )
    return {}
  }

  return parsed as FailureState
}

export async function writeFailures(
  projectRoot: string,
  state: FailureState,
): Promise<void> {
  const filePath = join(projectRoot, FAILURES_PATH)

  if (Object.keys(state).length === 0) {
    try {
      await unlink(filePath)
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e
    }
    return
  }

  await Bun.write(filePath, JSON.stringify(state, null, 2) + "\n")
}

export function recordFailure(
  state: FailureState,
  hookName: string,
  eventName: string,
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
  hookName: string,
  eventName: string,
): FailureState {
  const hookEvents = state[hookName]
  if (!hookEvents || !(eventName in hookEvents)) {
    return state
  }

  const { [eventName]: _, ...remainingEvents } = hookEvents

  if (Object.keys(remainingEvents).length === 0) {
    const { [hookName]: __, ...remainingHooks } = state
    return remainingHooks
  }

  return {
    ...state,
    [hookName]: remainingEvents,
  }
}

export function getFailureCount(
  state: FailureState,
  hookName: string,
  eventName: string,
): number {
  return state[hookName]?.[eventName]?.consecutiveFailures ?? 0
}
