import { Command } from 'commander'
import { existsSync, rmSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { getCtx, type OutputContext } from '../tui/context.js'
import { jsonSuccess } from '../tui/json-envelope.js'
import {
  printIntro,
  printSuccess,
  printInfo,
  printWarning,
  printError,
  printOutro,
} from '../tui/output.js'
import { promptConfirm, promptSelect, isNonInteractive, CancelError } from '../tui/prompts.js'
import { unregisterClooks, isClooksRegistered } from '../settings.js'
import { getGitRoot } from '../git.js'
import { getHomeDir } from '../platform.js'

/**
 * Detect custom hooks in the hooks directory.
 * Returns filenames, filtering out the generated types.d.ts.
 */
function detectCustomHooks(hooksDir: string): string[] {
  if (!existsSync(hooksDir)) return []
  return readdirSync(hooksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== 'types.d.ts')
    .map((entry) => entry.name)
}

/**
 * Uninstall Clooks from the current project.
 */
async function uninstallProject(
  ctx: OutputContext,
  opts: { force?: boolean; unhook?: boolean; full?: boolean },
): Promise<void> {
  // a. Resolve project root
  const gitRoot = await getGitRoot()
  const projectRoot = gitRoot ?? process.cwd()
  const clooksDir = join(projectRoot, '.clooks')
  const settingsDir = join(projectRoot, '.claude')

  // b. No-op check
  if (!isClooksRegistered(settingsDir) && !existsSync(clooksDir)) {
    if (ctx.json) {
      process.stdout.write(
        jsonSuccess('uninstall', {
          scope: 'project',
          unhooked: false,
          deleted: false,
          customHooksDeleted: [],
          eventsRemoved: [],
        }) + '\n',
      )
      return
    }
    printInfo(ctx, 'Nothing to uninstall.')
    return
  }

  // c. Collect decisions
  let shouldUnhook = false
  let shouldDelete = false

  if (opts.force) {
    shouldUnhook = opts.unhook || opts.full || false
    shouldDelete = opts.full || false
  } else {
    // Interactive mode
    if (isClooksRegistered(settingsDir)) {
      shouldUnhook = await promptConfirm(ctx, {
        message: 'Remove Clooks hooks from .claude/settings.json?',
        defaultValue: true,
      })
    }
    if (existsSync(clooksDir)) {
      const customHooks = detectCustomHooks(join(clooksDir, 'hooks'))
      if (customHooks.length > 0) {
        printWarning(
          ctx,
          'The following custom hooks will be permanently deleted:\n' +
            customHooks.map((h) => '  \u2022 ' + h).join('\n'),
        )
      }
      shouldDelete = await promptConfirm(ctx, {
        message: 'Delete .clooks/ directory?',
        defaultValue: false,
      })
    }
  }

  if (!shouldUnhook && !shouldDelete) {
    printInfo(ctx, 'Nothing changed.')
    return
  }

  // d. Execute confirmed actions
  let unhooked = false
  let deleted = false
  let customHooksDeleted: string[] = []
  let eventsRemoved: string[] = []

  if (shouldUnhook) {
    const result = unregisterClooks(settingsDir)
    unhooked = true
    eventsRemoved = result.removed
  }

  // Count remaining non-Clooks hooks
  let nonClooksPreserved = 0
  if (unhooked) {
    const settingsPath = join(settingsDir, 'settings.json')
    if (existsSync(settingsPath)) {
      const settingsContent = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      const remainingHooks = settingsContent.hooks as Record<string, unknown[]> | undefined
      if (remainingHooks) {
        for (const matchers of Object.values(remainingHooks)) {
          if (Array.isArray(matchers)) nonClooksPreserved += matchers.length
        }
      }
    }
  }

  if (shouldDelete) {
    customHooksDeleted = detectCustomHooks(join(clooksDir, 'hooks'))
    rmSync(clooksDir, { recursive: true, force: true })
    deleted = true
  }

  // e. Output
  if (ctx.json) {
    process.stdout.write(
      jsonSuccess('uninstall', {
        scope: 'project',
        unhooked,
        deleted,
        customHooksDeleted,
        eventsRemoved,
        nonClooksPreserved,
      }) + '\n',
    )
    return
  }

  if (unhooked) {
    printSuccess(
      ctx,
      'Removed Clooks hooks from .claude/settings.json (' + eventsRemoved.length + ' events).',
    )
    if (nonClooksPreserved > 0) {
      printInfo(ctx, `${nonClooksPreserved} non-Clooks hook(s) preserved.`)
    }
  }
  if (deleted) {
    printSuccess(ctx, 'Deleted .clooks/ directory.')
    if (customHooksDeleted.length > 0) {
      printWarning(
        ctx,
        'Deleted ' +
          customHooksDeleted.length +
          ' custom hook(s): ' +
          customHooksDeleted.join(', '),
      )
    }
  }

  // Recovery advice
  if (deleted) {
    printInfo(
      ctx,
      'Run `clooks init` to re-initialize. Vendored hooks can be re-added with `clooks add`. Custom hooks in .clooks/hooks/ are gone.',
    )
  } else if (unhooked) {
    printInfo(ctx, 'Run `clooks init` to re-register hooks.')
  }

  // Binary advisory
  printInfo(ctx, 'To also remove the clooks binary: rm $(which clooks)')
}

/**
 * Uninstall Clooks globally (~/.clooks/).
 */
async function uninstallGlobal(
  ctx: OutputContext,
  opts: { force?: boolean; unhook?: boolean; full?: boolean },
): Promise<void> {
  // a. Resolve global root
  const homeRoot = getHomeDir()
  const clooksDir = join(homeRoot, '.clooks')
  const settingsDir = join(homeRoot, '.claude')

  // b. No-op check
  if (!isClooksRegistered(settingsDir) && !existsSync(clooksDir)) {
    if (ctx.json) {
      process.stdout.write(
        jsonSuccess('uninstall', {
          scope: 'global',
          unhooked: false,
          deleted: false,
          customHooksDeleted: [],
          eventsRemoved: [],
        }) + '\n',
      )
      return
    }
    printInfo(ctx, 'Nothing to uninstall.')
    return
  }

  // c. Collect decisions
  let shouldUnhook = false
  let shouldDelete = false

  if (opts.force) {
    shouldUnhook = opts.unhook || opts.full || false
    shouldDelete = opts.full || false
  } else {
    // Interactive mode
    if (isClooksRegistered(settingsDir)) {
      shouldUnhook = await promptConfirm(ctx, {
        message: 'Remove Clooks hooks from ~/.claude/settings.json?',
        defaultValue: true,
      })
    }
    if (existsSync(clooksDir)) {
      const customHooks = detectCustomHooks(join(clooksDir, 'hooks'))
      if (customHooks.length > 0) {
        printWarning(
          ctx,
          'The following custom hooks will be permanently deleted:\n' +
            customHooks.map((h) => '  \u2022 ' + h).join('\n'),
        )
      }
      shouldDelete = await promptConfirm(ctx, {
        message: 'Delete ~/.clooks/ directory?',
        defaultValue: false,
      })
    }
  }

  if (!shouldUnhook && !shouldDelete) {
    printInfo(ctx, 'Nothing changed.')
    return
  }

  // d. Execute confirmed actions
  let unhooked = false
  let deleted = false
  let customHooksDeleted: string[] = []
  let eventsRemoved: string[] = []

  if (shouldUnhook) {
    const result = unregisterClooks(settingsDir)
    unhooked = true
    eventsRemoved = result.removed
  }

  // Count remaining non-Clooks hooks
  let nonClooksPreserved = 0
  if (unhooked) {
    const settingsPath = join(settingsDir, 'settings.json')
    if (existsSync(settingsPath)) {
      const settingsContent = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      const remainingHooks = settingsContent.hooks as Record<string, unknown[]> | undefined
      if (remainingHooks) {
        for (const matchers of Object.values(remainingHooks)) {
          if (Array.isArray(matchers)) nonClooksPreserved += matchers.length
        }
      }
    }
  }

  if (shouldDelete) {
    customHooksDeleted = detectCustomHooks(join(clooksDir, 'hooks'))
    rmSync(clooksDir, { recursive: true, force: true })
    deleted = true
  }

  // e. Output
  if (ctx.json) {
    process.stdout.write(
      jsonSuccess('uninstall', {
        scope: 'global',
        unhooked,
        deleted,
        customHooksDeleted,
        eventsRemoved,
        nonClooksPreserved,
      }) + '\n',
    )
    return
  }

  if (unhooked) {
    printSuccess(
      ctx,
      'Removed Clooks hooks from ~/.claude/settings.json (' + eventsRemoved.length + ' events).',
    )
    if (nonClooksPreserved > 0) {
      printInfo(ctx, `${nonClooksPreserved} non-Clooks hook(s) preserved.`)
    }
  }
  if (deleted) {
    printSuccess(ctx, 'Deleted ~/.clooks/ directory.')
    if (customHooksDeleted.length > 0) {
      printWarning(
        ctx,
        'Deleted ' +
          customHooksDeleted.length +
          ' custom hook(s): ' +
          customHooksDeleted.join(', '),
      )
    }
  }

  // Recovery advice
  if (deleted) {
    printInfo(
      ctx,
      'Run `clooks init --global` to re-initialize. Vendored hooks can be re-added with `clooks add`. Custom hooks in ~/.clooks/hooks/ are gone.',
    )
  } else if (unhooked) {
    printInfo(ctx, 'Run `clooks init --global` to re-register hooks.')
  }

  // Binary advisory
  printInfo(ctx, 'To also remove the clooks binary: rm $(which clooks)')
}

export function createUninstallCommand(): Command {
  return new Command('uninstall')
    .description('Uninstall clooks from this project or globally')
    .option('--project', 'Uninstall from current project')
    .option('--global', 'Uninstall globally (~/.clooks/)')
    .option('--force', 'Skip confirmation prompts (requires explicit scope + action flags)')
    .option('--unhook', 'Only remove from settings.json')
    .option('--full', 'Unhook + delete .clooks/ directory')
    .action(
      async (
        opts: {
          project?: boolean
          global?: boolean
          force?: boolean
          unhook?: boolean
          full?: boolean
        },
        cmd: Command,
      ) => {
        const ctx = getCtx(cmd)
        printIntro(ctx, 'clooks uninstall')

        try {
          // Non-interactive guard
          if (isNonInteractive(ctx) && !opts.force) {
            printError(
              ctx,
              'uninstall',
              'Non-interactive mode requires --force with explicit flags. Example: clooks uninstall --project --full --force',
            )
            process.exit(1)
          }

          // Force validation
          if (opts.force) {
            if (!opts.project && !opts.global) {
              printError(ctx, 'uninstall', 'Specify --project or --global with --force.')
              process.exit(1)
            }
            if (!opts.unhook && !opts.full) {
              printError(ctx, 'uninstall', 'Specify --unhook or --full with --force.')
              process.exit(1)
            }
            if (opts.unhook && opts.full) {
              printError(ctx, 'uninstall', 'Cannot use both --unhook and --full.')
              process.exit(1)
            }
          }

          // Scope conflict
          if (opts.project && opts.global) {
            throw new Error('Cannot use both --project and --global.')
          }

          // Dispatch
          if (opts.project) {
            await uninstallProject(ctx, opts)
          } else if (opts.global) {
            await uninstallGlobal(ctx, opts)
          } else {
            // No scope flag — interactive scope picker
            // Note: non-interactive mode without --force was already caught above
            const scope = await promptSelect(ctx, {
              message: 'What do you want to uninstall?',
              options: [
                { value: 'project' as const, label: 'This project' },
                { value: 'global' as const, label: 'Global (~/.clooks/)' },
                { value: 'both' as const, label: 'Both project and global' },
              ],
            })

            if (scope === 'project' || scope === 'both') {
              await uninstallProject(ctx, opts)
            }
            if (scope === 'global' || scope === 'both') {
              await uninstallGlobal(ctx, opts)
            }
          }

          printOutro(ctx, 'Done.')
        } catch (e) {
          if (e instanceof CancelError) throw e
          printError(ctx, 'uninstall', e instanceof Error ? e.message : String(e))
          process.exit(1)
        }
      },
    )
}
