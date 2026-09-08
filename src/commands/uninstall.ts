import { Command } from 'commander'
import { existsSync, rmSync, readdirSync, unlinkSync } from 'fs'
import { readRegistrationFile, type RegistrationGroup } from '../registration-file.js'
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
import { unregisterClooks, isClooksRegistered, isClooksHook } from '../settings.js'
import {
  unregisterCodexClooks,
  isCodexClooksRegistered,
  isCodexClooksHook,
  CODEX_REGISTRATION_EVENTS,
} from '../agents/codex/settings.js'
import { CLAUDE_CODE_EVENTS } from '../config/constants.js'
import { findProjectRoot } from '../config/discovery.js'
import { getHomeDir } from '../platform.js'

const UNINSTALL_AGENTS = ['claude-code', 'codex', 'all'] as const

type UninstallAgent = (typeof UNINSTALL_AGENTS)[number]
type ConcreteUninstallAgent = Exclude<UninstallAgent, 'all'>

interface AgentUninstallCounts {
  claudeEventsRemoved: string[]
  codexEventsRemoved: string[]
  claudeNonClooksPreserved: number
  codexNonClooksPreserved: number
}

interface UninstallOptions {
  force?: boolean
  unhook?: boolean
  full?: boolean
  agent?: string
}

function parseUninstallAgent(value: unknown): UninstallAgent {
  const agent = value ?? 'claude-code'
  if (typeof agent === 'string' && UNINSTALL_AGENTS.includes(agent as UninstallAgent)) {
    return agent as UninstallAgent
  }

  throw new Error(
    `Invalid --agent value "${String(agent)}". Expected one of: claude-code, codex, all.`,
  )
}

function selectedAgents(agent: UninstallAgent): ConcreteUninstallAgent[] {
  return agent === 'all' ? ['claude-code', 'codex'] : [agent]
}

function includesAgent(agent: UninstallAgent, target: ConcreteUninstallAgent): boolean {
  return selectedAgents(agent).includes(target)
}

function agentsForAction(agent: UninstallAgent, shouldDelete: boolean): ConcreteUninstallAgent[] {
  return shouldDelete ? selectedAgents('all') : selectedAgents(agent)
}

function inspectRegistrations(root: string, agent: ConcreteUninstallAgent) {
  const path = join(root, agent === 'codex' ? '.codex/hooks.json' : '.claude/settings.json')
  const { hooks } = readRegistrationFile(path)
  const events = Object.entries(hooks)
    .filter(([, groups]) =>
      (groups as RegistrationGroup[]).some((group) =>
        group.hooks.some((hook) =>
          agent === 'codex'
            ? isCodexClooksHook(hook)
            : isClooksHook(hook, join(root, '.clooks/bin/entrypoint.sh')),
        ),
      ),
    )
    .map(([event]) => event)
  return { path, events }
}

function assertNoRemainingRegistrations(root: string, agents: ConcreteUninstallAgent[]): void {
  for (const agent of agents) {
    const { path, events } = inspectRegistrations(root, agent)
    if (events.length > 0) {
      throw new Error(
        `Cannot delete shared Clooks directory: ${path} still contains owned hooks on ${events.join(', ')}. Remove these references and retry.`,
      )
    }
  }
}

async function confirmCleanup(
  ctx: OutputContext,
  root: string,
  agent: UninstallAgent,
  opts: UninstallOptions,
  shouldUnhook: boolean,
  shouldDelete: boolean,
): Promise<ConcreteUninstallAgent[] | null> {
  const agents = agentsForAction(agent, shouldDelete)
  const registrations = agents.map((target) => ({
    agent: target,
    ...inspectRegistrations(root, target),
  }))
  if (!shouldDelete) return agents

  const needsConsent = registrations.some(
    (registration) =>
      registration.events.length > 0 &&
      (!shouldUnhook || !selectedAgents(agent).includes(registration.agent)),
  )
  if (needsConsent) {
    printInfo(
      ctx,
      'Deleting the shared Clooks directory requires removing all agent registrations that use it.',
    )
    if (
      !opts.force &&
      !(await promptConfirm(ctx, {
        message:
          'Remove all Claude Code and Codex Clooks hook registrations before deleting the shared directory?',
        defaultValue: false,
      }))
    ) {
      printInfo(ctx, `Nothing changed in ${root}.`)
      return null
    }
  }

  for (const registration of registrations) {
    const supported: readonly string[] =
      registration.agent === 'codex' ? CODEX_REGISTRATION_EVENTS : [...CLAUDE_CODE_EVENTS]
    const unknown = registration.events.filter((event) => !supported.includes(event))
    if (unknown.length > 0) {
      throw new Error(
        `Cannot delete shared Clooks directory: ${registration.path} contains owned hooks on unsupported events ${unknown.join(', ')}. Remove these references and retry.`,
      )
    }
  }
  return agents
}

