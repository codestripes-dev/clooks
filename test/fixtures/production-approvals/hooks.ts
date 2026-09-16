import type { ClooksHook } from '../../../src/types'
import { record } from './records'

export function checkpoint(number: number): ClooksHook {
  return {
    meta: { name: `hook-${number}` },
    PreToolUse(ctx) {
      const ask = (number === 2 || number === 4) && process.env.APPROVAL_CASE !== 'noask'
      record(process.env.APPROVAL_ROOT!, ask ? `${number}-ask` : String(number), {
        input: ctx.toolInput,
        provider: ctx.provider,
        source: import.meta.path,
      })
      return ask
        ? ctx.ask({
            ...(number === 2 ? { question: 'Approve checkpoint 2?' } : {}),
            reason: `Checkpoint ${number}`,
          })
        : ctx.skip()
    },
  }
}
