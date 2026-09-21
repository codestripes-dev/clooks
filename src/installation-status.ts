import * as fs from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { lt, valid } from 'semver'
import type { AgentId } from './agents/types.js'
import {
  isCodexClooksHook,
  makeCodexProjectEntrypointCommand,
  resolveCodexHome,
} from './agents/codex/settings.js'
import { isApprovalCompanion, unpairedCommand } from './registration-approvals.js'
import { readRegistrationFile } from './registration-file.js'
import { mcpRegistrationPath, prepareMcpRegistration } from './registration-mcp.js'
import { readCodexReceipt, readCodexTrackedHome } from './registration-state.js'
import {
  CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND,
  isExpectedRuntimeAdvisoryHook,
  isRuntimeAdvisoryHook,
  makeClaudeGlobalRuntimeAdvisoryCommand,
  makeCodexGlobalRuntimeAdvisoryCommand,
  makeCodexProjectRuntimeAdvisoryCommand,
  RUNTIME_ADVISORY_RELATIVE_PATH,
  runtimeAdvisoryGlobalRoot,
} from './registration-advisory.js'
import { CLOOKS_ENTRYPOINT_PATH, isClooksHook } from './settings.js'
import { LAUNCHER_REVISION } from './installation-metadata.js'

export { LAUNCHER_REVISION, MIN_RUNTIME_VERSION } from './installation-metadata.js'

export type InstallationScope = 'project' | 'global'
export type ScopeState = 'absent' | 'current' | 'legacy' | 'outdated' | 'future' | 'uninspectable'

