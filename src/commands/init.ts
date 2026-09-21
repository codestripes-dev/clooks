import { Command } from 'commander'
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, unlinkSync } from 'fs'
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
import { promptConfirm, isNonInteractive } from '../tui/prompts.js'
import { registerClooks, CLOOKS_ENTRYPOINT_PATH } from '../settings.js'
import {
  makeCodexGlobalEntrypointCommand,
  makeCodexProjectEntrypointCommand,
  registerCodexClooks,
  resolveCodexHome,
  quotePosixSingleArg,
} from '../agents/codex/settings.js'
import {
  readCodexReceipt,
  readCodexTrackedHome,
  trackCodexHome,
  publishCodexReceipt,
} from '../registration-state.js'
import { ENTRYPOINT_SCRIPT, GLOBAL_ENTRYPOINT_SCRIPT } from './init-entrypoint.js'
import { prepareInitRegistrations } from './init-registration.js'
import { VERSION } from '../version.js'
import type { InstallationStatus, RepairCommand, ScopeStatus } from '../installation-status.js'
import {
  CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND,
  makeClaudeGlobalRuntimeAdvisoryCommand,
  makeCodexGlobalRuntimeAdvisoryCommand,
  makeCodexProjectRuntimeAdvisoryCommand,
  registerRuntimeAdvisory,
  RUNTIME_ADVISORY_RELATIVE_PATH,
} from '../registration-advisory.js'
import EMBEDDED_TYPES_DTS from '../generated/clooks-types.d.ts.txt' with { type: 'text' }
import _EMBEDDED_SCHEMA from '../../schemas/clooks.schema.json' with { type: 'text' }
const EMBEDDED_SCHEMA = _EMBEDDED_SCHEMA as unknown as string
const STARTER_CONFIG =
  '# yaml-language-server: $schema=./clooks.schema.json\nversion: "1.0.0"\n\nconfig: {}\n'

const GITIGNORE_LINES = ['# Clooks', 'clooks.local.yml', '.clooks/.cache/', '.clooks/.failures']
const INIT_AGENTS = ['claude-code', 'codex', 'all'] as const

type InitAgent = (typeof INIT_AGENTS)[number]
type ConcreteInitAgent = Exclude<InitAgent, 'all'>

function parseInitAgent(value: unknown): InitAgent {
  const agent = value ?? 'claude-code'
  if (typeof agent === 'string' && INIT_AGENTS.includes(agent as InitAgent)) {
    return agent as InitAgent
  }

  throw new Error(
    `Invalid --agent value "${String(agent)}". Expected one of: claude-code, codex, all.`,
  )
}

function selectedAgents(agent: InitAgent): ConcreteInitAgent[] {
  return agent === 'all' ? ['claude-code', 'codex'] : [agent]
}

function includesAgent(agent: InitAgent, target: ConcreteInitAgent): boolean {
  return selectedAgents(agent).includes(target)
}

function formatRepairCommand(repair: RepairCommand): string {
  const env = Object.entries(repair.env).map(
    ([name, value]) => `${name}=${quotePosixSingleArg(value)}`,
  )
  return [
    ...env,
    quotePosixSingleArg(repair.executable),
    ...repair.args.map(quotePosixSingleArg),
  ].join(' ')
}

function scopeSummary(status: ScopeStatus): string {
  const agents = status.agents.length > 0 ? status.agents.join(', ') : 'no registered agents'
  const needs = [
    ...(status.needsBinaryUpdate ? ['binary update'] : []),
    ...(status.needsIntegrationRefresh ? ['integration refresh'] : []),
  ]
  return `${status.scope} ${status.root}: ${status.state} (${agents})${needs.length > 0 ? `; needs ${needs.join(' and ')}` : ''}`
}

