// Dumps the JSON-serializable portion of normalized handler context, not raw wire input.
// Only active when CLOOKS_DEBUG=true — otherwise skips via beforeHook.
// Unredacted: prompts, tool data, paths and history may contain sensitive information.

import type { ClooksHook, BaseContext } from './types'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function dump(ctx: BaseContext): string {
  const { signal: _, ...rest } = ctx
  return JSON.stringify(rest, null, 2)
}

function logToFile(ctx: BaseContext): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${ctx.event}: ${dump(ctx)}\n`
  try {
    const logDir = process.env.CLOOKS_LOGDIR || '/tmp/clooks-debug'
    mkdirSync(logDir, { recursive: true })
    appendFileSync(join(logDir, 'debug-events.log'), line)
  } catch {
    // best-effort — don't crash the hook
  }
}

/** Only events whose skip helper and adapter support context injection. */
function injectOpts(ctx: BaseContext): { injectContext: string; debugMessage: string } {
  logToFile(ctx)
  return {
    injectContext: dump(ctx),
    debugMessage: `debug-payload: injecting ${ctx.event} normalized context`,
  }
}

/** For events that only support debugMessage. */
function debugOpts(ctx: BaseContext): { debugMessage: string } {
  logToFile(ctx)
  return {
    debugMessage: `debug-payload [${ctx.event}]: ${dump(ctx)}`,
  }
}

export const hook: ClooksHook = {
  meta: {
    name: 'debug-payload',
    description: 'Inspects serializable normalized context with skip-only debug logging when CLOOKS_DEBUG=true',
  },

  beforeHook(event) {
    if (process.env.CLOOKS_DEBUG !== 'true') {
      return event.skip()
    }
  },

  // PreToolUse.skip cannot inject context; debugging must not grant permission.
  PreToolUse: (ctx) => ctx.skip(debugOpts(ctx)),
  UserPromptSubmit: (ctx) => ctx.skip(injectOpts(ctx)),
  PermissionRequest: (ctx) => ctx.skip(debugOpts(ctx)),
  Stop: (ctx) => ctx.skip(debugOpts(ctx)),
  SubagentStop: (ctx) => ctx.skip(debugOpts(ctx)),
  ConfigChange: (ctx) => ctx.skip(debugOpts(ctx)),

  // --- Observe events (injectContext supported on most) ---
  SessionStart: (ctx) => ctx.skip(injectOpts(ctx)),
  PostToolUse: (ctx) => ctx.skip(injectOpts(ctx)),
  PostToolUseFailure: (ctx) => ctx.skip(injectOpts(ctx)),
  Notification: (ctx) => ctx.skip(injectOpts(ctx)),
  SubagentStart: (ctx) => ctx.skip(injectOpts(ctx)),

  // Observe events without injectContext
  SessionEnd: (ctx) => ctx.skip(debugOpts(ctx)),
  InstructionsLoaded: (ctx) => ctx.skip(debugOpts(ctx)),
  WorktreeRemove: (ctx) => ctx.skip(debugOpts(ctx)),
  PreCompact: (ctx) => ctx.skip(debugOpts(ctx)),
  PostCompact: (ctx) => ctx.skip(debugOpts(ctx)),

  // --- Continuation events (debugMessage only) ---
  // WorktreeCreate is intentionally excluded: its result type is
  // SuccessResult | FailureResult (no SkipResult variant), which is
  // incompatible with this hook's skip-based pattern.
  TeammateIdle: (ctx) => ctx.skip(debugOpts(ctx)),
  TaskCompleted: (ctx) => ctx.skip(debugOpts(ctx)),
}
