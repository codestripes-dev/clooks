import { Command } from 'commander'
import { existsSync, rmSync, readdirSync, unlinkSync, lstatSync, rmdirSync } from 'fs'
import { readRegistrationFile, type RegistrationGroup } from '../registration-file.js'
import { dirname, join } from 'path'
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
import {
  unregisterClooks,
  isClooksRegistered as hasClaudeHooks,
  isClooksHook,
} from '../settings.js'
import {
  unregisterCodexClooks,
  isCodexClooksRegistered as hasCodexHooks,
  isCodexClooksHook,
  CODEX_REGISTRATION_EVENTS,
  resolveCodexHome,
} from '../agents/codex/settings.js'
import {
  readCodexReceipt,
  readCodexTrackedHome,
  clearCodexRegistrationState,
} from '../registration-state.js'
import { CLAUDE_CODE_EVENTS } from '../config/constants.js'
import { findProjectRoot } from '../config/discovery.js'
import { getHomeDir } from '../platform.js'
import {
  assertClaudeRegistrationLayout,
  hasOwnedMcpServer,
  mcpRegistrationPath,
  prepareMcpRegistration,
} from '../registration-mcp.js'

const UNINSTALL_AGENTS = ['claude-code', 'codex', 'all'] as const

type UninstallAgent = (typeof UNINSTALL_AGENTS)[number]
type ConcreteUninstallAgent = Exclude<UninstallAgent, 'all'>

function isClooksRegistered(settingsDir: string, global = false): boolean {
  const hooks = hasClaudeHooks(settingsDir)
  const server = hasOwnedMcpServer(
    mcpRegistrationPath(dirname(settingsDir), 'claude-code', global),
    'claude-code',
  )
  return hooks || server
}

function isCodexClooksRegistered(codexDir: string): boolean {
  const hooks = hasCodexHooks(codexDir)
  const server = hasOwnedMcpServer(join(codexDir, 'config.toml'), 'codex')
  return hooks || server
}

function assertRuntimeRemovalRoot(directory: string): void {
  if (lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(
      `Cannot fully uninstall through symbolic link \`${directory}\`; no cleanup was performed.`,
    )
  }
}

/** Never recursively remove the live namespace, even if a new check arrives during cleanup. */
function removeRuntimeDirectory(directory: string): { deleted: boolean; retainedPaths: string[] } {
  const retainedPaths: string[] = []
  const stat = lstatSync(directory, { throwIfNoEntry: false })
  if (!stat) return { deleted: true, retainedPaths }
  if (!stat.isDirectory()) {
    rmSync(directory, { force: true })
    return { deleted: true, retainedPaths }
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.name !== '.cache' || !entry.isDirectory()) {
      rmSync(path, { recursive: true, force: true })
      continue
    }
    for (const cached of readdirSync(path)) {
      const child = join(path, cached)
      if (cached === 'approvals-live') retainedPaths.push(child)
      else rmSync(child, { recursive: true, force: true })
    }
    try {
      rmdirSync(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
      if (!retainedPaths.includes(join(path, 'approvals-live'))) retainedPaths.push(path)
    }
  }
  try {
    rmdirSync(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
    if (retainedPaths.length === 0) retainedPaths.push(directory)
  }
  return { deleted: !lstatSync(directory, { throwIfNoEntry: false }), retainedPaths }
}

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
  const agent = value
  if (typeof agent === 'string' && UNINSTALL_AGENTS.includes(agent as UninstallAgent)) {
    return agent as UninstallAgent
  }

  throw new Error(
    `Invalid --agent value "${String(agent)}". Expected one of: claude-code, codex, all.`,
  )
}

function selectedAgents(agent: UninstallAgent | null): ConcreteUninstallAgent[] {
  return agent === null ? [] : agent === 'all' ? ['claude-code', 'codex'] : [agent]
}

function includesAgent(agent: UninstallAgent | null, target: ConcreteUninstallAgent): boolean {
  return selectedAgents(agent).includes(target)
}

function agentsForAction(
  agent: UninstallAgent | null,
  shouldDelete: boolean,
): ConcreteUninstallAgent[] {
  return shouldDelete ? selectedAgents('all') : selectedAgents(agent)
}

