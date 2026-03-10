// Runtime building blocks for hook lifecycle execution.
// Consumed by the engine (M3) to wrap beforeHook → handler → afterHook.

import type { BlockResult } from "./types/results.js"
import type { BeforeHookEvent, AfterHookEvent, HookEventMeta } from "./types/lifecycle.js"
import type { EventName } from "./types/branded.js"
import type { LoadedHook } from "./loader.js"
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
