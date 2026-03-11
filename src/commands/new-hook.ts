import { Command } from 'commander'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { getCtx } from '../tui/context.js'
import { jsonSuccess } from '../tui/json-envelope.js'
import {
  printIntro, printSuccess, printInfo, printWarning, printError, printOutro
} from '../tui/output.js'
import { promptText, promptSelect, isNonInteractive } from '../tui/prompts.js'

const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

function hookTemplate(hookName: string): string {
  return [
    "import type { ClooksHook } from './types'",
    '',
    'type Config = {}',
    '',
    'export const hook: ClooksHook<Config> = {',
    '  meta: {',
    `    name: '${hookName}',`,
    '    config: {},',
    '  },',
    '}',
    '',
  ].join('\n')
}

export function createNewHookCommand(): Command {
  return new Command('new-hook')
    .description('Scaffold a new hook file')
    .option('--name <name>', 'Hook name (kebab-case)')
    .option('--scope <scope>', 'Hook scope: project or user', 'project')
    .action(async (opts: { name?: string; scope: string }, cmd: Command) => {
      const ctx = getCtx(cmd)

      try {
        // --- Resolve hook name ---
        let hookName = opts.name

        if (!hookName) {
          if (isNonInteractive(ctx)) {
            const message =
              'Hook name is required in non-interactive mode. Use --name <name>.'
            printError(ctx, 'new-hook', message)
            process.exit(1)
          }

          printIntro(ctx, 'clooks new-hook')
          hookName = await promptText(ctx, {
            message: 'Hook name (kebab-case):',
            validate: (v: string) =>
              KEBAB_CASE_RE.test(v)
                ? undefined
                : 'Must be kebab-case (e.g., my-hook)',
          })
        }

        // Validate (covers --name flag which bypasses prompt validation)
        if (!KEBAB_CASE_RE.test(hookName)) {
          const message = `Invalid hook name "${hookName}". Must be kebab-case (e.g., my-hook).`
          printError(ctx, 'new-hook', message)
          process.exit(1)
        }

        // --- Resolve scope ---
        let scope = opts.scope
        if (!opts.name && !isNonInteractive(ctx)) {
          // Only prompt for scope in fully interactive mode (when name was also prompted)
          scope = await promptSelect(ctx, {
            message: 'Hook scope:',
            options: [
              { value: 'project', label: 'Project hook (.clooks/hooks/)' },
              { value: 'user', label: 'User-scope hook (~/.clooks/hooks/)' },
            ],
          })
        }

        // Validate scope
        if (scope !== 'project' && scope !== 'user') {
          const message = `Invalid scope "${scope}". Must be "project" or "user".`
          printError(ctx, 'new-hook', message)
          process.exit(1)
        }

        // --- Determine target path ---
        const root = scope === 'user' ? os.homedir() : process.cwd()
        const hooksDir = join(root, '.clooks', 'hooks')
        const hookPath = join(hooksDir, `${hookName}.ts`)

        const displayPath =
          scope === 'user'
            ? `~/.clooks/hooks/${hookName}.ts`
            : `.clooks/hooks/${hookName}.ts`

        // --- Refuse to overwrite ---
        if (existsSync(hookPath)) {
          const message = `${displayPath} already exists. Will not overwrite.`
          printError(ctx, 'new-hook', message)
          process.exit(1)
        }

        // --- Write hook file ---
        mkdirSync(hooksDir, { recursive: true })
        writeFileSync(hookPath, hookTemplate(hookName))

        // --- Warnings (TUI only, non-blocking) ---
        if (!existsSync(join(hooksDir, 'types.d.ts'))) {
          printWarning(ctx, "types.d.ts not found. Run 'clooks types' to generate type declarations.")
        }

        const configPath = scope === 'user'
          ? join(os.homedir(), '.clooks', 'clooks.yml')
          : join(process.cwd(), '.clooks', 'clooks.yml')
        if (!existsSync(configPath)) {
          printWarning(ctx, "No clooks.yml found. Run 'clooks init' to set up the project.")
        }

        // --- Output ---
        if (ctx.json) {
          process.stdout.write(
            jsonSuccess('new-hook', { path: displayPath, name: hookName }) + '\n'
          )
          return
        }

        // In interactive mode, intro was already printed before prompts.
        // In non-interactive (--name flag), print it now.
        if (opts.name) {
          printIntro(ctx, 'clooks new-hook')
        }

        printSuccess(ctx, `Created ${displayPath}`)
        printInfo(ctx, 'Next: add event handlers (e.g., PreToolUse, PostToolUse) and register in clooks.yml')
        printOutro(ctx, 'Done.')
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        printError(ctx, 'new-hook', message)
        process.exit(1)
      }
    })
}
