import { Command, CommanderError } from 'commander'
import { VERSION } from './index.js'
import { CancelError } from './tui/prompts.js'
import { createConfigCommand } from './commands/config.js'
import { createInitCommand } from './commands/init.js'
import { registerStubs } from './commands/stubs.js'

const program = new Command()

program
  .name('clooks')
  .description('A hook runtime for AI coding agents.')
  .showSuggestionAfterError(true)
  .exitOverride()
  .configureOutput({
    writeOut: (str) => process.stdout.write(str),
    writeErr: (str) => process.stderr.write(str),
  })
  .option('--json', 'Output results as JSON')
  .addHelpText('after', `\nRun clooks --version to print the version (v${VERSION}).`)

program.addCommand(createConfigCommand())
program.addCommand(createInitCommand())
registerStubs(program)

export { program }

export async function runCLI(args: string[]): Promise<void> {
  try {
    await program.parseAsync(args, { from: 'user' })
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) {
        process.exit(0)
      }
      process.exit(err.exitCode)
    }

    if (err instanceof CancelError) {
      // withCancel() in prompts.ts already printed the cancel message
      // via @clack/prompts cancel(). Just exit cleanly here.
      process.exit(0)
    }

    throw err
  }
}
