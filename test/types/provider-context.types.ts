import type {
  Provider,
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
import type { Provider as BundledProvider } from '../../src/generated/clooks-types.js'
import type { ContextHelpers as BundledContextHelpers } from '../../src/generated/clooks-types.js'
import type { AgentId } from '../../src/agents/types.js'
import type { CreateContextPayload } from '../../src/testing/create-context.js'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

export type ProviderChecks = [
  Assert<Equal<Provider, 'claude-code' | 'codex'>>,
  Assert<Equal<Provider, AgentId>>,
  Assert<Equal<Provider, BundledProvider>>,
  Assert<Equal<BaseContext['provider'], Provider>>,
  Assert<Equal<BaseContext['helpers'], ContextHelpers>>,
  Assert<Equal<ContextHelpers, BundledContextHelpers>>,
  Assert<Equal<BeforeHookEvent['input']['provider'], Provider>>,
  Assert<Equal<AfterHookEvent['input']['provider'], Provider>>,
  Assert<Equal<UnknownPreToolUseContext['provider'], Provider>>,
  Assert<Equal<UnknownPermissionRequestContext['provider'], Provider>>,
  Assert<Equal<UnknownPostToolUseContext['provider'], Provider>>,
  Assert<Equal<UnknownPostToolUseFailureContext['provider'], Provider>>,
  Assert<Equal<CreateContextPayload<'PreToolUse'>['provider'], Provider | undefined>>,
  Assert<Equal<CreateContextPayload<'PermissionRequest'>['provider'], Provider | undefined>>,
  Assert<Equal<CreateContextPayload<'Stop'>['provider'], Provider | undefined>>,
]

type EventChecks = {
  [E in keyof EventContextMap]: Equal<EventContextMap[E]['provider'], Provider>
}[keyof EventContextMap]
export type EveryEventHasProvider = Assert<Equal<EventChecks, true>>

type HelperChecks = {
  [E in keyof EventContextMap]: Equal<EventContextMap[E]['helpers'], ContextHelpers>
}[keyof EventContextMap]
export type EveryEventHasHelpers = Assert<Equal<HelperChecks, true>>

declare const context: BaseContext
const valid: Provider = context.provider
// @ts-expect-error Provider cannot be omitted from a real context.
const missing: BaseContext = {} as Omit<BaseContext, 'provider'>
// @ts-expect-error Unknown provider names are not public identity values.
const unknown: Provider = 'other'
// @ts-expect-error Null is not an available provider.
const nullable: Provider = null
declare const before: BeforeHookEvent
// @ts-expect-error Provider belongs to lifecycle input, not duplicated metadata.
before.meta.provider
void [valid, missing, unknown, nullable]