function printInstallationStatus(cmd: Command, status: InstallationStatus): void {
  const ctx = getCtx(cmd)
  if (ctx.json) {
    process.stdout.write(jsonSuccess('init', status) + '\n')
    return
  }

  printIntro(ctx, 'clooks init --check')
  if (status.scopes.length === 0) {
    printInfo(ctx, 'No matching installation scopes found.')
  }
  for (const scope of status.scopes) {
    if ((scope.state === 'current' || scope.state === 'absent') && !scope.needsBinaryUpdate) {
      printSuccess(ctx, scopeSummary(scope))
    } else {
      printWarning(ctx, scopeSummary(scope))
    }
    for (const diagnostic of scope.diagnostics) printInfo(ctx, diagnostic)
    if (scope.repair) {
      printInfo(
        ctx,
        `Repair from ${quotePosixSingleArg(scope.repair.cwd)}: ${formatRepairCommand(scope.repair)}`,
      )
    }
  }
  printOutro(ctx, `Selected runtime: ${status.binaryVersion}`)
}

async function checkInstallation(
  cmd: Command,
  options: { global?: boolean; agent?: string },
): Promise<void> {
  const ctx = getCtx(cmd)
  try {
    const agent = options.agent === undefined ? undefined : parseInitAgent(options.agent)
    const agents = agent === undefined ? undefined : selectedAgents(agent)
    const installationHome = os.homedir()
    if (installationHome === '/') {
      throw new Error(
        'Refusing to inspect global hooks: home directory resolves to filesystem root (/).',
      )
    }
    const discovery = options.global
      ? undefined
      : await (
          await import('../config/discovery.js')
        ).discoverProjectRoot({
          cwd: process.cwd(),
          env: process.env,
          homeRoot: installationHome,
        })
    const { inspectInstallation } = await import('../installation-status.js')
    const status = inspectInstallation({
      ...(discovery ? { projectRoot: discovery.projectRoot } : {}),
      installationHome,
      executable: process.execPath,
      binaryVersion: VERSION,
      env: process.env,
      scopes: options.global ? ['global'] : ['project', 'global'],
      ...(agents ? { agents } : {}),
    })
    printInstallationStatus(cmd, status)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    printError(ctx, 'init', message)
    process.exit(1)
  }
}

async function assertInitLauncherRefreshAllowed(
  root: string,
  expectedScope: 'project' | 'global',
): Promise<void> {
  const { assertLauncherRefreshAllowed } = await import('../installation-status.js')
  assertLauncherRefreshAllowed({
    launcherPath: join(root, '.clooks', 'bin', 'entrypoint.sh'),
    advisoryPath: join(root, RUNTIME_ADVISORY_RELATIVE_PATH),
    expectedScope,
    runtimeVersion: VERSION,
  })
}

function printCodexTrustWarning(ctx: ReturnType<typeof getCtx>): void {
  printWarning(
    ctx,
    'Review Codex hook changes before trusting this project; Codex may require hook review before project hooks run.',
  )
}

function printCodexSkippedRegistrations(ctx: ReturnType<typeof getCtx>, skipped: string[]): void {
  for (const item of skipped) {
    if (item.includes('hooks.json')) {
      printInfo(ctx, `Skipped ${item}`)
    }
  }
}

function globalEntrypointFlagPath(homeRoot: string, agent: ConcreteInitAgent): string {
  const flagName =
    agent === 'claude-code' ? '.global-entrypoint-active' : `.global-entrypoint-active.${agent}`
  return join(homeRoot, '.clooks', flagName)
}

function globalEntrypointFlagLabel(agent: ConcreteInitAgent): string {
  return agent === 'claude-code'
    ? '~/.clooks/.global-entrypoint-active'
    : `~/.clooks/.global-entrypoint-active.${agent}`
}

function recordAdvisoryOnlyRegistrationUpdate(
  label: string,
  runtimeChanged: boolean,
  advisoryChanged: boolean,
  skipped: string[],
  updated: string[],
): void {
  if (runtimeChanged || !advisoryChanged) return
  const skippedIndex = skipped.lastIndexOf(label)
  if (skippedIndex !== -1) skipped.splice(skippedIndex, 1)
  updated.push(`${label} (SessionStart advisory)`)
}

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

