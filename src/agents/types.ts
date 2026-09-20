import type { EventName } from '../types/branded.js'
import type { HookName } from '../types/branded.js'
import type { ClooksConfig } from '../config/schema.js'
import type { loadConfig } from '../config/index.js'
import type { discoverPluginPacks } from '../plugin-discovery.js'
import type { discoverCodexPluginPacks } from './codex/plugin-discovery.js'
import type { vendorAndRegisterPack } from '../plugin-vendor.js'
import type { EngineResult, ExitCode } from '../engine/types.js'
import type { AgentId } from '../types/contexts.js'
import type { ApprovalQuestion } from '../interaction/types.js'
import type { CheckInput } from '../interaction/protocol.js'
import type { UserApprovalDecision } from '../interaction/protocol.js'

export type { AgentId }

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
  applyPatch(current: unknown, patch: Readonly<Record<string, unknown>>): Record<string, unknown>
  encode(input: Readonly<Record<string, unknown>>): JsonValue
}

export interface InvocationMetadata {
  agent: AgentId
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
  currentToolInput?: unknown
}

export interface RuntimePolicyFailure {
  eventName: EventName | null
  hookName?: HookName
  capability: string
  message: string
  approvalDecision?: UserApprovalDecision
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
  /** Preserve Claude's legacy mutable context when an invocation policy is wrapped. */
  mutableToolInput?: boolean
  approvalOperation?(input: unknown, changed: boolean): ApprovalQuestion['operation']
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
  /**
   * Warnings accumulated before the failure. Each adapter decides where they
   * fit, and drops them where the protocol offers no channel that reaches the
   * user without reshaping the failure itself.
   */
  systemMessages?: string[]
}

export interface TranslatedAgentOutput {
  output?: string
  exitCode: ExitCode
  stderr?: string
  approvalDecision?: UserApprovalDecision
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
  codexHome?: string
  hasProjectConfig?: boolean
  config: ClooksConfig
  shadows: HookName[]
  loadConfig: typeof loadConfig
  discoverPluginPacks?: typeof discoverPluginPacks
  discoverCodexPluginPacks?: typeof discoverCodexPluginPacks
  vendorAndRegisterPack?: typeof vendorAndRegisterPack
}

export interface PrepareConfigAfterLoadResult {
  hasProjectConfig?: boolean
  config: ClooksConfig
  shadows: HookName[]
  systemMessages: string[]
}

export interface CollectSessionStartAdvisoriesInput {
  projectRoot: string
  homeRoot: string
  codexHome?: string
  discoverCodexPluginPacks?: typeof discoverCodexPluginPacks
}

export interface AgentAdapter {
  approvalIdentity(payload: Record<string, unknown>, owner: string, protocol: string): CheckInput
  approvalOperation(
    invocation: NormalizedInvocation,
    input: unknown,
    changed: boolean,
  ): ApprovalQuestion['operation']
  serializedApprovalOperation(
    invocation: NormalizedInvocation,
    output: TranslatedAgentOutput,
  ): ApprovalQuestion['operation'] | null
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