async function resolveUninstallAgent(
  ctx: OutputContext,
  opts: UninstallOptions,
  scope: 'project' | 'global',
  settingsDir: string,
  codexDir: string,
): Promise<UninstallAgent | null> {
  if (opts.agent !== undefined) return parseUninstallAgent(opts.agent)

  const claude = isClooksRegistered(settingsDir, scope === 'global')
  const codex = isCodexClooksRegistered(codexDir)
  if (!claude) return codex ? 'codex' : null
  if (!codex) return 'claude-code'
  if (opts.force || isNonInteractive(ctx)) {
    throw new Error(
      `Both Claude Code and Codex Clooks registrations found in ${scope} scope. Specify --agent claude-code, --agent codex, or --agent all; --force does not select an agent.`,
    )
  }
  return promptSelect(ctx, {
    message: `Which agent registrations do you want to remove in ${scope} scope?`,
    options: [
      { value: 'claude-code' as const, label: 'Claude Code' },
      { value: 'codex' as const, label: 'Codex' },
      { value: 'all' as const, label: 'Both Claude Code and Codex' },
    ],
  })
}

function inspectRegistrations(
  root: string,
  agent: ConcreteUninstallAgent,
  codexHome?: string,
  global = false,
) {
  const path =
    agent === 'codex'
      ? join(codexHome ?? join(root, '.codex'), 'hooks.json')
      : join(root, '.claude/settings.json')
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
  const serverPath = mcpRegistrationPath(root, agent, global, codexHome)
  const serverOwned = hasOwnedMcpServer(serverPath, agent)
  const serverReferenced = Object.values(hooks).some((groups) =>
    (groups as RegistrationGroup[]).some((group) =>
      group.hooks.some((hook) => hook.type === 'mcp_tool' && hook.server === 'clooks'),
    ),
  )
  return { path, events, serverPath, serverOwned, serverReferenced }
}

function assertNoRemainingRegistrations(
  root: string,
  agents: ConcreteUninstallAgent[],
  codexHomes?: string[],
  requireServerRemoval = true,
): void {
  for (const agent of agents) {
    for (const codexHome of agent === 'codex' ? (codexHomes ?? [undefined]) : [undefined]) {
      const { path, events, serverPath, serverOwned } = inspectRegistrations(
        root,
        agent,
        codexHome,
        codexHomes !== undefined,
      )
      if (events.length > 0 || (requireServerRemoval && serverOwned)) {
        throw new Error(
          `Cannot delete shared Clooks directory: ${path} still contains owned hooks on ${events.join(', ')}${serverOwned ? ` or an owned server in ${serverPath}` : ''}. Remove these references and retry.`,
        )
      }
    }
  }
}

function prepareServerRemovals(
  root: string,
  agents: ConcreteUninstallAgent[],
  codexHomes?: string[],
) {
  if (agents.includes('claude-code')) assertClaudeRegistrationLayout(getHomeDir())
  return agents.flatMap((agent) =>
    (agent === 'codex' ? (codexHomes ?? [undefined]) : [undefined]).map((codexHome) => {
      const inspection = inspectRegistrations(root, agent, codexHome, codexHomes !== undefined)
      return {
        agent,
        codexHome,
        registration: prepareMcpRegistration(inspection.serverPath, agent, true),
      }
    }),
  )
}

function removeServers(
  root: string,
  prepared: ReturnType<typeof prepareServerRemovals>,
  global: boolean,
): boolean {
  let removed = false
  for (const { agent, codexHome, registration } of prepared) {
    if (inspectRegistrations(root, agent, codexHome, global).serverReferenced) continue
    registration.commit()
    removed ||= registration.changed
  }
  return removed
}

function globalCodexHomes(homeRoot: string, effectiveHome: string): string[] {
  const tracked = readCodexTrackedHome(homeRoot)
  const receipt = readCodexReceipt(homeRoot)
  if (tracked.kind === 'invalid') {
    throw new Error(tracked.reason)
  }
  if (receipt.kind === 'invalid') {
    throw new Error(receipt.reason)
  }
  const recordedHomes = [
    ...(tracked.kind === 'home' ? [tracked.codexHome] : []),
    ...(receipt.kind === 'receipt' ? [receipt.value.codexHome] : []),
    ...(receipt.kind === 'legacy' ? [resolveCodexHome(homeRoot, {})] : []),
  ]
  if (new Set(recordedHomes).size > 1) {
    throw new Error(
      `Conflicting Codex registration identities in ${join(homeRoot, '.clooks')}: ${recordedHomes.join(', ')}. Repair the records and retry.`,
    )
  }
  return [...new Set([effectiveHome, ...recordedHomes])]
}

