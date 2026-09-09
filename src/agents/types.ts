import type { EventName } from '../types/branded.js'
import type { HookName } from '../types/branded.js'
import type { ClooksConfig } from '../config/schema.js'
import type { loadConfig } from '../config/index.js'
import type { discoverPluginPacks } from '../plugin-discovery.js'
import type { vendorAndRegisterPack } from '../plugin-vendor.js'
import type { EngineResult, ExitCode } from '../engine/types.js'
import type { Provider } from '../types/contexts.js'

export type AgentId = Provider

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }
export type ResultOrigin =
  | 'before-hook'
  | 'handler'
  | 'engine-error'
  | 'parallel-contract'
  | 'load-error'
  | 'engine-diagnostic'

export interface ToolCodec {
  canonicalName: string
  decode(input: JsonValue): Record<string, unknown>
  applyPatch(
    current: Readonly<Record<string, unknown>>,
    patch: Readonly<Record<string, unknown>>,
  ): Record<string, unknown>
  encode(input: Readonly<Record<string, unknown>>): JsonValue
}

export interface InvocationMetadata {
  provider: AgentId
  raw: Readonly<Record<string, unknown>>
  sessionId: string | null
  nativeTurnId: string | null
  referencedAgentId: string | null
  tool: ToolCodec | null
}

export interface NormalizedInvocation {
  eventName: EventName
  context: Record<string, unknown>
  private: InvocationMetadata
}

export interface ResultPolicyInput {
  value: unknown
  origin: ResultOrigin
  hookName?: HookName
  parallel: boolean
  currentToolInput?: Readonly<Record<string, unknown>>
}

export interface RuntimePolicyFailure {
  eventName: EventName | null
  hookName?: HookName
  capability: string
  message: string
}

export class InvocationPolicyError extends Error {
  constructor(readonly failure: RuntimePolicyFailure) {
    super(failure.message)
    this.name = 'InvocationPolicyError'
  }
}

export type CheckedResult =
  | {
      kind: 'accepted'
      result?: EngineResult
      nextToolInput?: Record<string, unknown>
      diagnostics: string[]
    }
  | { kind: 'rejected'; failure: RuntimePolicyFailure }

export interface InvocationResultPolicy {
  /** Audit ordinary crash blocks after configured continuation and failure accounting. */
  deferRuntimeErrorAudit?: boolean
  validateRawResult?(value: unknown): RuntimePolicyFailure | undefined
  checkResult(input: ResultPolicyInput): CheckedResult
  handoff?: {
    isEligible(field: 'injectContext' | 'reason' | 'feedback'): boolean
    inlineDiagnostic: string
  }
}

export interface InvocationTurnPolicy {
  sessionId: string
  scopeKey: string
  boundary: 'reset' | 'advance' | null
  prune: boolean
}

export interface ComposeDiagnosticsInput {
  eventName: EventName
  result?: EngineResult
  traceMessages: string[]
  degradedMessages: string[]
  debugMessages: string[]
}

export interface ComposedDiagnostics {
  result?: EngineResult
  stderr: string[]
  systemMessages: string[]
}

export interface TranslateFailureInput {
  eventName: EventName | null
  invocation?: NormalizedInvocation
  failure: RuntimePolicyFailure
}

export interface TranslatedAgentOutput {
  output?: string
  exitCode: ExitCode
  stderr?: string
}

export type SystemMessageRoute = 'stdout-json' | 'stderr' | 'drop'

export interface TranslateFinalOutputInput {
  eventName: EventName
  invocation?: NormalizedInvocation
  policyFailure?: RuntimePolicyFailure
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
  inputStage?: 'before-hooks' | 'after-hooks'
  resolveTurnPolicy?(invocation: NormalizedInvocation): InvocationTurnPolicy | null
  readEventName(payload: Record<string, unknown>): EventName | null
  prepareConfigAfterLoad(input: PrepareConfigAfterLoadInput): Promise<PrepareConfigAfterLoadResult>
  collectSessionStartAdvisories(input: CollectSessionStartAdvisoriesInput): string[]
  normalizeInvocation(payload: Record<string, unknown>, eventName: EventName): NormalizedInvocation
  discoveryEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined>
  createResultPolicy(invocation: NormalizedInvocation): InvocationResultPolicy
  composeDiagnostics(input: ComposeDiagnosticsInput): ComposedDiagnostics
  translateFailure(input: TranslateFailureInput): TranslatedAgentOutput
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
