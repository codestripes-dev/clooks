import type { BeforeHookEvent, AfterHookEvent, HookEventMeta } from './types/lifecycle.js'
import type { EventName } from './types/branded.js'
import type { LoadedHook } from './loader.js'
import { getGitRoot, getGitBranch } from './git.js'
import { VERSION } from './version.js'
import { attachDecisionMethods, attachLifecycleMethods } from './engine/context-methods.js'

export function buildBeforeHookEvent(
  eventName: EventName,
  input: Record<string, unknown>,
  meta: HookEventMeta,
): BeforeHookEvent {
  const event = { type: eventName, input, meta }
  attachLifecycleMethods('before', event)
  return event as unknown as BeforeHookEvent
}

export function buildAfterHookEvent(
  eventName: EventName,
  input: Record<string, unknown>,
  handlerResult: unknown,
  meta: HookEventMeta,
): AfterHookEvent {
  const event = { type: eventName, input, handlerResult, meta }
  attachLifecycleMethods('after', event)
  return event as unknown as AfterHookEvent
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
      platform: process.platform as 'darwin' | 'linux',
      hookName: hook.name,
      hookPath: hook.hookPath,
      timestamp: this.timestamp,
      clooksVersion: VERSION,
      configPath: hook.configPath,
    }
  }
}

export interface LifecycleResult {
  /** The final result (handler result, beforeHook block, or beforeHook skip). */
  result: unknown
  /** True if beforeHook short-circuited with a `block`. Used by the engine for debug logging. */
  blockedByBefore: boolean
  /** Always `false` today — afterHook is observer-only and cannot override. */
  overriddenByAfter: boolean
}

function isLifecycleResultObject(v: unknown): v is { result: string; [k: string]: unknown } {
  return typeof v === 'object' && v !== null && 'result' in v
}

const VALID_BEFORE_RESULTS = new Set(['block', 'skip', 'passthrough'])
const VALID_AFTER_RESULTS = new Set(['passthrough'])

function warnUnexpectedReturn(
  slot: 'beforeHook' | 'afterHook',
  hookName: string,
  ret: unknown,
): void {
  const tag = isLifecycleResultObject(ret) ? String(ret.result) : typeof ret
  process.stderr.write(
    `clooks: hook "${hookName}" ${slot} returned an unrecognized shape (result=${tag}). ` +
      `${slot === 'beforeHook' ? 'Expected event.block / event.skip / event.passthrough or void.' : 'Expected event.passthrough or void.'} ` +
      `Treating as no-op.\n`,
  )
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

  const handler = (hook as unknown as Record<string, unknown>)[eventName] as (
    ...args: unknown[]
  ) => unknown

  async function lifecycle(): Promise<LifecycleResult> {
    attachDecisionMethods(eventName, context)

    if (hasBeforeHook) {
      const meta = await metaCache.buildMeta(loaded)
      const beforeEvent = buildBeforeHookEvent(eventName, context, meta)
      const ret: unknown = await hook.beforeHook!(beforeEvent, loaded.config)

      if (isLifecycleResultObject(ret)) {
        if (ret.result === 'block') {
          return { result: ret, blockedByBefore: true, overriddenByAfter: false }
        }
        if (ret.result === 'skip') {
          // `blockedByBefore: false` is correct here — skip means "hook is
          // invisible," distinct from "hook emitted a blocking decision."
          // Downstream consumers treat skip like a no-match. Don't "fix"
          // this to true.
          return { result: ret, blockedByBefore: false, overriddenByAfter: false }
        }
        if (!VALID_BEFORE_RESULTS.has(ret.result)) {
          warnUnexpectedReturn('beforeHook', loaded.name, ret)
        }
      }
    }

    const handlerResult = await handler(context, loaded.config)

    if (hasAfterHook) {
      const meta = await metaCache.buildMeta(loaded)
      const afterEvent = buildAfterHookEvent(eventName, context, handlerResult, meta)
      const ret: unknown = await hook.afterHook!(afterEvent, loaded.config)
      if (isLifecycleResultObject(ret) && !VALID_AFTER_RESULTS.has(ret.result)) {
        warnUnexpectedReturn('afterHook', loaded.name, ret)
      }
    }

    return { result: handlerResult, blockedByBefore: false, overriddenByAfter: false }
  }

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