async function confirmCleanup(
  ctx: OutputContext,
  root: string,
  agent: UninstallAgent | null,
  opts: UninstallOptions,
  shouldUnhook: boolean,
  shouldDelete: boolean,
  codexHomes?: string[],
): Promise<ConcreteUninstallAgent[] | null> {
  const agents = agentsForAction(agent, shouldDelete)
  const registrations = agents.flatMap((target) =>
    (target === 'codex' ? (codexHomes ?? [undefined]) : [undefined]).map((codexHome) => ({
      agent: target,
      codexHome,
      ...inspectRegistrations(root, target, codexHome, codexHomes !== undefined),
    })),
  )
  if (!shouldDelete) return agents

  const needsConsent =
    registrations.some(
      (registration) =>
        (registration.events.length > 0 || registration.serverOwned) &&
        (!shouldUnhook ||
          !selectedAgents(agent).includes(registration.agent) ||
          (registration.agent === 'codex' && registration.codexHome !== codexHomes?.[0])),
    ) ||
    (codexHomes !== undefined && codexHomes.length > 1)
  if (needsConsent) {
    printInfo(
      ctx,
      'Deleting the shared Clooks directory requires removing all agent registrations that use it.',
    )
    if (
      !opts.force &&
      !(await promptConfirm(ctx, {
        message:
          codexHomes === undefined
            ? 'Remove all Claude Code and Codex Clooks hook registrations before deleting the shared directory?'
            : `Remove all Claude Code and Codex Clooks hook registrations at ${registrations.map((registration) => registration.path).join(', ')} before deleting the shared directory?`,
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

function agentLabel(agent: UninstallAgent | null): string {
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
  const agent = await resolveUninstallAgent(ctx, opts, 'project', settingsDir, codexDir)
  const agents = selectedAgents(agent)
  const initialAgents = agentsForAction(agent, Boolean(opts.force && opts.full))
  if (initialAgents.includes('claude-code')) assertClaudeRegistrationLayout(getHomeDir())
  const hasSelectedClaudeRegistration =
    includesAgent(agent, 'claude-code') && isClooksRegistered(settingsDir)
  const hasSelectedCodexRegistration =
    includesAgent(agent, 'codex') && isCodexClooksRegistered(codexDir)
  const hasActionClaudeRegistration =
    initialAgents.includes('claude-code') && isClooksRegistered(settingsDir)
  const hasActionCodexRegistration =
    initialAgents.includes('codex') && isCodexClooksRegistered(codexDir)

  // b. No-op check
  if (
    (agent === null && !opts.full) ||
    (!hasActionClaudeRegistration && !hasActionCodexRegistration && !existsSync(clooksDir))
  ) {
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
    printInfo(ctx, 'No Clooks hook registrations found in project scope. Nothing to uninstall.')
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
    if (!opts.unhook && existsSync(clooksDir)) {
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

  if (shouldDelete) assertRuntimeRemovalRoot(clooksDir)

  const actionAgents = await confirmCleanup(
    ctx,
    projectRoot,
    agent,
    opts,
    shouldUnhook,
    shouldDelete,
  )
  if (!actionAgents) return

  const serverRemovals = prepareServerRemovals(projectRoot, actionAgents)

  // d. Execute confirmed actions
  let unhooked = false
  let deleted = false
  let customHooksDeleted: string[] = []
  let retainedPaths: string[] = []
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
    unhooked = removeServers(projectRoot, serverRemovals, false) || unhooked
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
    ;({ deleted, retainedPaths } = removeRuntimeDirectory(clooksDir))
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
        ...(retainedPaths.length ? { retainedPaths } : {}),
      }) + '\n',
    )
    return
  }

  if (retainedPaths.length)
    printInfo(ctx, `Preserved approval coordination at ${retainedPaths.join(', ')}.`)
  if (!unhooked && !deleted && retainedPaths.length === 0) {
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
  let codexDir =
    opts.agent !== 'claude-code' || (opts.force && opts.full)
      ? resolveCodexHome(homeRoot, process.env)
      : join(homeRoot, '.codex')
  const agent = await resolveUninstallAgent(ctx, opts, 'global', settingsDir, codexDir)
  const agents = selectedAgents(agent)
  const initialAgents = agentsForAction(agent, Boolean(opts.force && opts.full))
  if (initialAgents.includes('claude-code')) assertClaudeRegistrationLayout(homeRoot)
  const initialCodexHomes = initialAgents.includes('codex')
    ? globalCodexHomes(homeRoot, codexDir)
    : [codexDir]
  const hasSelectedClaudeRegistration =
    includesAgent(agent, 'claude-code') && isClooksRegistered(settingsDir, true)
  const hasSelectedCodexRegistration =
    includesAgent(agent, 'codex') && isCodexClooksRegistered(codexDir)
  const hasActionClaudeRegistration =
    initialAgents.includes('claude-code') && isClooksRegistered(settingsDir, true)
  const hasActionCodexRegistration =
    initialAgents.includes('codex') &&
    (opts.force && opts.full ? initialCodexHomes : [codexDir]).some(isCodexClooksRegistered)

  // b. No-op check
  if (
    (agent === null && !opts.full) ||
    (!hasActionClaudeRegistration && !hasActionCodexRegistration && !existsSync(clooksDir))
  ) {
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
    printInfo(ctx, 'No Clooks hook registrations found in global scope. Nothing to uninstall.')
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
    if (!opts.unhook && existsSync(clooksDir)) {
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

  if (shouldDelete) assertRuntimeRemovalRoot(clooksDir)

  if (shouldDelete) codexDir = resolveCodexHome(homeRoot, process.env)
  const codexHomes = shouldDelete ? globalCodexHomes(homeRoot, codexDir) : [codexDir]
  const actionAgents = await confirmCleanup(
    ctx,
    homeRoot,
    agent,
    opts,
    shouldUnhook,
    shouldDelete,
    codexHomes,
  )
  if (!actionAgents) return

  const serverRemovals = prepareServerRemovals(homeRoot, actionAgents, codexHomes)

  // d. Execute confirmed actions
  let unhooked = false
  let deleted = false
  let customHooksDeleted: string[] = []
  let retainedPaths: string[] = []
  const globalFlagsRemoved: string[] = []
  const counts = emptyCounts()
  const codexRemovals: { path: string; removed: string[] }[] = []

  if (shouldUnhook || shouldDelete) {
    let serversRemoved = false
    if (actionAgents.includes('claude-code')) {
      const result = unregisterClooks(settingsDir)
      counts.claudeEventsRemoved = result.removed
      globalFlagsRemoved.push(...removeGlobalEntrypointFlags(homeRoot, ['claude-code']))
      serversRemoved = removeServers(
        homeRoot,
        serverRemovals.filter((item) => item.agent === 'claude-code'),
        true,
      )
    }
    if (actionAgents.includes('codex')) {
      const removedEvents = new Set<string>()
      for (const codexHome of codexHomes) {
        const result = unregisterCodexClooks(codexHome)
        codexRemovals.push({ path: join(codexHome, 'hooks.json'), removed: result.removed })
        for (const event of result.removed) removedEvents.add(event)
      }
      counts.codexEventsRemoved = CODEX_REGISTRATION_EVENTS.filter((event) =>
        removedEvents.has(event),
      )
      serversRemoved =
        removeServers(
          homeRoot,
          serverRemovals.filter((item) => item.agent === 'codex'),
          true,
        ) || serversRemoved
    }
    if (actionAgents.includes('codex'))
      for (const codexHome of codexHomes) {
        assertNoRemainingRegistrations(homeRoot, ['codex'], [codexHome], false)
        // A retained shared server still needs its recorded home for a later cleanup.
        if (hasOwnedMcpServer(join(codexHome, 'config.toml'), 'codex')) continue
        if (
          clearCodexRegistrationState(homeRoot, codexHome) &&
          !globalFlagsRemoved.includes('codex')
        )
          globalFlagsRemoved.push('codex')
      }
    unhooked =
      serversRemoved ||
      counts.claudeEventsRemoved.length > 0 ||
      counts.codexEventsRemoved.length > 0 ||
      globalFlagsRemoved.length > 0
  }

  if (actionAgents.includes('claude-code')) {
    counts.claudeNonClooksPreserved = countClaudeMatcherGroups(settingsDir)
  }
  if (actionAgents.includes('codex')) {
    counts.codexNonClooksPreserved = codexHomes.reduce(
      (count, home) => count + countCodexMatcherGroups(home),
      0,
    )
  }

  if (shouldDelete) {
    assertNoRemainingRegistrations(homeRoot, actionAgents, codexHomes)
    customHooksDeleted = detectCustomHooks(join(clooksDir, 'hooks'))
    ;({ deleted, retainedPaths } = removeRuntimeDirectory(clooksDir))
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
        ...(retainedPaths.length ? { retainedPaths } : {}),
      }) + '\n',
    )
    return
  }

  if (retainedPaths.length)
    printInfo(ctx, `Preserved approval coordination at ${retainedPaths.join(', ')}.`)
  if (!unhooked && !deleted && retainedPaths.length === 0) {
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
      for (const removal of codexRemovals) {
        if (removal.removed.length > 0) {
          printSuccess(
            ctx,
            `Removed Clooks hooks from ${removal.path} (${removal.removed.length} events).`,
          )
        }
      }
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
    .option('--unhook', 'Only remove agent hook registrations; keep .clooks/')
    .option('--full', 'Unhook + delete .clooks/ directory')
    .option(
      '--agent <agent>',
      'Agent registration to remove: claude-code, codex, or all (auto-detect when omitted)',
    )
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
          if (opts.agent !== undefined) parseUninstallAgent(opts.agent)

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
          }

          if (opts.unhook && opts.full) {
            throw new Error('Cannot use both --unhook and --full.')
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
