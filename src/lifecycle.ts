// Runtime building blocks for hook lifecycle execution.
// Consumed by the engine (M3) to wrap beforeHook → handler → afterHook.

import type { BlockResult } from "./types/results.js"
import type { BeforeHookEvent, AfterHookEvent, HookEventMeta } from "./types/lifecycle.js"
import type { EventName } from "./types/branded.js"
import type { LoadedHook } from "./loader.js"
import type { ClooksHook } from "./types/hook.js"
import { getGitRoot, getGitBranch } from "./git.js"
import { VERSION } from "./version.js"

export function createRespondCallback<T>(): {
  respond: (result: T) => void
  getResponse: () => T | undefined
} {
  let called = false
  let response: T | undefined
  return {
    respond(result: T) {
      if (called) {
        throw new Error("respond() can only be called once per lifecycle invocation")
      }
      if (result === undefined || result === null) {
        throw new Error("respond() requires a non-null result object")
      }
      called = true
      response = result
    },
    getResponse: () => response,
  }
}

export function buildBeforeHookEvent(
  eventName: EventName,
  input: Record<string, unknown>,
  meta: HookEventMeta,
  respond: (result: BlockResult) => void,
): BeforeHookEvent {
  return { type: eventName, input, meta, respond } as unknown as BeforeHookEvent
}

export function buildAfterHookEvent(
  eventName: EventName,
  input: Record<string, unknown>,
  handlerResult: unknown,
  meta: HookEventMeta,
  respond: (result: unknown) => void,
): AfterHookEvent {
  return { type: eventName, input, handlerResult, meta, respond } as unknown as AfterHookEvent
}

export class LifecycleMetaCache {
  private gitRoot: string | null | undefined
  private gitBranch: string | null | undefined
  private readonly timestamp: string

  constructor(timestamp?: string) {
    this.timestamp = timestamp ?? new Date().toISOString()
  }

  async buildMeta(hook: LoadedHook): Promise<HookEventMeta> {
    if (this.gitRoot === undefined) {
      this.gitRoot = await getGitRoot()
    }
    if (this.gitBranch === undefined) {
      this.gitBranch = await getGitBranch()
    }
    return {
      gitRoot: this.gitRoot,
      gitBranch: this.gitBranch,
      platform: process.platform as "darwin" | "linux",
      hookName: hook.name,
      hookPath: hook.hookPath,
      timestamp: this.timestamp,
      clooksVersion: VERSION,
      configPath: hook.configPath,
    }
  }
}

export interface LifecycleResult {
  /** The final result (handler result, beforeHook block, or afterHook override). */
  result: unknown
  /** True if beforeHook short-circuited. Used by the engine for debug logging. */
  blockedByBefore: boolean
  /** True if afterHook overrode the result. Used by the engine for debug logging. */
  overriddenByAfter: boolean
}

export async function runHookLifecycle(
  loaded: LoadedHook,
  eventName: EventName,
  context: Record<string, unknown>,
  timeoutMs: number,
  metaCache: LifecycleMetaCache,
): Promise<LifecycleResult> {
  const hook = loaded.hook
  const hasBeforeHook = hook.beforeHook !== undefined
  const hasAfterHook = hook.afterHook !== undefined

  const handler = (hook as unknown as Record<string, unknown>)[eventName] as Function

  async function lifecycle(): Promise<LifecycleResult> {
    // --- beforeHook phase ---
    if (hasBeforeHook) {
      const meta = await metaCache.buildMeta(loaded)
      const { respond, getResponse } = createRespondCallback<BlockResult>()
      const beforeEvent = buildBeforeHookEvent(eventName, context, meta, respond)
      await hook.beforeHook!(beforeEvent, loaded.config)
      const blocked = getResponse()
      if (blocked) {
        return { result: blocked, blockedByBefore: true, overriddenByAfter: false }
      }
    }

    // --- handler phase ---
    const handlerResult = await handler(context, loaded.config)

    // --- afterHook phase (only if handler completed normally) ---
    if (hasAfterHook) {
      const meta = await metaCache.buildMeta(loaded)
      const { respond, getResponse } = createRespondCallback<unknown>()
      const afterEvent = buildAfterHookEvent(eventName, context, handlerResult, meta, respond)
      await hook.afterHook!(afterEvent, loaded.config)
      const override = getResponse()
      if (override !== undefined) {
        return { result: override, blockedByBefore: false, overriddenByAfter: true }
      }
    }

    return { result: handlerResult, blockedByBefore: false, overriddenByAfter: false }
  }

  // Race the entire lifecycle against the timeout
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`hook "${loaded.name}" timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([lifecycle(), timeout])
  } finally {
    clearTimeout(timer!)
  }
}
