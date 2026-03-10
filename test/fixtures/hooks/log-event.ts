import { writeFileSync } from 'fs'
import { join } from 'path'

export const hook = {
  meta: { name: "log-event" },
  PreToolUse() {
    writeFileSync(join(process.cwd(), '.clooks', 'hooks', 'log-event.log'), 'PreToolUse', 'utf8')
    return { result: "allow" as const }
  },
}
