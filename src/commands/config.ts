import { Command } from 'commander'
import { loadConfig as defaultLoadConfig } from '../config/index.js'
import type { ClooksConfig } from '../config/types.js'
import { ConfigNotFoundError } from '../config/parse.js'
import { getCtx } from '../tui/context.js'
import { jsonSuccess, jsonError } from '../tui/json-envelope.js'
import { printIntro, printSuccess, printInfo, printError, printOutro } from '../tui/output.js'

type LoadConfigFn = (projectRoot: string) => Promise<ClooksConfig>

export function createConfigCommand(loadConfig: LoadConfigFn = defaultLoadConfig): Command {
  return new Command('config')
    .description('Show resolved clooks configuration')
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = getCtx(cmd)
      const projectRoot = process.cwd()

      try {
        const config = await loadConfig(projectRoot)
        const hookCount = Object.keys(config.hooks).length

        if (ctx.json) {
          process.stdout.write(jsonSuccess('config', {
            version: config.version,
            hooks: hookCount,
            timeout: config.global.timeout,
            onError: config.global.onError,
            maxFailures: config.global.maxFailures,
          }) + '\n')
          return
        }

        printIntro(ctx, 'clooks config')
        printSuccess(ctx, `Config loaded from .clooks/clooks.yml`)
        printInfo(ctx, `Hooks: ${hookCount} registered`)
        printInfo(ctx, `Timeout: ${config.global.timeout}ms`)
        printInfo(ctx, `onError: ${config.global.onError}`)
        printInfo(ctx, `maxFailures: ${config.global.maxFailures}`)
        printOutro(ctx, 'Done')
      } catch (e) {
        if (e instanceof ConfigNotFoundError) {
          if (ctx.json) {
            process.stdout.write(jsonError('config', 'No clooks.yml found. Run `clooks init` to get started.') + '\n')
            process.exit(1)
          }
          printError(ctx, 'No clooks.yml found. Run `clooks init` to get started.')
          process.exit(1)
        }
        const message = e instanceof Error ? e.message : String(e)
        if (ctx.json) {
          process.stdout.write(jsonError('config', message) + '\n')
          process.exit(1)
        }
        printError(ctx, message)
        process.exit(1)
      }
    })
}