export interface RepairCommand {
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

export interface ScopeStatus {
  scope: InstallationScope
  root: string
  agents: AgentId[]
  revision: number | null
  minimumRuntime: string | null
  state: ScopeState
  needsBinaryUpdate: boolean
  needsIntegrationRefresh: boolean
  diagnostics: string[]
  repair: RepairCommand | null
}

export interface InstallationStatus {
  binaryVersion: string
  scopes: ScopeStatus[]
}

export interface InspectInstallationOptions {
  projectRoot?: string
  installationHome: string
  executable: string
  binaryVersion: string
  env: Readonly<Record<string, string | undefined>>
  scopes?: readonly InstallationScope[]
  agents?: readonly AgentId[]
}

export interface LauncherRefreshGuardOptions {
  launcherPath: string
  advisoryPath: string
  expectedScope: InstallationScope
  runtimeVersion: string
}

const MAX_LAUNCHER_BYTES = 256 * 1024
const MAX_REGISTRATION_BYTES = 1024 * 1024
const MAX_MCP_REGISTRATION_BYTES = 16 * 1024 * 1024
const MAX_REGISTRATION_STATE_BYTES = 4096
const PROJECT_ENTRYPOINT = '.clooks/bin/entrypoint.sh'
const ENTRYPOINT_SUFFIX = '/.clooks/bin/entrypoint.sh'
const AGENTS: readonly AgentId[] = ['claude-code', 'codex']
const SCOPES: readonly InstallationScope[] = ['project', 'global']
const APPROVAL_PREFIX =
  /^CLOOKS_APPROVAL_PROTOCOL=1 CLOOKS_APPROVAL_OWNER=(global|project:[a-f0-9]{32}) CLOOKS_APPROVAL_DISPOSITION=run CLOOKS_AGENT=(claude-code|codex) /u
const CANONICAL_SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u

type PartState = 'absent' | 'owned' | 'uncertain'

interface AgentEvidence {
  agent: AgentId
  hooks: PartState
  mcp: PartState
  advisory: PartState
  diagnostics: string[]
}

interface LauncherInspection {
  kind: 'missing' | 'custom' | 'managed' | 'invalid'
  revision: number | null
  minimumRuntime: string | null
  scope?: InstallationScope
  diagnostic?: string
}

interface AdvisoryInspection {
  kind: 'missing' | 'custom' | 'managed' | 'invalid'
  minimumRuntime: string | null
  scope?: InstallationScope
  diagnostic?: string
}

interface CodexHomeInspection {
  codexHome?: string
  environmentHome?: string
  defaultHome?: string
  diagnostics: string[]
  invalid: boolean
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validateVersion(version: string, label: string): void {
  if (!CANONICAL_SEMVER.test(version) || valid(version) === null) {
    throw new Error(`${label} must be a canonical SemVer version.`)
  }
}

function canonicalRoot(path: string, label: string): string {
  if (!isAbsolute(path) || /[\r\n\0]/u.test(path)) {
    throw new Error(`${label} must be an absolute path without CR/LF or NUL.`)
  }
  const physical = fs.realpathSync(path)
  if (!fs.statSync(physical).isDirectory()) throw new Error(`${label} must be a directory.`)
  return physical
}

function boundedRegularFile(path: string, limit: number): 'missing' | 'file' {
  const stat = fs.lstatSync(path, { throwIfNoEntry: false })
  if (!stat) return 'missing'
  if (!stat.isFile()) {
    throw new Error(`\`${path}\` must be a regular file, not a symlink or other file type.`)
  }
  if (stat.size > limit) throw new Error(`\`${path}\` exceeds the inspection size limit.`)
  return 'file'
}

function inspectLauncher(path: string): LauncherInspection {
  try {
    if (boundedRegularFile(path, MAX_LAUNCHER_BYTES) === 'missing') {
      return { kind: 'missing', revision: null, minimumRuntime: null }
    }
    const text = fs.readFileSync(path, 'utf8')
    if (text.includes('\0')) {
      return {
        kind: 'invalid',
        revision: null,
        minimumRuntime: null,
        diagnostic: `\`${path}\` contains NUL bytes.`,
      }
    }
    const lines = text.split('\n')
    const headerLines = lines.filter((line) => line.trimStart().startsWith('# clooks entrypoint:'))
    const exactHeaders = headerLines.flatMap((line) => {
      const match = /^# clooks entrypoint: (project|global)$/u.exec(line)
      return match ? [match[1] as InstallationScope] : []
    })
    if (headerLines.length === 0) {
      return { kind: 'custom', revision: null, minimumRuntime: null }
    }
    if (headerLines.length !== 1 || exactHeaders.length !== 1) {
      return {
        kind: 'invalid',
        revision: null,
        minimumRuntime: null,
        diagnostic: `\`${path}\` contains malformed or duplicate managed launcher headers.`,
      }
    }

    const revisionLines = lines.filter((line) =>
      line.trimStart().startsWith('# clooks launcher revision'),
    )
    const minimumLines = lines.filter((line) =>
      line.trimStart().startsWith('CLOOKS_REQUIRED_RUNTIME'),
    )
    if (revisionLines.length === 0 && minimumLines.length === 0) {
      return {
        kind: 'managed',
        scope: exactHeaders[0],
        revision: null,
        minimumRuntime: null,
      }
    }
    if (revisionLines.length !== 1 || minimumLines.length !== 1) {
      return {
        kind: 'invalid',
        scope: exactHeaders[0],
        revision: null,
        minimumRuntime: null,
        diagnostic: `\`${path}\` contains partial or duplicate launcher metadata.`,
      }
    }
    const revisionMatch = /^# clooks launcher revision: (0|[1-9][0-9]*)$/u.exec(revisionLines[0]!)
    const minimumMatch = /^CLOOKS_REQUIRED_RUNTIME='([^']+)'$/u.exec(minimumLines[0]!)
    const revision = revisionMatch ? Number(revisionMatch[1]) : Number.NaN
    const minimumRuntime = minimumMatch?.[1]
    if (
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      minimumRuntime === undefined ||
      !CANONICAL_SEMVER.test(minimumRuntime) ||
      valid(minimumRuntime) === null
    ) {
      return {
        kind: 'invalid',
        scope: exactHeaders[0],
        revision: null,
        minimumRuntime: null,
        diagnostic: `\`${path}\` contains malformed launcher metadata.`,
      }
    }
    return {
      kind: 'managed',
      scope: exactHeaders[0],
      revision,
      minimumRuntime,
    }
  } catch (error) {
    return {
      kind: 'invalid',
      revision: null,
      minimumRuntime: null,
      diagnostic: errorText(error),
    }
  }
}

