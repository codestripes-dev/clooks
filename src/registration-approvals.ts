import { isDeepStrictEqual } from 'node:util'
import type { AgentId } from './agents/types.js'
import { isRegistrationObject, type RegistrationGroup } from './registration-file.js'

export const APPROVAL_TIMEOUT_SECONDS = 330
const OWNER = /^(?:global|project:[a-f0-9]{32})$/

export interface ApprovalRegistration {
  owner: string
  command?: string
}

export function approvalCommand(agent: AgentId, owner: string, command: string): string {
  if (!OWNER.test(owner)) throw new Error('Invalid approval registration owner')
  const selected = command.startsWith(`CLOOKS_AGENT=${agent} `)
    ? command
    : `CLOOKS_AGENT=${agent} ${command}`
  return `CLOOKS_APPROVAL_PROTOCOL=1 CLOOKS_APPROVAL_OWNER=${owner} CLOOKS_APPROVAL_DISPOSITION=run ${selected}`
}

export function unpairedCommand(command: string, agent: AgentId): string {
  const prefix =
    /^CLOOKS_APPROVAL_PROTOCOL=1 CLOOKS_APPROVAL_OWNER=(global|project:[a-f0-9]{32}) CLOOKS_APPROVAL_DISPOSITION=run CLOOKS_AGENT=(claude-code|codex) /u.exec(
      command,
    )
  if (prefix?.[2] !== agent) return command
  return (agent === 'codex' ? 'CLOOKS_AGENT=codex ' : '') + command.slice(prefix[0].length)
}

export function approvalCompanion(agent: AgentId, owner: string): Record<string, unknown> {
  if (!OWNER.test(owner)) throw new Error('Invalid approval registration owner')
  return {
    type: 'mcp_tool',
    server: 'clooks',
    tool: 'check',
    timeout: APPROVAL_TIMEOUT_SECONDS,
    input: {
      protocol: 1,
      provider: agent,
      owner,
      session_id: '${session_id}',
      tool_use_id: '${tool_use_id}',
      ...(agent === 'codex' ? { turn_id: '${turn_id}' } : {}),
    },
  }
}

export function isApprovalCompanion(hook: unknown, agent: AgentId): boolean {
  if (!isRegistrationObject(hook) || !isRegistrationObject(hook.input)) return false
  if (hook.type !== 'mcp_tool' || hook.server !== 'clooks' || hook.tool !== 'check') return false
  const owner = hook.input.owner
  return (
    typeof owner === 'string' &&
    OWNER.test(owner) &&
    isDeepStrictEqual(hook.input, approvalCompanion(agent, owner).input)
  )
}

/** Remove owned entries across every group, retaining unrelated group metadata verbatim. */
export function registerApprovalPair(
  groups: RegistrationGroup[],
  agent: AgentId,
  command: string,
  registration: ApprovalRegistration,
  owned: (hook: unknown) => boolean,
): { groups: RegistrationGroup[]; changed: boolean; existed: boolean } {
  const canonical: RegistrationGroup = {
    matcher: '*',
    hooks: [
      {
        type: 'command',
        command: approvalCommand(agent, registration.owner, registration.command ?? command),
        timeout: APPROVAL_TIMEOUT_SECONDS,
      },
      approvalCompanion(agent, registration.owner),
    ],
  }
  const owns = (hook: unknown) => owned(hook) || isApprovalCompanion(hook, agent)
  const ownedGroups = groups.filter((group) => group.hooks.some(owns))
  if (ownedGroups.length === 1 && isDeepStrictEqual(ownedGroups[0], canonical)) {
    return { groups, changed: false, existed: true }
  }
  const remaining = groups.flatMap((group) => {
    const hooks = group.hooks.filter((hook) => !owns(hook))
    return hooks.length === group.hooks.length ? [group] : hooks.length ? [{ ...group, hooks }] : []
  })
  return { groups: [...remaining, canonical], changed: true, existed: ownedGroups.length > 0 }
}

// Paired suppression still completes the native check, without config discovery or hooks.
export const APPROVAL_SUPPRESSION_FUNCTION = `clooks_suppress() {
  if [ "\${CLOOKS_APPROVAL_PROTOCOL:-}" = 1 ] && [ -n "\${CLOOKS_APPROVAL_OWNER:-}" ]; then
    local binary status
    binary=$(command -v clooks 2>/dev/null) || exit 0
    CLOOKS_APPROVAL_DISPOSITION=suppressed "$binary" && status=0 || status=$?
    if [ "$status" -eq 0 ] || [ "$status" -eq 2 ]; then exit "$status"; fi
    printf '%s\\n' '[clooks] Suppression completion failed.' >&2
    exit 2
  fi
  exit 0
}
`
