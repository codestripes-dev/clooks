import type { EventName } from '../types/branded.js'
import type { HookName } from '../types/branded.js'
import type { ClooksConfig } from '../config/schema.js'
import type { loadConfig } from '../config/index.js'
import type { discoverPluginPacks } from '../plugin-discovery.js'
import type { vendorAndRegisterPack } from '../plugin-vendor.js'
import type { EngineResult, ExitCode } from '../engine/types.js'

export type AgentId = 'claude-code' | 'codex'

export interface TranslatedAgentOutput {
  output?: string
  exitCode: ExitCode
  stderr?: string
}

export type SystemMessageRoute = 'stdout-json' | 'stderr' | 'drop'

export interface TranslateFinalOutputInput {
  eventName: EventName
  result?: EngineResult
  systemMessages: string[]
  diagnostics: string[]
}

export interface AdjustResultBeforeFinalOutputInput {
  eventName: EventName
  context: Record<string, unknown>
  result?: EngineResult
}

export interface AdjustedFinalResult {
  result?: EngineResult
  systemMessages: string[]
}

export interface PrepareConfigAfterLoadInput {
  projectRoot: string
  homeRoot: string
  config: ClooksConfig
  shadows: HookName[]
  loadConfig: typeof loadConfig
  discoverPluginPacks?: typeof discoverPluginPacks
  vendorAndRegisterPack?: typeof vendorAndRegisterPack
}

export interface PrepareConfigAfterLoadResult {
  config: ClooksConfig
  shadows: HookName[]
  systemMessages: string[]
}

export interface CollectSessionStartAdvisoriesInput {
  projectRoot: string
  homeRoot: string
}

export interface AgentAdapter {
  id: AgentId
  supportsRuntime: boolean
  supportsClaudePluginAdvisories: boolean
  readEventName(payload: Record<string, unknown>): EventName | null
  prepareConfigAfterLoad(input: PrepareConfigAfterLoadInput): Promise<PrepareConfigAfterLoadResult>
  collectSessionStartAdvisories(input: CollectSessionStartAdvisoriesInput): string[]
  normalizeContext(payload: Record<string, unknown>, eventName: EventName): Record<string, unknown>
  adjustResultBeforeFinalOutput(input: AdjustResultBeforeFinalOutputInput): AdjustedFinalResult
  translateFinalOutput(input: TranslateFinalOutputInput): TranslatedAgentOutput
  routeSystemMessage(eventName: EventName, message: string): SystemMessageRoute
}

export class AgentSelectionError extends Error {
  readonly agent: string

  constructor(agent: string) {
    super(
      `clooks: unsupported CLOOKS_AGENT "${agent}". Recognized values are "claude-code" and "codex".`,
    )
    this.name = 'AgentSelectionError'
    this.agent = agent
  }
}

export class UnsupportedAgentAdapterError extends Error {
  readonly agent: AgentId

  constructor(agent: AgentId) {
    super(`clooks: CLOOKS_AGENT=${agent} is not implemented yet.`)
    this.name = 'UnsupportedAgentAdapterError'
    this.agent = agent
  }
}
