import type { AgentAdapter } from '../types.js'
import { UnsupportedAgentAdapterError } from '../types.js'

function unsupported(): never {
  throw new UnsupportedAgentAdapterError('codex')
}

export const codexAdapter: AgentAdapter = {
  id: 'codex',
  supportsRuntime: false,
  supportsClaudePluginAdvisories: false,

  // Selection can identify Codex, but runtime handling stays fail-closed until
  // Codex normalization and output translation are implemented.
  readEventName() {
    return null
  },

  async prepareConfigAfterLoad(input) {
    return {
      config: input.config,
      shadows: input.shadows,
      systemMessages: [],
    }
  },

  collectSessionStartAdvisories() {
    return []
  },

  normalizeContext() {
    return unsupported()
  },

  adjustResultBeforeFinalOutput() {
    return unsupported()
  },

  translateFinalOutput() {
    return unsupported()
  },

  routeSystemMessage() {
    return unsupported()
  },
}
