import { appendFileSync, readFileSync } from 'node:fs'
import type { ClooksHook } from '../../src/types'

const configPath = process.env.CLOOKS_NATIVE_CASE_CONFIG
if (!configPath) throw new Error('Missing native hybrid fixture configuration')
const fixture = JSON.parse(readFileSync(configPath, 'utf8')) as {
  handlerLog: string
  command: string
  replacement?: string
}

export const hook: ClooksHook<{ reason: string }> = {
  meta: { name: 'hybrid-ask', config: { reason: 'hybrid confirmation' } },
  PreToolUse(ctx, config) {
    const command = 'command' in ctx.toolInput ? ctx.toolInput.command : undefined
    appendFileSync(
      fixture.handlerLog,
      JSON.stringify({
        command,
        reason: config.reason,
        toolName: ctx.toolName,
      }) + '\n',
    )
    if (command !== fixture.command && command !== fixture.replacement) return ctx.skip()
    return ctx.ask({
      reason: config.reason,
      ...(fixture.replacement ? { updatedInput: { command: fixture.replacement } } : {}),
    })
  },
}