function inspectAdvisory(path: string): AdvisoryInspection {
  try {
    if (boundedRegularFile(path, MAX_LAUNCHER_BYTES) === 'missing') {
      return { kind: 'missing', minimumRuntime: null }
    }
    const text = fs.readFileSync(path, 'utf8')
    if (text.includes('\0')) {
      return {
        kind: 'invalid',
        minimumRuntime: null,
        diagnostic: `\`${path}\` contains NUL bytes.`,
      }
    }
    const lines = text.split('\n')
    const headerLines = lines.filter((line) =>
      line.trimStart().startsWith('# clooks runtime advisory:'),
    )
    const exactHeaders = headerLines.flatMap((line) => {
      const match = /^# clooks runtime advisory: (project|global)$/u.exec(line)
      return match ? [match[1] as InstallationScope] : []
    })
    if (headerLines.length === 0) {
      return { kind: 'custom', minimumRuntime: null }
    }
    if (headerLines.length !== 1 || exactHeaders.length !== 1) {
      return {
        kind: 'invalid',
        minimumRuntime: null,
        diagnostic: `\`${path}\` contains malformed or duplicate managed advisory headers.`,
      }
    }

    const minimumLines = lines.filter((line) =>
      line.trimStart().startsWith('CLOOKS_REQUIRED_RUNTIME'),
    )
    const revisionLines = lines.filter((line) =>
      line.trimStart().startsWith('# clooks launcher revision'),
    )
    if (minimumLines.length !== 1 || revisionLines.length !== 0) {
      return {
        kind: 'invalid',
        scope: exactHeaders[0],
        minimumRuntime: null,
        diagnostic: `\`${path}\` contains partial or duplicate advisory metadata.`,
      }
    }
    const minimumMatch = /^CLOOKS_REQUIRED_RUNTIME='([^']+)'$/u.exec(minimumLines[0]!)
    const minimumRuntime = minimumMatch?.[1]
    if (
      minimumRuntime === undefined ||
      !CANONICAL_SEMVER.test(minimumRuntime) ||
      valid(minimumRuntime) === null
    ) {
      return {
        kind: 'invalid',
        scope: exactHeaders[0],
        minimumRuntime: null,
        diagnostic: `\`${path}\` contains malformed advisory metadata.`,
      }
    }
    return {
      kind: 'managed',
      scope: exactHeaders[0],
      minimumRuntime,
    }
  } catch (error) {
    return {
      kind: 'invalid',
      minimumRuntime: null,
      diagnostic: errorText(error),
    }
  }
}

function decodeSingleQuoted(value: string): string | undefined {
  const match = /^'((?:[^']|'\\'')*)'$/u.exec(value)
  return match?.[1]?.replaceAll("'\\''", "'")
}

function entrypointRoot(command: string): string | undefined {
  const decoded = decodeSingleQuoted(command) ?? command
  if (!decoded.startsWith('/') || !decoded.endsWith(ENTRYPOINT_SUFFIX)) return undefined
  return decoded.slice(0, -ENTRYPOINT_SUFFIX.length) || '/'
}

function sameRoot(candidate: string, root: string): boolean {
  try {
    return fs.realpathSync(candidate) === root
  } catch {
    return resolve(candidate) === root
  }
}

function readProjectId(
  root: string,
  agent: AgentId,
): {
  id?: string
  diagnostic?: string
} {
  const name = agent === 'codex' ? 'codex-project-id' : 'claude-project-id'
  const path = join(root, '.clooks/bin', name)
  try {
    if (boundedRegularFile(path, 128) === 'missing') return {}
    const text = fs.readFileSync(path, 'utf8')
    if (!/^[a-f0-9]{32}\n$/u.test(text)) return { diagnostic: `\`${path}\`: invalid project ID` }
    return { id: text.slice(0, -1) }
  } catch (error) {
    return { diagnostic: errorText(error) }
  }
}

function expectedOwner(scope: InstallationScope, projectId?: string): string | undefined {
  return scope === 'global' ? 'global' : projectId ? `project:${projectId}` : undefined
}

function commandOwner(command: string): { owner?: string; agent?: AgentId } {
  const match = APPROVAL_PREFIX.exec(command)
  return match
    ? { owner: match[1], agent: match[2] as AgentId }
    : { owner: undefined, agent: undefined }
}

function isOldAbsoluteCodexProjectCommand(command: string): boolean {
  return (
    /^CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT='(?:[^']|'\\'')+' '(?:[^']|'\\'')+'$/u.test(command) &&
    command.includes('/.clooks/bin/entrypoint.sh')
  )
}

