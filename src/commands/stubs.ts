import { Command } from 'commander'
import { getCtx } from '../tui/context.js'
import { jsonError } from '../tui/json-envelope.js'
import { printWarning } from '../tui/output.js'

function createStub(name: string, description: string): Command {
  return new Command(name)
    .description(description)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = getCtx(cmd)
      const message = `"clooks ${name}" is not yet implemented.`
      if (ctx.json) {
        process.stdout.write(jsonError(name, message) + '\n')
      } else {
        printWarning(ctx, message)
      }
      process.exit(1)
    })
}

export function registerStubs(program: Command): void {
  program.addCommand(createStub('register', 'Register a local hook'))
  program.addCommand(createStub('test', 'Test hooks with synthetic events'))
}
