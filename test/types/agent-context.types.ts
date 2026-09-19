import type {
  AgentId,
  ContextHelpers,
  BaseContext,
  EventContextMap,
  BeforeHookEvent,
  AfterHookEvent,
  UnknownPreToolUseContext,
  UnknownPermissionRequestContext,
  UnknownPostToolUseContext,
  UnknownPostToolUseFailureContext,
} from '../../src/types/index.js'
import type { AgentId as BundledAgentId } from '../../src/generated/clooks-types.js'
import type { ContextHelpers as BundledContextHelpers } from '../../src/generated/clooks-types.js'
import type { AgentId as InternalAgentId } from '../../src/agents/types.js'
import type { CreateContextPayload } from '../../src/testing/create-context.js'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

export type AgentChecks = [
  Assert<Equal<AgentId, 'claude-code' | 'codex'>>,
  Assert<Equal<AgentId, InternalAgentId>>,
  Assert<Equal<AgentId, BundledAgentId>>,
  Assert<Equal<BaseContext['agent'], AgentId>>,
  Assert<Equal<BaseContext['helpers'], ContextHelpers>>,
  Assert<Equal<ContextHelpers, BundledContextHelpers>>,
  Assert<Equal<BeforeHookEvent['input']['agent'], AgentId>>,
  Assert<Equal<AfterHookEvent['input']['agent'], AgentId>>,
  Assert<Equal<UnknownPreToolUseContext['agent'], AgentId>>,
  Assert<Equal<UnknownPermissionRequestContext['agent'], AgentId>>,
  Assert<Equal<UnknownPostToolUseContext['agent'], AgentId>>,
  Assert<Equal<UnknownPostToolUseFailureContext['agent'], AgentId>>,
  Assert<Equal<CreateContextPayload<'PreToolUse'>['agent'], AgentId | undefined>>,
  Assert<Equal<CreateContextPayload<'PermissionRequest'>['agent'], AgentId | undefined>>,
  Assert<Equal<CreateContextPayload<'Stop'>['agent'], AgentId | undefined>>,
]

type EventChecks = {
  [E in keyof EventContextMap]: Equal<EventContextMap[E]['agent'], AgentId>
}[keyof EventContextMap]
export type EveryEventHasAgent = Assert<Equal<EventChecks, true>>

type HelperChecks = {
  [E in keyof EventContextMap]: Equal<EventContextMap[E]['helpers'], ContextHelpers>
}[keyof EventContextMap]
export type EveryEventHasHelpers = Assert<Equal<HelperChecks, true>>

declare const context: BaseContext
const valid: AgentId = context.agent
// @ts-expect-error Agent cannot be omitted from a real context.
const missing: BaseContext = {} as Omit<BaseContext, 'agent'>
// @ts-expect-error Unknown agent names are not public identity values.
const unknown: AgentId = 'other'
// @ts-expect-error Null is not an available agent.
const nullable: AgentId = null
declare const before: BeforeHookEvent
// @ts-expect-error Agent belongs to lifecycle input, not duplicated metadata.
before.meta.agent
void [valid, missing, unknown, nullable]