function classifyCommand(
  hook: Record<string, unknown>,
  agent: AgentId,
  scope: InstallationScope,
  root: string,
  projectId?: string,
): 'ignore' | 'owned' | 'uncertain' {
  if (hook.type !== 'command' || typeof hook.command !== 'string') return 'ignore'
  const owner = commandOwner(hook.command)
  const command = unpairedCommand(hook.command, agent)
  const wantedOwner = expectedOwner(scope, projectId)
  if (owner.agent !== undefined && (owner.agent !== agent || owner.owner !== wantedOwner)) {
    return 'uncertain'
  }

  if (agent === 'claude-code') {
    if (scope === 'project') {
      if (command === CLOOKS_ENTRYPOINT_PATH || command === PROJECT_ENTRYPOINT) return 'owned'
      const commandRoot = entrypointRoot(command)
      if (commandRoot !== undefined && sameRoot(commandRoot, root) && isClooksHook(hook))
        return 'owned'
      if (commandRoot !== undefined) return 'uncertain'
    } else {
      const commandRoot = entrypointRoot(command)
      const expectedCommand = join(root, '.clooks/bin/entrypoint.sh')
      if (
        commandRoot !== undefined &&
        sameRoot(commandRoot, root) &&
        isClooksHook(hook, expectedCommand)
      )
        return 'owned'
      if (commandRoot !== undefined) return 'uncertain'
    }
    return isClooksHook(hook) ? 'uncertain' : 'ignore'
  }

  if (scope === 'project' && projectId !== undefined) {
    if (
      command === makeCodexProjectEntrypointCommand(projectId) ||
      command === makeCodexProjectEntrypointCommand(projectId, true)
    )
      return 'owned'
  }
  if (scope === 'global') {
    const globalPrefix = 'CLOOKS_AGENT=codex '
    const commandRoot = command.startsWith(globalPrefix)
      ? entrypointRoot(command.slice(globalPrefix.length))
      : undefined
    if (commandRoot !== undefined && sameRoot(commandRoot, root) && isCodexClooksHook(hook))
      return 'owned'
    if (commandRoot !== undefined) return 'uncertain'
  }
  if (isCodexClooksHook(hook) || isOldAbsoluteCodexProjectCommand(command)) return 'uncertain'
  return 'ignore'
}

function inspectHooks(
  path: string,
  agent: AgentId,
  scope: InstallationScope,
  root: string,
): { state: PartState; diagnostics: string[] } {
  const diagnostics: string[] = []
  try {
    if (boundedRegularFile(path, MAX_REGISTRATION_BYTES) === 'missing') {
      return { state: 'absent', diagnostics }
    }
    const project = scope === 'project' ? readProjectId(root, agent) : {}
    if (project.diagnostic) diagnostics.push(project.diagnostic)
    const { hooks } = readRegistrationFile(path)
    let owned = false
    let uncertain = project.diagnostic !== undefined
    const wantedOwner = expectedOwner(scope, project.id)
    for (const value of Object.values(hooks)) {
      if (!Array.isArray(value)) continue
      for (const group of value) {
        for (const hook of (group as { hooks: Record<string, unknown>[] }).hooks) {
          if (isApprovalCompanion(hook, agent)) {
            const owner = (hook.input as Record<string, unknown>).owner
            if (wantedOwner !== undefined && owner === wantedOwner) owned = true
            else uncertain = true
            continue
          }
          if (hook.type === 'mcp_tool' && hook.server === 'clooks' && hook.tool === 'check') {
            uncertain = true
            continue
          }
          const classification = classifyCommand(hook, agent, scope, root, project.id)
          if (classification === 'owned') owned = true
          if (classification === 'uncertain') uncertain = true
        }
      }
    }
    if (uncertain) {
      diagnostics.push(`\`${path}\` contains Clooks-looking registration with uncertain ownership.`)
      return { state: 'uncertain', diagnostics }
    }
    return { state: owned ? 'owned' : 'absent', diagnostics }
  } catch (error) {
    diagnostics.push(errorText(error))
    return { state: 'uncertain', diagnostics }
  }
}

function expectedAdvisoryCommand(
  agent: AgentId,
  scope: InstallationScope,
  root: string,
  projectId?: string,
): string | undefined {
  if (agent === 'claude-code') {
    return scope === 'project'
      ? CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND
      : makeClaudeGlobalRuntimeAdvisoryCommand(root)
  }
  if (scope === 'global') return makeCodexGlobalRuntimeAdvisoryCommand(root)
  return projectId ? makeCodexProjectRuntimeAdvisoryCommand(projectId) : undefined
}

function inspectAdvisoryHooks(
  path: string,
  agent: AgentId,
  scope: InstallationScope,
  root: string,
): { state: PartState; diagnostics: string[] } {
  const diagnostics: string[] = []
  try {
    if (boundedRegularFile(path, MAX_REGISTRATION_BYTES) === 'missing') {
      return { state: 'absent', diagnostics }
    }
    const project = scope === 'project' ? readProjectId(root, agent) : {}
    if (project.diagnostic) diagnostics.push(project.diagnostic)
    const expectedCommand = expectedAdvisoryCommand(agent, scope, root, project.id)
    const { hooks } = readRegistrationFile(path, ['SessionStart'])
    const groups = hooks.SessionStart
    let owned = false
    let uncertain = project.diagnostic !== undefined
    if (Array.isArray(groups)) {
      for (const group of groups) {
        for (const hook of (group as { hooks: Record<string, unknown>[] }).hooks) {
          const globalRoot = scope === 'global' ? runtimeAdvisoryGlobalRoot(hook, agent) : undefined
          if (expectedCommand && isExpectedRuntimeAdvisoryHook(hook, agent, expectedCommand)) {
            owned = true
          } else if (globalRoot !== undefined && sameRoot(globalRoot, root)) {
            owned = true
          } else if (isRuntimeAdvisoryHook(hook, agent)) {
            uncertain = true
          }
        }
      }
    }
    if (uncertain) {
      diagnostics.push(`\`${path}\` contains a Clooks runtime advisory with uncertain ownership.`)
      return { state: 'uncertain', diagnostics }
    }
    return { state: owned ? 'owned' : 'absent', diagnostics }
  } catch (error) {
    diagnostics.push(errorText(error))
    return { state: 'uncertain', diagnostics }
  }
}