/**
 * Initialize global hooks at ~/.clooks/.
 */
async function initGlobal(cmd: Command, agent: InitAgent): Promise<void> {
  const ctx = getCtx(cmd)

  try {
    const homeRoot = os.homedir()

    // -- Filesystem root guardrail still applies --
    if (homeRoot === '/') {
      const message =
        'Refusing to initialize global hooks: home directory resolves to filesystem root (/).'
      printError(ctx, 'init', message)
      process.exit(1)
    }

    await assertInitLauncherRefreshAllowed(homeRoot, 'global')

    // Identity preflight must precede even shared runtime and Claude writes.
    const codexHome = includesAgent(agent, 'codex')
      ? resolveCodexHome(homeRoot, process.env)
      : undefined
    const prepared = prepareInitRegistrations(
      homeRoot,
      homeRoot,
      selectedAgents(agent),
      true,
      codexHome,
    )
    const { GLOBAL_RUNTIME_ADVISORY_SCRIPT } = await import('./init-advisory.js')
    let previousReceipt: string | undefined
    if (codexHome !== undefined) {
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
      for (const recordedHome of recordedHomes) {
        if (recordedHome !== codexHome) {
          throw new Error(
            `Codex registration still records ${recordedHome}. Unhook that home with CODEX_HOME=${quotePosixSingleArg(recordedHome)} before initializing ${codexHome}.`,
          )
        }
      }
      const receiptPath = globalEntrypointFlagPath(homeRoot, 'codex')
      if (receipt.kind !== 'missing') previousReceipt = readFileSync(receiptPath, 'utf-8')
      // Retain cleanup identity before retiring suppression. Repairing the launcher
      // must not make an old receipt newly eligible if registration later fails.
      trackCodexHome(homeRoot, codexHome)
      if (receipt.kind !== 'missing') unlinkSync(receiptPath)
    }

    // -- Track what we create/skip/update --
    const created: string[] = []
    const skipped: string[] = []
    const updated: string[] = []

    // -- Step 1: Create directories --
    const dirs = ['.clooks', '.clooks/hooks', '.clooks/bin', '.clooks/vendor']
    for (const dir of dirs) {
      mkdirSync(join(homeRoot, dir), { recursive: true })
    }

    // -- Write types.d.ts (always) --
    const typesPath = join(homeRoot, '.clooks', 'hooks', 'types.d.ts')
    const typesExisted = existsSync(typesPath)
    let typesChanged = !typesExisted
    if (typesExisted) {
      const existing = readFileSync(typesPath, 'utf-8')
      typesChanged = existing !== EMBEDDED_TYPES_DTS
    }
    writeFileSync(typesPath, EMBEDDED_TYPES_DTS)
    if (!typesExisted) {
      created.push('~/.clooks/hooks/types.d.ts')
    } else if (typesChanged) {
      updated.push('~/.clooks/hooks/types.d.ts')
    } else {
      skipped.push('~/.clooks/hooks/types.d.ts')
    }

    // -- Write clooks.schema.json (always) --
    const schemaPath = join(homeRoot, '.clooks', 'clooks.schema.json')
    const schemaExisted = existsSync(schemaPath)
    let schemaChanged = !schemaExisted
    if (schemaExisted) {
      const existing = readFileSync(schemaPath, 'utf-8')
      schemaChanged = existing !== EMBEDDED_SCHEMA
    }
    writeFileSync(schemaPath, EMBEDDED_SCHEMA)
    if (!schemaExisted) {
      created.push('~/.clooks/clooks.schema.json')
    } else if (schemaChanged) {
      updated.push('~/.clooks/clooks.schema.json')
    } else {
      skipped.push('~/.clooks/clooks.schema.json')
    }

    // -- Step 2: Write clooks.yml (only if missing) --
    const configPath = join(homeRoot, '.clooks', 'clooks.yml')
    if (existsSync(configPath)) {
      skipped.push('~/.clooks/clooks.yml')
    } else {
      writeFileSync(configPath, STARTER_CONFIG)
      created.push('~/.clooks/clooks.yml')
    }

    // -- Step 3: Write global entrypoint script (always) --
    const entrypointPath = join(homeRoot, '.clooks', 'bin', 'entrypoint.sh')
    const entrypointExisted = existsSync(entrypointPath)
    let entrypointChanged = !entrypointExisted
    if (entrypointExisted) {
      const existing = readFileSync(entrypointPath, 'utf-8')
      entrypointChanged = existing !== GLOBAL_ENTRYPOINT_SCRIPT
    }
    writeFileSync(entrypointPath, GLOBAL_ENTRYPOINT_SCRIPT)
    chmodSync(entrypointPath, 0o755)
    if (!entrypointExisted) {
      created.push('~/.clooks/bin/entrypoint.sh')
    } else if (entrypointChanged) {
      updated.push('~/.clooks/bin/entrypoint.sh')
    } else {
      skipped.push('~/.clooks/bin/entrypoint.sh')
    }

    const advisoryPath = join(homeRoot, RUNTIME_ADVISORY_RELATIVE_PATH)
    const advisoryExisted = existsSync(advisoryPath)
    const advisoryChanged =
      !advisoryExisted || readFileSync(advisoryPath, 'utf-8') !== GLOBAL_RUNTIME_ADVISORY_SCRIPT
    writeFileSync(advisoryPath, GLOBAL_RUNTIME_ADVISORY_SCRIPT)
    chmodSync(advisoryPath, 0o755)
    if (!advisoryExisted) {
      created.push('~/.clooks/bin/runtime-advisory.sh')
    } else if (advisoryChanged) {
      updated.push('~/.clooks/bin/runtime-advisory.sh')
    } else {
      skipped.push('~/.clooks/bin/runtime-advisory.sh')
    }

    // -- Register selected agents, then publish their successful state --
    if (includesAgent(agent, 'claude-code')) {
      const globalEntrypointCommand = join(homeRoot, '.clooks/bin/entrypoint.sh')
      const settingsDir = join(homeRoot, '.claude')
      const server = prepared.servers.get('claude-code')!
      server.commit()
      ;(server.changed ? (server.created ? created : updated) : skipped).push('~/.claude.json')
      const regResult = registerClooks(settingsDir, globalEntrypointCommand, {
        owner: 'global',
        command: quotePosixSingleArg(globalEntrypointCommand),
      })
      const advisoryResult = registerRuntimeAdvisory(
        settingsDir,
        'claude-code',
        makeClaudeGlobalRuntimeAdvisoryCommand(homeRoot),
      )
      const flagPath = globalEntrypointFlagPath(homeRoot, 'claude-code')
      const flagLabel = globalEntrypointFlagLabel('claude-code')
      if (!existsSync(flagPath)) {
        writeFileSync(flagPath, '')
        created.push(flagLabel)
      } else {
        skipped.push(flagLabel)
      }
      const totalEvents =
        regResult.added.length + regResult.updated.length + regResult.skipped.length
      if (regResult.added.length > 0 || regResult.updated.length > 0) {
        if (regResult.created) {
          created.push(`~/.claude/settings.json (${totalEvents} events)`)
        } else {
          updated.push(
            `~/.claude/settings.json (${regResult.added.length} added, ${regResult.updated.length} updated)`,
          )
        }
      } else {
        skipped.push('~/.claude/settings.json')
      }
      recordAdvisoryOnlyRegistrationUpdate(
        '~/.claude/settings.json',
        regResult.added.length > 0 || regResult.updated.length > 0,
        advisoryResult.added || advisoryResult.updated,
        skipped,
        updated,
      )
    }

    if (codexHome !== undefined) {
      const codexEntrypointCommand = makeCodexGlobalEntrypointCommand(homeRoot)
      const server = prepared.servers.get('codex')!
      server.commit()
      ;(server.changed ? (server.created ? created : updated) : skipped).push(server.path)
      const regResult = registerCodexClooks(codexHome, codexEntrypointCommand, { owner: 'global' })
      const advisoryResult = registerRuntimeAdvisory(
        codexHome,
        'codex',
        makeCodexGlobalRuntimeAdvisoryCommand(homeRoot),
      )
      const receiptPath = globalEntrypointFlagPath(homeRoot, 'codex')
      publishCodexReceipt(homeRoot, codexHome)
      const receiptLabel = globalEntrypointFlagLabel('codex')
      if (previousReceipt === undefined) created.push(receiptLabel)
      else if (previousReceipt === readFileSync(receiptPath, 'utf-8')) skipped.push(receiptLabel)
      else updated.push(receiptLabel)
      const hooksLabel = join(codexHome, 'hooks.json')
      const totalEvents =
        regResult.added.length + regResult.updated.length + regResult.skipped.length
      if (regResult.added.length > 0 || regResult.updated.length > 0) {
        if (regResult.created) {
          created.push(`${hooksLabel} (${totalEvents} events)`)
        } else {
          updated.push(
            `${hooksLabel} (${regResult.added.length} added, ${regResult.updated.length} updated)`,
          )
        }
      } else {
        skipped.push(hooksLabel)
      }
      recordAdvisoryOnlyRegistrationUpdate(
        hooksLabel,
        regResult.added.length > 0 || regResult.updated.length > 0,
        advisoryResult.added || advisoryResult.updated,
        skipped,
        updated,
      )
    }

    // -- Output --
    if (ctx.json) {
      process.stdout.write(
        jsonSuccess('init', {
          created,
          skipped,
          updated,
          global: true,
          agent,
          agents: selectedAgents(agent),
        }) + '\n',
      )
      return
    }

    printIntro(ctx, 'clooks init --global')

    if (created.length === 0 && updated.length === 0) {
      // Fully idempotent re-run
      printSuccess(ctx, 'Global hooks already initialized \u2014 nothing to do.')
    } else {
      for (const item of created) {
        printSuccess(ctx, `Created ${item}`)
      }
      for (const item of updated) {
        printSuccess(ctx, `Updated ${item}`)
      }
    }
    if (includesAgent(agent, 'codex')) {
      printCodexSkippedRegistrations(ctx, skipped)
    }

    printWarning(
      ctx,
      'If you have existing project entrypoints, re-run `clooks init` in each project to update them with the dedup check.',
    )
    if (includesAgent(agent, 'claude-code')) {
      printInfo(ctx, 'Restart Claude Code for hooks to take effect.')
    }
    if (includesAgent(agent, 'codex')) {
      printCodexTrustWarning(ctx)
    }

    printOutro(ctx, 'Done.')
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    printError(ctx, 'init', message)
    process.exit(1)
  }
}

