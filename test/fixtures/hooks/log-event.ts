import { writeFileSync } from 'fs'
import { join } from 'path'

type AllowCtx = { allow: () => { result: 'allow' } }

export const hook = {
  meta: { name: 'log-event' },
  PreToolUse(ctx: AllowCtx) {
    writeFileSync(join(process.cwd(), '.clooks', 'hooks', 'log-event.log'), 'PreToolUse', 'utf8')
    return ctx.allow()
  },
}