function inspectMcp(
  path: string,
  agent: AgentId,
): {
  state: PartState
  diagnostics: string[]
} {
  try {
    boundedRegularFile(path, MAX_MCP_REGISTRATION_BYTES)
    const prepared = prepareMcpRegistration(path, agent)
    return { state: prepared.owned ? 'owned' : 'absent', diagnostics: [] }
  } catch (error) {
    return { state: 'uncertain', diagnostics: [errorText(error)] }
  }
}

function inspectAgent(
  root: string,
  scope: InstallationScope,
  agent: AgentId,
  codexHome?: string,
): AgentEvidence {
  const registrationRoot =
    agent === 'codex'
      ? scope === 'global'
        ? codexHome
        : join(root, '.codex')
      : join(root, '.claude')
  if (registrationRoot === undefined) {
    return {
      agent,
      hooks: 'uncertain',
      mcp: 'uncertain',
      advisory: 'uncertain',
      diagnostics: ['Codex registration home could not be determined.'],
    }
  }
  const hooksPath = join(registrationRoot, agent === 'codex' ? 'hooks.json' : 'settings.json')
  const mcpPath = mcpRegistrationPath(root, agent, scope === 'global', codexHome)
  const hooks = inspectHooks(hooksPath, agent, scope, root)
  const mcp = inspectMcp(mcpPath, agent)
  const advisory = inspectAdvisoryHooks(hooksPath, agent, scope, root)
  return {
    agent,
    hooks: hooks.state,
    mcp: mcp.state,
    advisory: advisory.state,
    diagnostics: [...hooks.diagnostics, ...mcp.diagnostics, ...advisory.diagnostics],
  }
}

function inspectCodexHome(
  installationHome: string,
  env: Readonly<Record<string, string | undefined>>,
): CodexHomeInspection {
  const diagnostics: string[] = []
  let invalid = false
  let receipt: ReturnType<typeof readCodexReceipt> | undefined
  let tracked: ReturnType<typeof readCodexTrackedHome> | undefined
  try {
    boundedRegularFile(
      join(installationHome, '.clooks/.global-entrypoint-active.codex'),
      MAX_REGISTRATION_STATE_BYTES,
    )
    receipt = readCodexReceipt(installationHome)
    if (receipt.kind === 'invalid') {
      diagnostics.push(receipt.reason)
      invalid = true
    }
  } catch (error) {
    diagnostics.push(errorText(error))
    invalid = true
  }
  try {
    boundedRegularFile(
      join(installationHome, '.clooks/.codex-registration-home'),
      MAX_REGISTRATION_STATE_BYTES,
    )
    tracked = readCodexTrackedHome(installationHome)
    if (tracked.kind === 'invalid') {
      diagnostics.push(tracked.reason)
      invalid = true
    }
  } catch (error) {
    diagnostics.push(errorText(error))
    invalid = true
  }

  let environmentHome: string | undefined
  let defaultHome: string | undefined
  let environmentInvalid = false
  try {
    defaultHome = resolveCodexHome(installationHome, {})
  } catch (error) {
    diagnostics.push(errorText(error))
    environmentInvalid = true
  }
  try {
    environmentHome = resolveCodexHome(installationHome, { CODEX_HOME: env.CODEX_HOME })
  } catch (error) {
    diagnostics.push(errorText(error))
    environmentInvalid = true
  }
  const receiptHome =
    receipt?.kind === 'receipt'
      ? receipt.value.codexHome
      : receipt?.kind === 'legacy'
        ? defaultHome
        : undefined
  const trackedHome = tracked?.kind === 'home' ? tracked.codexHome : undefined
  if (receiptHome && trackedHome && receiptHome !== trackedHome) {
    diagnostics.push(
      `Codex receipt and recovery record contain conflicting homes (${receiptHome}, ${trackedHome}).`,
    )
    invalid = true
  }
  const recordedHome = trackedHome ?? receiptHome
  const codexHome = recordedHome ?? environmentHome
  if (environmentInvalid && recordedHome === undefined) invalid = true
  if (!invalid && codexHome && environmentHome && codexHome !== environmentHome) {
    diagnostics.push(
      `Recorded Codex home \`${codexHome}\` takes precedence over environment home \`${environmentHome}\`.`,
    )
  }
  return { codexHome, environmentHome, defaultHome, diagnostics, invalid }
}

