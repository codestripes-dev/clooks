// Echoes the entire hook payload back into the conversation context.
// Only active when CLOOKS_DEBUG=true — otherwise skips via beforeHook.

import type { ClooksHook, BaseContext } from './types'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const LOG_DIR = process.env.CLOOKS_LOGDIR || '/tmp/clooks-debug'
const LOG_FILE = join(LOG_DIR, 'debug-events.log')

function dump(ctx: BaseContext): string {
  const { signal: _, ...rest } = ctx
  return JSON.stringify(rest, null, 2)
}

function logToFile(ctx: BaseContext): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${ctx.event}: ${dump(ctx)}\n`
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    appendFileSync(LOG_FILE, line)
  } catch {
    // best-effort — don't crash the hook
  }
}

/** For events that support injectContext. */
function injectOpts(ctx: BaseContext): { injectContext: string; debugMessage: string } {
  logToFile(ctx)
  return {
    injectContext: dump(ctx),
    debugMessage: `debug-payload: injected ${ctx.event} payload`,
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
    description: 'Echoes hook payload into conversation context when CLOOKS_DEBUG=true',
  },

  beforeHook(event) {
    if (process.env.CLOOKS_DEBUG !== 'true') {
      return event.skip()
    }
  },

  // --- Guard events (injectContext supported on PreToolUse, UserPromptSubmit) ---
  PreToolUse: (ctx) => ctx.skip(injectOpts(ctx)),
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

  // --- Continuation events (debugMessage only) ---
  // WorktreeCreate is intentionally excluded: its result type is
  // SuccessResult | FailureResult (no SkipResult variant), which is
  // incompatible with this hook's skip-based pattern.
  TeammateIdle: (ctx) => ctx.skip(debugOpts(ctx)),
  TaskCompleted: (ctx) => ctx.skip(debugOpts(ctx)),
}
