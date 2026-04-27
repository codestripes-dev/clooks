import { Command, CommanderError } from 'commander'
import { VERSION } from './version.js'
import { CancelError } from './tui/prompts.js'
import { createAddCommand } from './commands/add.js'
import { createConfigCommand } from './commands/config.js'
import { createInitCommand } from './commands/init.js'
import { createTypesCommand } from './commands/types.js'
import { createNewHookCommand } from './commands/new-hook.js'
import { createUninstallCommand } from './commands/uninstall.js'
import { createUpdateCommand } from './commands/update.js'

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

program.addCommand(createAddCommand())
program.addCommand(createConfigCommand())
program.addCommand(createInitCommand())
program.addCommand(createTypesCommand())
program.addCommand(createNewHookCommand())
program.addCommand(createUninstallCommand())
program.addCommand(createUpdateCommand())

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
