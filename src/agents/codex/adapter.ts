import type { AgentAdapter } from '../types.js'
import { preparePluginPacks } from '../prepare-plugin-packs.js'
import { normalizeInvocation, readEventName } from './normalize.js'
import { createResultPolicy } from './policy.js'
import { translateFailure, translateFinalOutput } from './translate.js'
import {
  approvalIdentity,
  approvalOperation,
  serializedApprovalOperation,
} from '../approval-operation.js'

export const codexAdapter: AgentAdapter = {
  approvalIdentity: (raw, owner, protocol) => approvalIdentity('codex', raw, owner, protocol),
  approvalOperation,
  serializedApprovalOperation,
  id: 'codex',
  supportsRuntime: true,
  supportsClaudePluginAdvisories: false,
  inputStage: 'before-hooks',
  readEventName,

  async prepareConfigAfterLoad(input) {
    if (!input.discoverCodexPluginPacks || !input.vendorAndRegisterPack) {
      return {
        config: input.config,
        shadows: input.shadows,
        hasProjectConfig: input.hasProjectConfig,
        systemMessages: [],
      }
    }
    return preparePluginPacks(
      input,
      input.discoverCodexPluginPacks({
        homeRoot: input.homeRoot,
        projectRoot: input.projectRoot,
        codexHome: input.codexHome,
      }),
      input.vendorAndRegisterPack,
    )
  },

  collectSessionStartAdvisories() {
    return []
  },

  normalizeInvocation,

  discoveryEnvironment(env) {
    const copy = { ...env }
    delete copy.CLAUDE_PROJECT_DIR
    return copy
  },

  createResultPolicy,
  resolveTurnPolicy(invocation) {
    if (invocation.eventName === 'SessionEnd') return null
    const { sessionId, nativeTurnId, referencedAgentId } = invocation.private
    const sessionStart = invocation.eventName === 'SessionStart'
    if (!sessionId || (!sessionStart && !nativeTurnId)) return null
    const rootPrompt = invocation.eventName === 'UserPromptSubmit' && !referencedAgentId
    const reset =
      sessionStart &&
      (invocation.context.source === 'startup' || invocation.context.source === 'clear')
    return {
      sessionId,
      scopeKey: referencedAgentId ? `agent:${referencedAgentId}` : 'main',
      boundary: reset ? 'reset' : rootPrompt ? 'advance' : null,
      prune: sessionStart,
    }
  },
  composeDiagnostics(input) {
    let result = input.result
    const contextChannel = [
      'SessionStart',
      'SubagentStart',
      'PreToolUse',
      'PostToolUse',
      'UserPromptSubmit',
    ].includes(input.eventName)
    if (contextChannel && input.traceMessages.length > 0) {
      result = {
        ...(result ?? { result: 'skip' }),
        injectContext: [result?.injectContext, ...input.traceMessages]
          .filter((text) => text !== undefined)
          .join('\n'),
      }
    }
    return {
      result,
      stderr: input.debugMessages.map((line) => `[clooks:debug] ${line}`),
      systemMessages: [...input.degradedMessages, ...(contextChannel ? [] : input.traceMessages)],
    }
  },
  translateFailure,
  adjustResultBeforeFinalOutput(input) {
    return { result: input.result, systemMessages: [] }
  },
  translateFinalOutput,
  routeSystemMessage(eventName) {
    return eventName === 'SessionEnd' ? 'stderr' : 'stdout-json'
  },
}