function hasAuthoredConfig(root: string): { present: boolean; diagnostic?: string } {
  const path = join(root, '.clooks/clooks.yml')
  try {
    return { present: boundedRegularFile(path, MAX_REGISTRATION_BYTES) === 'file' }
  } catch (error) {
    return { present: false, diagnostic: errorText(error) }
  }
}

function claudeLayoutDiagnostic(
  installationHome: string,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (env.CLAUDE_CONFIG_DIR !== undefined) {
    return 'CLAUDE_CONFIG_DIR overrides are not supported for Claude registration.'
  }
  const legacy = join(installationHome, '.claude/.config.json')
  try {
    if (fs.lstatSync(legacy, { throwIfNoEntry: false })) {
      return `Legacy Claude user configuration at \`${legacy}\` is not supported for registration.`
    }
  } catch (error) {
    return errorText(error)
  }
  return undefined
}

function repairAgent(agents: AgentId[]): 'claude-code' | 'codex' | 'all' {
  return agents.length === 2 ? 'all' : agents[0]!
}

function inspectScope(
  root: string,
  scope: InstallationScope,
  options: InspectInstallationOptions,
  codex: CodexHomeInspection,
): { status: ScopeStatus; evidence: AgentEvidence[] } {
  const evidence = AGENTS.map((agent) =>
    inspectAgent(root, scope, agent, scope === 'global' ? codex.codexHome : undefined),
  )
  const agents = evidence
    .filter((item) => item.hooks === 'owned' || item.mcp === 'owned' || item.advisory === 'owned')
    .map((item) => item.agent)
  const diagnostics = evidence.flatMap((item) => item.diagnostics)
  let uncertain = evidence.some(
    (item) =>
      item.hooks === 'uncertain' || item.mcp === 'uncertain' || item.advisory === 'uncertain',
  )

  if (scope === 'global') {
    diagnostics.unshift(...codex.diagnostics)
    uncertain ||= codex.invalid
  }
  if (agents.includes('claude-code')) {
    const diagnostic = claudeLayoutDiagnostic(options.installationHome, options.env)
    if (diagnostic) {
      diagnostics.push(diagnostic)
      uncertain = true
    }
  }

  const launcherPath = join(root, '.clooks/bin/entrypoint.sh')
  const advisoryPath = join(root, RUNTIME_ADVISORY_RELATIVE_PATH)
  const launcher = inspectLauncher(launcherPath)
  const advisory = inspectAdvisory(advisoryPath)
  if (agents.length === 0 && !uncertain) {
    return {
      evidence,
      status: {
        scope,
        root,
        agents,
        revision: null,
        minimumRuntime: null,
        state: 'absent',
        needsBinaryUpdate: false,
        needsIntegrationRefresh: false,
        diagnostics,
        repair: null,
      },
    }
  }
  if (launcher.diagnostic) diagnostics.push(launcher.diagnostic)
  if (launcher.kind === 'missing') {
    diagnostics.push(`Managed launcher is missing at \`${launcherPath}\`.`)
    uncertain = true
  } else if (launcher.kind === 'custom') {
    diagnostics.push(`\`${launcherPath}\` is custom and has no managed Clooks header.`)
    uncertain = true
  } else if (launcher.kind === 'managed' && launcher.scope !== scope) {
    diagnostics.push(
      `\`${launcherPath}\` is a managed ${launcher.scope} launcher, not a managed ${scope} launcher.`,
    )
    uncertain = true
  } else if (launcher.kind === 'invalid') {
    uncertain = true
  }

  if (advisory.diagnostic) diagnostics.push(advisory.diagnostic)
  if (advisory.kind === 'missing') {
    diagnostics.push(`Managed runtime advisory is missing at \`${advisoryPath}\`.`)
  } else if (advisory.kind === 'custom') {
    diagnostics.push(`\`${advisoryPath}\` is custom and has no managed Clooks advisory header.`)
    uncertain = true
  } else if (advisory.kind === 'managed' && advisory.scope !== scope) {
    diagnostics.push(
      `\`${advisoryPath}\` is a managed ${advisory.scope} advisory, not a managed ${scope} advisory.`,
    )
    uncertain = true
  } else if (advisory.kind === 'invalid') {
    uncertain = true
  }

  const minimumRuntime =
    launcher.minimumRuntime === null
      ? advisory.minimumRuntime
      : advisory.minimumRuntime === null || !lt(launcher.minimumRuntime, advisory.minimumRuntime)
        ? launcher.minimumRuntime
        : advisory.minimumRuntime
  const needsBinaryUpdate = minimumRuntime !== null && lt(options.binaryVersion, minimumRuntime)
  const completeRegistration = evidence
    .filter((item) => agents.includes(item.agent))
    .every((item) => item.hooks === 'owned' && item.mcp === 'owned' && item.advisory === 'owned')
  const mismatchedFloors =
    launcher.minimumRuntime !== null &&
    advisory.minimumRuntime !== null &&
    launcher.minimumRuntime !== advisory.minimumRuntime
  if (mismatchedFloors) {
    diagnostics.push(
      `Launcher and runtime advisory minimum versions differ (${launcher.minimumRuntime}, ${advisory.minimumRuntime}).`,
    )
  }
  const incompleteIntegration =
    advisory.kind === 'missing' || mismatchedFloors || !completeRegistration
  let state: ScopeState
  let needsIntegrationRefresh = false
  if (uncertain) {
    state = 'uninspectable'
  } else if (launcher.revision === null) {
    state = 'legacy'
    needsIntegrationRefresh = true
  } else if (launcher.revision > LAUNCHER_REVISION) {
    state = 'future'
  } else if (launcher.revision < LAUNCHER_REVISION || incompleteIntegration) {
    state = 'outdated'
    needsIntegrationRefresh = true
  } else {
    state = 'current'
  }

  const config = hasAuthoredConfig(root)
  if (config.diagnostic) diagnostics.push(config.diagnostic)
  if (!config.present) {
    diagnostics.push(
      `No authored Clooks configuration exists at \`${join(root, '.clooks/clooks.yml')}\`; init would create one.`,
    )
  }
  const canRepair =
    needsIntegrationRefresh &&
    state !== 'uninspectable' &&
    state !== 'future' &&
    agents.length > 0 &&
    config.present
  const repairEnv: Record<string, string> = {}
  if (scope === 'global' && agents.includes('codex') && codex.codexHome) {
    repairEnv.CODEX_HOME = codex.codexHome
  }
  return {
    evidence,
    status: {
      scope,
      root,
      agents,
      revision: launcher.revision,
      minimumRuntime,
      state,
      needsBinaryUpdate,
      needsIntegrationRefresh,
      diagnostics,
      repair: canRepair
        ? {
            executable: options.executable,
            args: [
              'init',
              ...(scope === 'global' ? ['--global'] : []),
              '--agent',
              repairAgent(agents),
            ],
            cwd: root,
            env: repairEnv,
          }
        : null,
    },
  }
}

