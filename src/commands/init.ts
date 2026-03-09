import { Command } from 'commander'
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, statSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { getCtx } from '../tui/context.js'
import { jsonSuccess, jsonError } from '../tui/json-envelope.js'
import { printIntro, printSuccess, printInfo, printWarning, printError, printOutro } from '../tui/output.js'
import { promptConfirm, isNonInteractive } from '../tui/prompts.js'
import { registerClooks } from '../settings.js'
import { ENTRYPOINT_SCRIPT } from './init-entrypoint.js'

const STARTER_CONFIG = 'version: "1.0.0"\n\nconfig: {}\n'

const GITIGNORE_LINES = [
  '# Clooks',
  'clooks.local.yml',
  '.clooks/.cache/',
  '.clooks/.failures',
]

/**
 * Checks whether `.git/` exists in cwd or any parent directory up to `/`.
 */
function hasGitRepo(from: string): boolean {
  let dir = from
  while (true) {
    if (existsSync(join(dir, '.git'))) return true
    const parent = join(dir, '..')
    // Reached filesystem root
    if (parent === dir) return false
    dir = parent
  }
}

export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize clooks in this project')
    .action(async (_opts: unknown, cmd: Command) => {
      const ctx = getCtx(cmd)
      const projectRoot = process.cwd()

      try {
        // -- Directory guardrails --
        const cwd = projectRoot
        const home = os.homedir()

        if (cwd === home || cwd === '/') {
          const location = cwd === '/' ? 'filesystem root (/)' : 'home directory'
          if (isNonInteractive(ctx)) {
            const message = `Refusing to initialize in ${location} in non-interactive mode.`
            if (ctx.json) {
              process.stdout.write(jsonError('init', message) + '\n')
              process.exit(1)
            }
            printError(ctx, message)
            process.exit(1)
          }
          printWarning(ctx, `You are about to initialize clooks in your ${location}. This is usually a mistake.`)
          const confirmed = await promptConfirm(ctx, { message: 'Continue anyway?', defaultValue: false })
          if (!confirmed) {
            printInfo(ctx, 'Aborted.')
            return
          }
        }

        if (!hasGitRepo(cwd)) {
          if (isNonInteractive(ctx)) {
            // In non-interactive mode, proceed with warning only
            if (!ctx.json) {
              printWarning(ctx, 'No git repository detected. Clooks works best in a git repo.')
            }
          } else {
            printWarning(ctx, 'No git repository detected. Clooks works best in a git repo.')
            const confirmed = await promptConfirm(ctx, { message: 'Continue anyway?', defaultValue: true })
            if (!confirmed) {
              printInfo(ctx, 'Aborted.')
              return
            }
          }
        }

        // -- Track what we create/skip/update --
        const created: string[] = []
        const skipped: string[] = []
        const updated: string[] = []

        // -- Step 1: Create directories --
        const dirs = ['.clooks', '.clooks/hooks', '.clooks/bin', '.clooks/vendor']
        for (const dir of dirs) {
          mkdirSync(join(projectRoot, dir), { recursive: true })
        }

        // -- Step 2: Write clooks.yml (only if missing) --
        const configPath = join(projectRoot, '.clooks', 'clooks.yml')
        if (existsSync(configPath)) {
          skipped.push('.clooks/clooks.yml')
        } else {
          writeFileSync(configPath, STARTER_CONFIG)
          created.push('.clooks/clooks.yml')
        }

        // -- Step 3: Write entrypoint script (always) --
        const entrypointPath = join(projectRoot, '.clooks', 'bin', 'entrypoint.sh')
        const entrypointExisted = existsSync(entrypointPath)
        let entrypointChanged = !entrypointExisted
        if (entrypointExisted) {
          const existing = readFileSync(entrypointPath, 'utf-8')
          entrypointChanged = existing !== ENTRYPOINT_SCRIPT
        }
        writeFileSync(entrypointPath, ENTRYPOINT_SCRIPT)
        chmodSync(entrypointPath, 0o755)
        if (!entrypointExisted) {
          created.push('.clooks/bin/entrypoint.sh')
        } else if (entrypointChanged) {
          updated.push('.clooks/bin/entrypoint.sh')
        } else {
          skipped.push('.clooks/bin/entrypoint.sh')
        }

        // -- Step 4: Register in settings.json --
        const regResult = registerClooks(projectRoot)
        const totalEvents = regResult.added.length + regResult.updated.length + regResult.skipped.length
        if (regResult.added.length > 0 || regResult.updated.length > 0) {
          if (regResult.created) {
            created.push(`.claude/settings.json (${totalEvents} events)`)
          } else {
            updated.push(`.claude/settings.json (${regResult.added.length} added, ${regResult.updated.length} updated)`)
          }
        } else {
          skipped.push('.claude/settings.json')
        }

        // -- Step 5: Update .gitignore --
        const gitignorePath = join(projectRoot, '.gitignore')
        let gitignoreContent = ''
        if (existsSync(gitignorePath)) {
          gitignoreContent = readFileSync(gitignorePath, 'utf-8')
        }

        const linesToAdd: string[] = []
        for (const line of GITIGNORE_LINES) {
          if (!gitignoreContent.includes(line)) {
            linesToAdd.push(line)
          }
        }

        if (linesToAdd.length > 0) {
          // Ensure we start on a new line
          const prefix = gitignoreContent.length > 0 && !gitignoreContent.endsWith('\n') ? '\n' : ''
          writeFileSync(gitignorePath, gitignoreContent + prefix + linesToAdd.join('\n') + '\n')
          if (gitignoreContent.length === 0) {
            created.push('.gitignore')
          } else {
            updated.push('.gitignore')
          }
        } else {
          skipped.push('.gitignore')
        }

        // -- Output --
        if (ctx.json) {
          process.stdout.write(jsonSuccess('init', { created, skipped, updated }) + '\n')
          return
        }

        printIntro(ctx, 'clooks init')

        if (created.length === 0 && updated.length === 0) {
          // Fully idempotent re-run
          printSuccess(ctx, 'Already initialized \u2014 nothing to do.')
          printInfo(ctx, 'Tip: run `clooks register` to add a hook.')
        } else {
          for (const item of created) {
            printSuccess(ctx, `Created ${item}`)
          }
          for (const item of updated) {
            printSuccess(ctx, `Updated ${item}`)
          }
          printInfo(ctx, 'Next: write a hook and run `clooks register`.')
          printWarning(ctx, 'Restart Claude Code for hooks to take effect.')
        }

        printOutro(ctx, 'Done.')
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (ctx.json) {
          process.stdout.write(jsonError('init', message) + '\n')
          process.exit(1)
        }
        printError(ctx, message)
        process.exit(1)
      }
    })
}
