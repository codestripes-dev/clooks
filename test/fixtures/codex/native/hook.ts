import { appendFileSync, readFileSync } from 'node:fs'
import type { ClooksHook } from '../../../../src/types'

interface FixtureConfig {
  id: string
  handlerLog: string
  commandB: string
  denyReason: string
  stopReason: string
  tokens: Record<string, string>
}

const configPath = process.env.CLOOKS_NATIVE_CASE_CONFIG
if (!configPath) throw new Error('Missing synthetic native hook configuration')
const config = JSON.parse(readFileSync(configPath, 'utf8')) as FixtureConfig

function record(
  event: string,
  ctx: {
    turn: { priorInterventions: number }
    toolName?: unknown
    toolInput?: unknown
    toolResponse?: unknown
  },
) {
  appendFileSync(
    config.handlerLog,
    JSON.stringify({
      event,
      toolName: ctx.toolName,
      toolInput: ctx.toolInput,
      toolResponse: ctx.toolResponse,
      priorInterventions: ctx.turn.priorInterventions,
      contextToken: config.id === 'M1-CONTEXT' ? config.tokens[event] : undefined,
    }) + '\n',
  )
}

function context(event: string) {
  return config.id === 'M1-CONTEXT' ? { injectContext: config.tokens[event] } : {}
}

export const hook = {
  meta: { name: 'native-m1' },
  SessionStart(ctx) {
    record('SessionStart', ctx)
    return ctx.skip(context('SessionStart'))
  },
  UserPromptSubmit(ctx) {
    record('UserPromptSubmit', ctx)
    return ctx.skip(context('UserPromptSubmit'))
  },
  PreToolUse(ctx) {
    record('PreToolUse', ctx)
    if (config.id === 'M1-DENY') return ctx.block({ reason: config.denyReason })
    if (config.id === 'M1-ASK') return ctx.ask({ reason: 'm1-ask-request' })
    if (config.id === 'M1-REWRITE') return ctx.allow({ updatedInput: { command: config.commandB } })
    if (config.id === 'M1-CONTEXT') return ctx.allow(context('PreToolUse'))
    return ctx.skip()
  },
  PostToolUse(ctx) {
    record('PostToolUse', ctx)
    return ctx.skip(context('PostToolUse'))
  },
  Stop(ctx) {
    record('Stop', ctx)
    if (config.id === 'M1-STOP' && ctx.turn.priorInterventions === 0) {
      return ctx.block({ reason: config.stopReason })
    }
    return ctx.skip()
  },
} satisfies ClooksHook