function agentLabel(agent: UninstallAgent): string {
  if (agent === 'claude-code') return 'Claude Code'
  if (agent === 'codex') return 'Codex'
  return 'Claude Code and Codex'
}

function globalEntrypointFlagPath(homeRoot: string, agent: ConcreteUninstallAgent): string {
  const flagName =
    agent === 'claude-code' ? '.global-entrypoint-active' : `.global-entrypoint-active.${agent}`
  return join(homeRoot, '.clooks', flagName)
}

function removeGlobalEntrypointFlags(homeRoot: string, agents: ConcreteUninstallAgent[]): string[] {
  const removed: string[] = []

  for (const agent of agents) {
    const flagPath = globalEntrypointFlagPath(homeRoot, agent)
    if (existsSync(flagPath)) {
      unlinkSync(flagPath)
      removed.push(agent)
    }
  }

  return removed
}

function countClaudeMatcherGroups(settingsDir: string): number {
  const settingsPath = join(settingsDir, 'settings.json')
  const { hooks: remainingHooks } = readRegistrationFile(settingsPath)

  let count = 0
  for (const matchers of Object.values(remainingHooks)) {
    if (Array.isArray(matchers)) count += matchers.length
  }
  return count
}

function countCodexMatcherGroups(codexDir: string): number {
  const hooksPath = join(codexDir, 'hooks.json')
  const { hooks } = readRegistrationFile(hooksPath)

  let count = 0
  for (const matchers of Object.values(hooks)) {
    if (Array.isArray(matchers)) count += matchers.length
  }
  return count
}

