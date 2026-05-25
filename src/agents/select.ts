import { claudeCodeAdapter } from './claude-code/adapter.js'
import { codexAdapter } from './codex/adapter.js'
import type { AgentAdapter } from './types.js'
import { AgentSelectionError } from './types.js'

export interface AgentSelectionEnv {
  CLOOKS_AGENT?: string
}

export function selectAgentAdapter(
  env: AgentSelectionEnv = process.env as AgentSelectionEnv,
): AgentAdapter {
  const requestedAgent = env.CLOOKS_AGENT
  if (requestedAgent === undefined || requestedAgent === '') {
    return claudeCodeAdapter
  }
  if (requestedAgent === 'claude-code') {
    return claudeCodeAdapter
  }
  if (requestedAgent === 'codex') {
    return codexAdapter
  }
  throw new AgentSelectionError(requestedAgent)
}