/**
 * Initialize clooks in the current project directory.
 */
async function initProject(cmd: Command, agent: InitAgent): Promise<void> {
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
        printError(ctx, 'init', message)
        process.exit(1)
      }
      printWarning(
        ctx,
        `You are about to initialize clooks in your ${location}. This is usually a mistake.`,
      )
      const confirmed = await promptConfirm(ctx, {
        message: 'Continue anyway?',
        defaultValue: false,
      })
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
        const confirmed = await promptConfirm(ctx, {
          message: 'Continue anyway?',
          defaultValue: true,
        })
        if (!confirmed) {
          printInfo(ctx, 'Aborted.')
          return
        }
      }
    }

    await assertInitLauncherRefreshAllowed(projectRoot, 'project')

    const prepared = prepareInitRegistrations(projectRoot, home, selectedAgents(agent), false)
    const { PROJECT_RUNTIME_ADVISORY_SCRIPT } = await import('./init-advisory.js')

    // -- Track what we create/skip/update --
    const created: string[] = []
    const skipped: string[] = []
    const updated: string[] = []

    // -- Step 1: Create directories --
    const dirs = ['.clooks', '.clooks/hooks', '.clooks/bin', '.clooks/vendor']
    for (const dir of dirs) {
      mkdirSync(join(projectRoot, dir), { recursive: true })
    }

    // -- Write types.d.ts (always) --
    const typesPath = join(projectRoot, '.clooks', 'hooks', 'types.d.ts')
    const typesExisted = existsSync(typesPath)
    let typesChanged = !typesExisted
    if (typesExisted) {
      const existing = readFileSync(typesPath, 'utf-8')
      typesChanged = existing !== EMBEDDED_TYPES_DTS
    }
    writeFileSync(typesPath, EMBEDDED_TYPES_DTS)
    if (!typesExisted) {
      created.push('.clooks/hooks/types.d.ts')
    } else if (typesChanged) {
      updated.push('.clooks/hooks/types.d.ts')
    } else {
      skipped.push('.clooks/hooks/types.d.ts')
    }

    // -- Write clooks.schema.json (always) --
    const schemaPath = join(projectRoot, '.clooks', 'clooks.schema.json')
    const schemaExisted = existsSync(schemaPath)
    let schemaChanged = !schemaExisted
    if (schemaExisted) {
      const existing = readFileSync(schemaPath, 'utf-8')
      schemaChanged = existing !== EMBEDDED_SCHEMA
    }
    writeFileSync(schemaPath, EMBEDDED_SCHEMA)
    if (!schemaExisted) {
      created.push('.clooks/clooks.schema.json')
    } else if (schemaChanged) {
      updated.push('.clooks/clooks.schema.json')
    } else {
      skipped.push('.clooks/clooks.schema.json')
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

    const advisoryPath = join(projectRoot, RUNTIME_ADVISORY_RELATIVE_PATH)
    const advisoryExisted = existsSync(advisoryPath)
    const advisoryChanged =
      !advisoryExisted || readFileSync(advisoryPath, 'utf-8') !== PROJECT_RUNTIME_ADVISORY_SCRIPT
    writeFileSync(advisoryPath, PROJECT_RUNTIME_ADVISORY_SCRIPT)
    chmodSync(advisoryPath, 0o755)
    if (!advisoryExisted) {
      created.push(RUNTIME_ADVISORY_RELATIVE_PATH)
    } else if (advisoryChanged) {
      updated.push(RUNTIME_ADVISORY_RELATIVE_PATH)
    } else {
      skipped.push(RUNTIME_ADVISORY_RELATIVE_PATH)
    }

    // -- Step 4: Register selected agents --
    if (includesAgent(agent, 'claude-code')) {
      const identity = prepared.identities.get('claude-code')!
      identity.commit()
      ;(identity.created ? created : skipped).push(identity.marker)
      const server = prepared.servers.get('claude-code')!
      server.commit()
      ;(server.changed ? (server.created ? created : updated) : skipped).push('.mcp.json')
      const regResult = registerClooks(join(projectRoot, '.claude'), CLOOKS_ENTRYPOINT_PATH, {
        owner: identity.owner,
      })
      const advisoryResult = registerRuntimeAdvisory(
        join(projectRoot, '.claude'),
        'claude-code',
        CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND,
      )
      const totalEvents =
        regResult.added.length + regResult.updated.length + regResult.skipped.length
      if (regResult.added.length > 0 || regResult.updated.length > 0) {
        if (regResult.created) {
          created.push(`.claude/settings.json (${totalEvents} events)`)
        } else {
          updated.push(
            `.claude/settings.json (${regResult.added.length} added, ${regResult.updated.length} updated)`,
          )
        }
      } else {
        skipped.push('.claude/settings.json')
      }
      recordAdvisoryOnlyRegistrationUpdate(
        '.claude/settings.json',
        regResult.added.length > 0 || regResult.updated.length > 0,
        advisoryResult.added || advisoryResult.updated,
        skipped,
        updated,
      )
    }

    if (includesAgent(agent, 'codex')) {
      const projectId = prepared.identities.get('codex')!
      projectId.commit()
      ;(projectId.created ? created : skipped).push(projectId.marker)
      const server = prepared.servers.get('codex')!
      server.commit()
      ;(server.changed ? (server.created ? created : updated) : skipped).push('.codex/config.toml')
      const codexEntrypointCommand = makeCodexProjectEntrypointCommand(projectId.id)
      const regResult = registerCodexClooks(join(projectRoot, '.codex'), codexEntrypointCommand, {
        owner: projectId.owner,
        command: makeCodexProjectEntrypointCommand(projectId.id, true),
      })
      const advisoryResult = registerRuntimeAdvisory(
        join(projectRoot, '.codex'),
        'codex',
        makeCodexProjectRuntimeAdvisoryCommand(projectId.id),
      )
      const totalEvents =
        regResult.added.length + regResult.updated.length + regResult.skipped.length
      if (regResult.added.length > 0 || regResult.updated.length > 0) {
        if (regResult.created) {
          created.push(`.codex/hooks.json (${totalEvents} events)`)
        } else {
          updated.push(
            `.codex/hooks.json (${regResult.added.length} added, ${regResult.updated.length} updated)`,
          )
        }
      } else {
        skipped.push('.codex/hooks.json')
      }
      recordAdvisoryOnlyRegistrationUpdate(
        '.codex/hooks.json',
        regResult.added.length > 0 || regResult.updated.length > 0,
        advisoryResult.added || advisoryResult.updated,
        skipped,
        updated,
      )
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
      process.stdout.write(
        jsonSuccess('init', { created, skipped, updated, agent, agents: selectedAgents(agent) }) +
          '\n',
      )
      return
    }

    printIntro(ctx, 'clooks init')

    if (created.length === 0 && updated.length === 0) {
      // Fully idempotent re-run
      printSuccess(ctx, 'Already initialized \u2014 nothing to do.')
      printInfo(ctx, 'Tip: run `clooks new-hook` to scaffold a hook.')
    } else {
      for (const item of created) {
        printSuccess(ctx, `Created ${item}`)
      }
      for (const item of updated) {
        printSuccess(ctx, `Updated ${item}`)
      }
      printInfo(
        ctx,
        'Next: run `clooks new-hook` to scaffold a hook, then register it in clooks.yml.',
      )
      if (includesAgent(agent, 'claude-code')) {
        printWarning(ctx, 'Restart Claude Code for hooks to take effect.')
      }
    }
    if (includesAgent(agent, 'codex')) {
      printCodexSkippedRegistrations(ctx, skipped)
      printCodexTrustWarning(ctx)
    }

    printOutro(ctx, 'Done.')
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    printError(ctx, 'init', message)
    process.exit(1)
  }
}

export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize clooks in this project')
    .option('--global', 'Initialize global hooks at ~/.clooks/')
    .option('--agent <agent>', 'Agent registration target: claude-code, codex, or all')
    .option('--check', 'Inspect existing installation state without making changes')
    .action(async (opts: { global?: boolean; agent?: string; check?: boolean }, cmd: Command) => {
      if (opts.check) return checkInstallation(cmd, opts)

      let agent: InitAgent
      try {
        agent = parseInitAgent(opts.agent)
      } catch (e) {
        const ctx = getCtx(cmd)
        const message = e instanceof Error ? e.message : String(e)
        printError(ctx, 'init', message)
        process.exit(1)
      }

      if (opts.global) {
        return initGlobal(cmd, agent)
      }
      return initProject(cmd, agent)
    })
}