function emptyCounts(): AgentUninstallCounts {
  return {
    claudeEventsRemoved: [],
    codexEventsRemoved: [],
    claudeNonClooksPreserved: 0,
    codexNonClooksPreserved: 0,
  }
}

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
  opts: UninstallOptions,
  findRoot: () => Promise<string>,
): Promise<void> {
  // a. Resolve project root
  const projectRoot = await findRoot()
  const clooksDir = join(projectRoot, '.clooks')
  const settingsDir = join(projectRoot, '.claude')
  const codexDir = join(projectRoot, '.codex')
  const agent = parseUninstallAgent(opts.agent)
  const agents = selectedAgents(agent)
  const initialAgents = agentsForAction(agent, Boolean(opts.force && opts.full))
  const hasSelectedClaudeRegistration =
    includesAgent(agent, 'claude-code') && isClooksRegistered(settingsDir)
  const hasSelectedCodexRegistration =
    includesAgent(agent, 'codex') && isCodexClooksRegistered(codexDir)
  const hasActionClaudeRegistration =
    initialAgents.includes('claude-code') && isClooksRegistered(settingsDir)
  const hasActionCodexRegistration =
    initialAgents.includes('codex') && isCodexClooksRegistered(codexDir)

  // b. No-op check
  if (!hasActionClaudeRegistration && !hasActionCodexRegistration && !existsSync(clooksDir)) {
    if (ctx.json) {
      process.stdout.write(
        jsonSuccess('uninstall', {
          scope: 'project',
          agent,
          agents,
          unhooked: false,
          deleted: false,
          customHooksDeleted: [],
          eventsRemoved: [],
          claudeEventsRemoved: [],
          codexEventsRemoved: [],
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
    if (hasSelectedClaudeRegistration || hasSelectedCodexRegistration) {
      shouldUnhook = await promptConfirm(ctx, {
        message: `Remove ${agentLabel(agent)} Clooks hook registrations?`,
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
    printInfo(ctx, 'Nothing changed in project scope.')
    return
  }

  const actionAgents = await confirmCleanup(
    ctx,
    projectRoot,
    agent,
    opts,
    shouldUnhook,
    shouldDelete,
  )
  if (!actionAgents) return

  // d. Execute confirmed actions
  let unhooked = false
  let deleted = false
  let customHooksDeleted: string[] = []
  const counts = emptyCounts()

  if (shouldUnhook || shouldDelete) {
    if (actionAgents.includes('claude-code')) {
      const result = unregisterClooks(settingsDir)
      counts.claudeEventsRemoved = result.removed
    }
    if (actionAgents.includes('codex')) {
      const result = unregisterCodexClooks(codexDir)
      counts.codexEventsRemoved = result.removed
    }
    unhooked = counts.claudeEventsRemoved.length > 0 || counts.codexEventsRemoved.length > 0
  }

  if (actionAgents.includes('claude-code')) {
    counts.claudeNonClooksPreserved = countClaudeMatcherGroups(settingsDir)
  }
  if (actionAgents.includes('codex')) {
    counts.codexNonClooksPreserved = countCodexMatcherGroups(codexDir)
  }

  if (shouldDelete) {
    assertNoRemainingRegistrations(projectRoot, actionAgents)
    customHooksDeleted = detectCustomHooks(join(clooksDir, 'hooks'))
    rmSync(clooksDir, { recursive: true, force: true })
    deleted = true
  }

  // e. Output
  if (ctx.json) {
    process.stdout.write(
      jsonSuccess('uninstall', {
        scope: 'project',
        agent,
        agents,
        unhooked,
        deleted,
        customHooksDeleted,
        eventsRemoved: counts.claudeEventsRemoved,
        nonClooksPreserved: counts.claudeNonClooksPreserved,
        claudeEventsRemoved: counts.claudeEventsRemoved,
        codexEventsRemoved: counts.codexEventsRemoved,
        claudeNonClooksPreserved: counts.claudeNonClooksPreserved,
        codexNonClooksPreserved: counts.codexNonClooksPreserved,
      }) + '\n',
    )
    return
  }

  if (!unhooked && !deleted) {
    printInfo(ctx, `No ${agentLabel(agent)} Clooks hook registrations found. Nothing changed.`)
    return
  }

  if (unhooked) {
    if (counts.claudeEventsRemoved.length > 0) {
      printSuccess(
        ctx,
        'Removed Clooks hooks from .claude/settings.json (' +
          counts.claudeEventsRemoved.length +
          ' events).',
      )
      if (counts.claudeNonClooksPreserved > 0) {
        printInfo(ctx, `${counts.claudeNonClooksPreserved} Claude non-Clooks hook(s) preserved.`)
      }
    }
    if (counts.codexEventsRemoved.length > 0) {
      printSuccess(
        ctx,
        'Removed Clooks hooks from .codex/hooks.json (' +
          counts.codexEventsRemoved.length +
          ' events).',
      )
      if (counts.codexNonClooksPreserved > 0) {
        printInfo(ctx, `${counts.codexNonClooksPreserved} Codex non-Clooks hook(s) preserved.`)
      }
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
async function uninstallGlobal(ctx: OutputContext, opts: UninstallOptions): Promise<void> {
  // a. Resolve global root
  const homeRoot = getHomeDir()
  const clooksDir = join(homeRoot, '.clooks')
  const settingsDir = join(homeRoot, '.claude')
  const codexDir = join(homeRoot, '.codex')
  const agent = parseUninstallAgent(opts.agent)
  const agents = selectedAgents(agent)
  const initialAgents = agentsForAction(agent, Boolean(opts.force && opts.full))
  const hasSelectedClaudeRegistration =
    includesAgent(agent, 'claude-code') && isClooksRegistered(settingsDir)
  const hasSelectedCodexRegistration =
    includesAgent(agent, 'codex') && isCodexClooksRegistered(codexDir)
  const hasActionClaudeRegistration =
    initialAgents.includes('claude-code') && isClooksRegistered(settingsDir)
  const hasActionCodexRegistration =
    initialAgents.includes('codex') && isCodexClooksRegistered(codexDir)

  // b. No-op check
  if (!hasActionClaudeRegistration && !hasActionCodexRegistration && !existsSync(clooksDir)) {
    if (ctx.json) {
      process.stdout.write(
        jsonSuccess('uninstall', {
          scope: 'global',
          agent,
          agents,
          unhooked: false,
          deleted: false,
          customHooksDeleted: [],
          eventsRemoved: [],
          claudeEventsRemoved: [],
          codexEventsRemoved: [],
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
    if (hasSelectedClaudeRegistration || hasSelectedCodexRegistration) {
      shouldUnhook = await promptConfirm(ctx, {
        message: `Remove ${agentLabel(agent)} global Clooks hook registrations?`,
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
    printInfo(ctx, 'Nothing changed in global scope.')
    return
  }

  const actionAgents = await confirmCleanup(ctx, homeRoot, agent, opts, shouldUnhook, shouldDelete)
  if (!actionAgents) return

  // d. Execute confirmed actions
  let unhooked = false
  let deleted = false
  let customHooksDeleted: string[] = []
  const globalFlagsRemoved: string[] = []
  const counts = emptyCounts()

  if (shouldUnhook || shouldDelete) {
    if (actionAgents.includes('claude-code')) {
      const result = unregisterClooks(settingsDir)
      counts.claudeEventsRemoved = result.removed
      globalFlagsRemoved.push(...removeGlobalEntrypointFlags(homeRoot, ['claude-code']))
    }
    if (actionAgents.includes('codex')) {
      const result = unregisterCodexClooks(codexDir)
      counts.codexEventsRemoved = result.removed
      globalFlagsRemoved.push(...removeGlobalEntrypointFlags(homeRoot, ['codex']))
    }
    unhooked =
      counts.claudeEventsRemoved.length > 0 ||
      counts.codexEventsRemoved.length > 0 ||
      globalFlagsRemoved.length > 0
  }

  if (actionAgents.includes('claude-code')) {
    counts.claudeNonClooksPreserved = countClaudeMatcherGroups(settingsDir)
  }
  if (actionAgents.includes('codex')) {
    counts.codexNonClooksPreserved = countCodexMatcherGroups(codexDir)
  }

  if (shouldDelete) {
    assertNoRemainingRegistrations(homeRoot, actionAgents)
    customHooksDeleted = detectCustomHooks(join(clooksDir, 'hooks'))
    rmSync(clooksDir, { recursive: true, force: true })
    deleted = true
  }

  // e. Output
  if (ctx.json) {
    process.stdout.write(
      jsonSuccess('uninstall', {
        scope: 'global',
        agent,
        agents,
        unhooked,
        deleted,
        customHooksDeleted,
        eventsRemoved: counts.claudeEventsRemoved,
        nonClooksPreserved: counts.claudeNonClooksPreserved,
        claudeEventsRemoved: counts.claudeEventsRemoved,
        codexEventsRemoved: counts.codexEventsRemoved,
        claudeNonClooksPreserved: counts.claudeNonClooksPreserved,
        codexNonClooksPreserved: counts.codexNonClooksPreserved,
        globalFlagsRemoved,
      }) + '\n',
    )
    return
  }

  if (!unhooked && !deleted) {
    printInfo(
      ctx,
      `No ${agentLabel(agent)} global Clooks hook registrations found. Nothing changed.`,
    )
    return
  }

  if (unhooked) {
    if (counts.claudeEventsRemoved.length > 0) {
      printSuccess(
        ctx,
        'Removed Clooks hooks from ~/.claude/settings.json (' +
          counts.claudeEventsRemoved.length +
          ' events).',
      )
      if (counts.claudeNonClooksPreserved > 0) {
        printInfo(ctx, `${counts.claudeNonClooksPreserved} Claude non-Clooks hook(s) preserved.`)
      }
    }
    if (counts.codexEventsRemoved.length > 0) {
      printSuccess(
        ctx,
        'Removed Clooks hooks from ~/.codex/hooks.json (' +
          counts.codexEventsRemoved.length +
          ' events).',
      )
      if (counts.codexNonClooksPreserved > 0) {
        printInfo(ctx, `${counts.codexNonClooksPreserved} Codex non-Clooks hook(s) preserved.`)
      }
    }
    if (globalFlagsRemoved.length > 0) {
      printInfo(ctx, `Removed ${globalFlagsRemoved.length} global entrypoint flag(s).`)
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

export function createUninstallCommand(findRoot: () => Promise<string> = findProjectRoot): Command {
  return new Command('uninstall')
    .description('Uninstall clooks from this project or globally')
    .option('--project', 'Uninstall from current project')
    .option('--global', 'Uninstall globally (~/.clooks/)')
    .option('--force', 'Skip confirmation prompts (requires explicit scope + action flags)')
    .option('--unhook', 'Only remove from settings.json')
    .option('--full', 'Unhook + delete .clooks/ directory')
    .option('--agent <agent>', 'Agent registration to remove: claude-code, codex, or all')
    .action(
      async (
        opts: UninstallOptions & {
          project?: boolean
          global?: boolean
        },
        cmd: Command,
      ) => {
        const ctx = getCtx(cmd)
        printIntro(ctx, 'clooks uninstall')

        try {
          parseUninstallAgent(opts.agent)

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
            await uninstallProject(ctx, opts, findRoot)
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
              await uninstallProject(ctx, opts, findRoot)
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
