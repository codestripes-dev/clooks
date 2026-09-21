import type { AgentId } from './agents/types.js'
import {
  inspectInstallation,
  type InspectInstallationOptions,
  type RepairCommand,
  type ScopeStatus,
} from './installation-status.js'

export interface CollectInstallationAdvisoriesOptions {
  agent: AgentId
  projectRoot: string
  installationHome: string
  executable: string
  binaryVersion: string
  env: Readonly<Record<string, string | undefined>>
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function renderCommand(command: RepairCommand): string {
  const environment = Object.entries(command.env).map(
    ([name, value]) => `${name}=${quoteShell(value)}`,
  )
  const invocation = [
    ...environment,
    quoteShell(command.executable),
    ...command.args.map(quoteShell),
  ].join(' ')
  return `cd ${quoteShell(command.cwd)} && ${invocation}`
}

function agentSelector(status: ScopeStatus, activeAgent: AgentId): AgentId | 'all' {
  if (status.agents.length === 2) return 'all'
  return status.agents[0] ?? activeAgent
}

function renderCheckCommand(
  options: CollectInstallationAdvisoriesOptions,
  status: ScopeStatus,
): string {
  const invocation = [
    quoteShell(options.executable),
    'init',
    '--check',
    ...(status.scope === 'global' ? ['--global'] : []),
    '--agent',
    agentSelector(status, options.agent),
  ].join(' ')
  return `cd ${quoteShell(status.root)} && ${invocation}`
}

function collectActionableScopes(scopes: ScopeStatus[], agent: AgentId): ScopeStatus[] {
  return scopes.filter(
    (status) =>
      status.agents.includes(agent) &&
      (status.needsBinaryUpdate ||
        status.needsIntegrationRefresh ||
        status.state === 'uninspectable'),
  )
}

function scopeCopy(scope: ScopeStatus['scope']): {
  subject: string
  integration: string
  unverifiable: string
} {
  return scope === 'project'
    ? {
        subject: "This project's Clooks runtime",
        integration: "This project's Clooks integration is outdated",
        unverifiable: "Cannot verify this project's Clooks installation",
      }
    : {
        subject: 'The global Clooks runtime',
        integration: 'The global Clooks integration is outdated',
        unverifiable: 'Cannot verify the global Clooks installation',
      }
}

export function collectInstallationAdvisories(
  options: CollectInstallationAdvisoriesOptions,
): string[] {
  let inspection: ReturnType<typeof inspectInstallation>
  try {
    const inspectOptions: InspectInstallationOptions = {
      projectRoot: options.projectRoot,
      installationHome: options.installationHome,
      executable: options.executable,
      binaryVersion: options.binaryVersion,
      env: options.env,
      agents: [options.agent],
    }
    inspection = inspectInstallation(inspectOptions)
  } catch {
    return []
  }

  const actionable = collectActionableScopes(inspection.scopes, options.agent)
  if (actionable.length === 0) return []

  const binaryRequirements: string[] = []
  const integrationRequirements: string[] = []
  const inspectionFailures: string[] = []
  const repairCommands: string[] = []
  const checkCommands: string[] = []
  for (const status of actionable) {
    const copy = scopeCopy(status.scope)
    if (status.needsBinaryUpdate) {
      binaryRequirements.push(
        `${copy.subject} requires Clooks ${status.minimumRuntime ?? 'at a newer version'} or newer; running ${options.binaryVersion}`,
      )
    }
    if (status.state === 'uninspectable') {
      inspectionFailures.push(copy.unverifiable)
      checkCommands.push(renderCheckCommand(options, status))
      continue
    }
    if (status.needsIntegrationRefresh) {
      integrationRequirements.push(copy.integration)
      if (status.repair) repairCommands.push(renderCommand(status.repair))
      else checkCommands.push(renderCheckCommand(options, status))
    }
  }

  const setupPrefix = options.agent === 'codex' ? '$clooks:setup' : '/clooks:setup'
  const guidance: string[] = []
  if (binaryRequirements.length > 0) {
    const manualRefresh =
      repairCommands.length > 0
        ? ` and then refresh manually with ${repairCommands.map((command) => `\`${command}\``).join(' then ')}`
        : ''
    guidance.push(
      `For the required binary update, run ${setupPrefix} update, or update Clooks using its original installation method before any init${manualRefresh}`,
    )
  } else if (repairCommands.length > 0) {
    guidance.push(
      `Run ${setupPrefix} update, or refresh manually with ${repairCommands.map((command) => `\`${command}\``).join(' then ')}`,
    )
  }
  if (checkCommands.length > 0) {
    guidance.push(
      `For check-only diagnosis, run ${setupPrefix} check or ${checkCommands.map((command) => `\`${command}\``).join(' and ')}`,
    )
  }
  const requirements = [...binaryRequirements, ...integrationRequirements, ...inspectionFailures]
  return [`[clooks] ${requirements.join('; ')}. ${guidance.join('. ')}.`]
}
