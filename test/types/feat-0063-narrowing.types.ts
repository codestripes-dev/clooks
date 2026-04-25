// FEAT-0063 M2 type-narrowing regression checks.
//
// The `@ts-expect-error` directives below MUST fire — if they don't, the type
// system has weakened and `Patch<T>` / DU narrowing has regressed.
//
// Run via `bun run typecheck` (the project tsconfig.json includes `test/`).
//
// Stanzas:
//   (a) PreToolUse Bash arm rejects a foreign (Write-only) key.
//   (b) PermissionRequest Bash arm rejects a foreign (Write-only) key.
//   (c) PreToolUse Bash arm rejects `null` on a required key (`command`).
//   (d) PermissionRequest Bash arm rejects `null` on a required key (`command`).
//   (e) UnknownPermissionRequestContext: type-level shape assertion for the
//       exported `UnknownPermissionRequestContext`; runtime path verified in
//       `test/e2e/context-decision-methods.e2e.test.ts` Scenario 3.

import type { PreToolUseContext, PermissionRequestContext } from '../../src/types/contexts.js'
import type { UnknownPermissionRequestContext } from '../../src/types/index.js'

declare const ctx: PreToolUseContext
declare const permCtx: PermissionRequestContext
declare const unknownPermCtx: UnknownPermissionRequestContext

// (a) PreToolUse: passing a Write-only field on a Bash arm is an error.
if (ctx.toolName === 'Bash') {
  // @ts-expect-error — filePath does not exist on Patch<BashToolInput>
  ctx.allow({ updatedInput: { filePath: '/tmp' } })
}

// (b) PermissionRequest: same shape — a Write-only field on a Bash arm is an error.
if (permCtx.toolName === 'Bash') {
  permCtx.allow({
    updatedInput: {
      command: 'x',
      // @ts-expect-error — filePath does not exist on Patch<BashToolInput>
      filePath: 'y',
    },
  })
}

// (c) PreToolUse: `null` on a required key (`command`) is forbidden by Patch<T>.
//     Per src/types/patch.ts: required keys accept `T[K]` only, not `T[K] | null`.
//     Stripping a required key would send Bash a call missing `command`.
if (ctx.toolName === 'Bash') {
  // @ts-expect-error — `null` is not assignable to required key `command` on Patch<BashToolInput>
  ctx.allow({ updatedInput: { command: null } })
}

// (d) PermissionRequest: same Patch<T> guarantee for the Bash arm's required key.
if (permCtx.toolName === 'Bash') {
  // @ts-expect-error — `null` is not assignable to required key `command` on Patch<BashToolInput>
  permCtx.allow({ updatedInput: { command: null } })
}

// (f) `createContext` payload tightening regression check.
//     Verifies `CreateContextPayload<E>` tightening — was `Partial<...>` in
//     M1, tightened to `Omit<EventContext, BaseDefaultedKeys |
//     DecisionMethodKeys>` in M3. Excess-property checks must reject keys
//     that are not on the per-event payload type.
import { createContext } from '../../src/testing/create-context.js'

// Stop's payload accepts `stopHookActive` and `lastAssistantMessage`. A key
// not on the payload (e.g. `unrelatedKey`) must be a TS error.
// @ts-expect-error — `unrelatedKey` is not a key on the Stop payload type
createContext('Stop', { unrelatedKey: 'x', stopHookActive: false, lastAssistantMessage: '' })

// WorktreeCreate's payload requires `name: string` only. Extra keys are
// rejected by the excess-property check that the M3 `Omit<...>` form enables.
// @ts-expect-error — `someOtherKey` is not a key on the WorktreeCreate payload
createContext('WorktreeCreate', { name: 'x', someOtherKey: 1 })

// (e) UnknownPermissionRequestContext shape assertions.
//     The unknown-tool variant is the loose-typed escape hatch for MCP / future
//     tools. `toolInput` is `Record<string, unknown>` and the `allow` method's
//     `updatedInput` accepts any string-keyed patch (no Patch<T> narrowing).
{
  // toolName is a plain string, not a known-tool literal union.
  const _name: string = unknownPermCtx.toolName
  void _name

  // toolInput is Record<string, unknown> on the unknown variant.
  const _input: Record<string, unknown> = unknownPermCtx.toolInput
  void _input

  // allow accepts an arbitrary string-keyed patch on the unknown variant.
  unknownPermCtx.allow({ updatedInput: { foo: 'bar' } })
  unknownPermCtx.allow({ updatedInput: { anything: 42, nested: { ok: true } } })
  // null values are accepted in the loose-typed patch (Record<string, unknown>
  // tolerates null since `unknown` permits null).
  unknownPermCtx.allow({ updatedInput: { foo: null } })

  // skip is available on the unknown variant.
  unknownPermCtx.skip()
}
