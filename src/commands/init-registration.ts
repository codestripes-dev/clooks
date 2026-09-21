import { join } from 'node:path'
import type { AgentId } from '../agents/types.js'
import { CLAUDE_CODE_EVENTS } from '../config/constants.js'
import { CODEX_REGISTRATION_EVENTS } from '../agents/codex/settings.js'
import { readRegistrationFile, readRegistrationText } from '../registration-file.js'
import {
  assertClaudeRegistrationLayout,
  mcpRegistrationPath,
  prepareMcpRegistration,
} from '../registration-mcp.js'
import { prepareProjectIdentity } from '../registration-project.js'

export function prepareInitRegistrations(
  root: string,
  home: string,
  agents: AgentId[],
  global: boolean,
  codexHome?: string,
) {
  if (agents.includes('claude-code')) assertClaudeRegistrationLayout(home)
  const servers = new Map<AgentId, ReturnType<typeof prepareMcpRegistration>>()
  const identities = new Map<AgentId, ReturnType<typeof prepareProjectIdentity>>()
  for (const agent of agents) {
    const hooks =
      agent === 'codex'
        ? join(codexHome ?? join(root, '.codex'), 'hooks.json')
        : join(root, '.claude/settings.json')
    readRegistrationText(hooks)
    readRegistrationFile(
      hooks,
      agent === 'codex' ? CODEX_REGISTRATION_EVENTS : [...CLAUDE_CODE_EVENTS],
    )
    servers.set(
      agent,
      prepareMcpRegistration(mcpRegistrationPath(root, agent, global, codexHome), agent),
    )
    if (!global) identities.set(agent, prepareProjectIdentity(root, agent))
    if (global)
      readRegistrationText(
        join(
          root,
          '.clooks',
          agent === 'codex' ? '.global-entrypoint-active.codex' : '.global-entrypoint-active',
        ),
      )
  }
  for (const path of [
    '.clooks/hooks/types.d.ts',
    '.clooks/clooks.schema.json',
    '.clooks/clooks.yml',
    '.clooks/bin/entrypoint.sh',
    '.clooks/bin/runtime-advisory.sh',
    ...(!global ? ['.gitignore'] : []),
  ])
    readRegistrationText(join(root, path))
  return { servers, identities }
}
