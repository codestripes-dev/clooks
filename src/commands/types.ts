import { Command } from 'commander'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { getCtx } from '../tui/context.js'
import { jsonSuccess } from '../tui/json-envelope.js'
import {
  printIntro,
  printSuccess,
  printInfo,
  printWarning,
  printError,
  printOutro,
} from '../tui/output.js'
import EMBEDDED_TYPES_DTS from '../generated/clooks-types.d.ts.txt' with { type: 'text' }

export function createTypesCommand(): Command {
  return new Command('types')
    .description('Extract type declarations for hook authoring')
    .option('--global', 'Write to ~/.clooks/hooks/ instead of .clooks/hooks/')
    .action(async (opts: { global?: boolean }, cmd: Command) => {
      const ctx = getCtx(cmd)

      try {
        const root = opts.global ? os.homedir() : process.cwd()
        const hooksDir = join(root, '.clooks', 'hooks')
        const typesPath = join(hooksDir, 'types.d.ts')

        mkdirSync(hooksDir, { recursive: true })
        writeFileSync(typesPath, EMBEDDED_TYPES_DTS)

        const displayPath = opts.global ? '~/.clooks/hooks/types.d.ts' : '.clooks/hooks/types.d.ts'

        if (ctx.json) {
          process.stdout.write(jsonSuccess('types', { path: displayPath }) + '\n')
          return
        }

        printIntro(ctx, 'clooks types')
        printSuccess(ctx, `Wrote ${displayPath}`)
        printInfo(ctx, "Import in hooks: import type { ClooksHook } from './types'")

        // Warn if no clooks.yml exists (project not initialized)
        const configExists = existsSync(join(root, '.clooks', 'clooks.yml'))
        if (!configExists) {
          printWarning(ctx, "No clooks.yml found. Run 'clooks init' to set up the project.")
        }

        printOutro(ctx, 'Done.')
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        printError(ctx, 'types', message)
        process.exit(1)
      }
    })
}