function hasProjectSpecificHomeEvidence(home: string, codex: CodexHomeInspection): string[] {
  const diagnostics: string[] = []
  const projectMcp = inspectMcp(join(home, '.mcp.json'), 'claude-code')
  if (projectMcp.state === 'owned') {
    diagnostics.push('Project-specific Claude MCP registration exists at the installation home.')
  } else if (projectMcp.state === 'uncertain') {
    diagnostics.push(...projectMcp.diagnostics)
  }
  if (codex.codexHome && codex.defaultHome && codex.codexHome !== codex.defaultHome) {
    const projectHooks = inspectHooks(
      join(codex.defaultHome, 'hooks.json'),
      'codex',
      'project',
      home,
    )
    const projectAdvisory = inspectAdvisoryHooks(
      join(codex.defaultHome, 'hooks.json'),
      'codex',
      'project',
      home,
    )
    if (projectHooks.state === 'owned') {
      diagnostics.push('Project-specific Codex hook registration exists at the installation home.')
    } else if (projectHooks.state === 'uncertain') {
      diagnostics.push(...projectHooks.diagnostics)
    }
    if (projectAdvisory.state === 'owned') {
      diagnostics.push(
        'Project-specific Codex runtime advisory registration exists at the installation home.',
      )
    } else if (projectAdvisory.state === 'uncertain') {
      diagnostics.push(...projectAdvisory.diagnostics)
    }
  }
  return diagnostics
}

export function inspectInstallation(options: InspectInstallationOptions): InstallationStatus {
  validateVersion(options.binaryVersion, 'binaryVersion')
  if (!isAbsolute(options.executable) || /[\r\n\0]/u.test(options.executable)) {
    throw new Error('executable must be an absolute path without CR/LF or NUL.')
  }
  const installationHome = canonicalRoot(options.installationHome, 'installationHome')
  const projectRoot = options.projectRoot
    ? canonicalRoot(options.projectRoot, 'projectRoot')
    : undefined
  const selectedScopes = new Set(options.scopes ?? SCOPES)
  const selectedAgents = options.agents ? new Set(options.agents) : undefined
  for (const scope of selectedScopes) {
    if (!SCOPES.includes(scope)) throw new Error(`Unsupported installation scope: ${scope}`)
  }
  if (selectedAgents) {
    for (const agent of selectedAgents) {
      if (!AGENTS.includes(agent)) throw new Error(`Unsupported installation agent: ${agent}`)
    }
  }

  const codex = selectedScopes.has('global')
    ? inspectCodexHome(installationHome, options.env)
    : { diagnostics: [], invalid: false }
  const inspections: { status: ScopeStatus; evidence: AgentEvidence[] }[] = []
  if (selectedScopes.has('global')) {
    inspections.push(
      inspectScope(installationHome, 'global', { ...options, installationHome }, codex),
    )
  }
  if (
    projectRoot !== undefined &&
    projectRoot !== installationHome &&
    selectedScopes.has('project')
  ) {
    inspections.push(inspectScope(projectRoot, 'project', { ...options, installationHome }, codex))
  }
  if (selectedScopes.has('global')) {
    const global = inspections.find((item) => item.status.scope === 'global')
    const mixed = hasProjectSpecificHomeEvidence(installationHome, codex)
    if (global && mixed.length > 0) {
      global.status.state = 'uninspectable'
      global.status.needsIntegrationRefresh = false
      global.status.repair = null
      global.status.diagnostics.push(...mixed)
    }
  }

  const scopes = inspections
    .filter(({ status, evidence }) => {
      if (!selectedAgents) return true
      const requestedOwned = evidence.some(
        (item) =>
          selectedAgents.has(item.agent) &&
          (item.hooks === 'owned' || item.mcp === 'owned' || item.advisory === 'owned'),
      )
      const requestedUncertain = evidence.some(
        (item) =>
          selectedAgents.has(item.agent) &&
          (item.hooks === 'uncertain' || item.mcp === 'uncertain' || item.advisory === 'uncertain'),
      )
      return requestedOwned || requestedUncertain || status.agents.length === 0
    })
    .map(({ status }) => status)
  return { binaryVersion: options.binaryVersion, scopes }
}

export function assertLauncherRefreshAllowed(options: LauncherRefreshGuardOptions): void {
  validateVersion(options.runtimeVersion, 'runtimeVersion')
  const launcher = inspectLauncher(options.launcherPath)
  if (launcher.kind === 'invalid') {
    throw new Error(launcher.diagnostic ?? `\`${options.launcherPath}\` is not inspectable.`)
  }
  if (launcher.kind === 'managed' && launcher.scope !== options.expectedScope) {
    throw new Error(
      `\`${options.launcherPath}\` is a managed ${launcher.scope} launcher, not a managed ${options.expectedScope} launcher. Check the intended directory and scope before retrying.`,
    )
  }
  if (
    launcher.kind === 'managed' &&
    launcher.revision !== null &&
    launcher.revision > LAUNCHER_REVISION
  ) {
    throw new Error(
      `\`${options.launcherPath}\` uses future launcher revision ${launcher.revision}; this runtime supports revision ${LAUNCHER_REVISION}.`,
    )
  }
  if (
    launcher.kind === 'managed' &&
    launcher.minimumRuntime !== null &&
    lt(options.runtimeVersion, launcher.minimumRuntime)
  ) {
    throw new Error(
      `\`${options.launcherPath}\` requires Clooks ${launcher.minimumRuntime} or newer; selected runtime is ${options.runtimeVersion}.`,
    )
  }

  const advisory = inspectAdvisory(options.advisoryPath)
  if (advisory.kind === 'missing') return
  if (advisory.kind === 'custom') {
    throw new Error(
      `\`${options.advisoryPath}\` is custom and has no managed Clooks advisory header; it will not be overwritten.`,
    )
  }
  if (advisory.kind === 'invalid') {
    throw new Error(advisory.diagnostic ?? `\`${options.advisoryPath}\` is not inspectable.`)
  }
  if (advisory.scope !== options.expectedScope) {
    throw new Error(
      `\`${options.advisoryPath}\` is a managed ${advisory.scope} advisory, not a managed ${options.expectedScope} advisory. Check the intended directory and scope before retrying.`,
    )
  }
  if (advisory.minimumRuntime !== null && lt(options.runtimeVersion, advisory.minimumRuntime)) {
    throw new Error(
      `\`${options.advisoryPath}\` requires Clooks ${advisory.minimumRuntime} or newer; selected runtime is ${options.runtimeVersion}.`,
    )
  }
}
