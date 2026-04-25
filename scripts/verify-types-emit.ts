// FEAT-0063 M4 hard acceptance gate.
//
// Imports the bundled `.d.ts` and exercises each event-class's decision-method
// set under `tsc --noEmit`. If `dts-bundle-generator` (run with `--no-check`)
// silently elides any intersected method signature, this file fails the
// project typecheck — which is the correctness gate the regex-against-bundle
// approach can't provide (false-positive- and false-negative-prone).
//
// One stanza per event category:
//   - tool-keyed (PreToolUse:Bash + Patch<BashToolInput>)
//   - guard (UserPromptSubmit)
//   - observe (PostToolUse)
//   - continuation (TeammateIdle)
//   - implementation (WorktreeCreate)
//   - notify-only (StopFailure)
//   - tool-keyed permission (PermissionRequest:Bash)
//   - permission observe (PermissionDenied)
//   - unknown variant (UnknownPermissionRequestContext) — explicitly the type
//     that was missing from the bundle in M2; this stanza fails the build if
//     the export-elision regression returns.
//
// To intentionally trigger a regression check, comment out one of the
// `declare const ctx: <Type>` lines or change the type to a non-existent
// name; `bun run typecheck` should then surface a clear error.

import type {
  PreToolUseContext,
  UnknownPreToolUseContext,
  UserPromptSubmitContext,
  PostToolUseContext,
  TeammateIdleContext,
  WorktreeCreateContext,
  StopFailureContext,
  SessionStartContext,
  PermissionRequestContext,
  UnknownPermissionRequestContext,
  PermissionDeniedContext,
  BashToolInput,
  Patch,
} from '../src/generated/clooks-types'

// --- Tool-keyed PreToolUse:Bash arm ---
declare const preToolUseCtx: PreToolUseContext
if (preToolUseCtx.toolName === 'Bash') {
  // Exercise Patch<BashToolInput> bundling: the timeout key must narrow to
  // `number | null | undefined` (number is required, null forbidden on
  // required keys but timeout is optional so `null` is permitted).
  const r1 = preToolUseCtx.allow({
    updatedInput: { timeout: 60000 satisfies Patch<BashToolInput>['timeout'] },
  })
  void r1
  const r2 = preToolUseCtx.block({ reason: 'no' })
  void r2
  const r3 = preToolUseCtx.skip()
  void r3
  const r4 = preToolUseCtx.ask({ reason: 'why' })
  void r4
}

// --- Patch<T> required-key-null guard (regression check) ---
// If Patch<T> reverts to `{ [K in keyof T]?: T[K] | null }` (no OptionalKeys<T> guard),
// the line below would compile and the engine's omitBy would strip Bash's required `command`.
// The @ts-expect-error directive MUST fire — if it doesn't, the guard has regressed.
declare const patchGuardCtx: PreToolUseContext
if (patchGuardCtx.toolName === 'Bash') {
  // @ts-expect-error — command is required on BashToolInput; null forbidden on required keys.
  const _patchGuardResult = patchGuardCtx.allow({ updatedInput: { command: null } })
  void _patchGuardResult
}

// Unknown PreToolUse variant: loose-typed escape hatch for MCP / future tools.
declare const unknownPreCtx: UnknownPreToolUseContext
{
  const r = unknownPreCtx.allow({ updatedInput: { foo: 'bar' } })
  void r
}

// --- Guard event: UserPromptSubmit ---
declare const guardCtx: UserPromptSubmitContext
{
  const r = guardCtx.allow({ injectContext: 'ctx' })
  void r
  const r2 = guardCtx.block({ reason: 'r' })
  void r2
  const r3 = guardCtx.skip()
  void r3
}

// --- Observe event: PostToolUse ---
declare const observeCtx: PostToolUseContext
{
  const r = observeCtx.skip({ injectContext: 'c' })
  void r
  const r2 = observeCtx.block({ reason: 'r' })
  void r2
}

// --- Continuation event: TeammateIdle (continue/stop/skip) ---
declare const continuationCtx: TeammateIdleContext
{
  const r = continuationCtx.continue({ feedback: 'keep going' })
  void r
  const r2 = continuationCtx.stop({ reason: 'done' })
  void r2
  const r3 = continuationCtx.skip()
  void r3
}

// --- Implementation event: WorktreeCreate (success/failure) ---
declare const implCtx: WorktreeCreateContext
{
  const r = implCtx.success({ path: '/tmp/wt' })
  void r
  const r2 = implCtx.failure({ reason: 'no disk' })
  void r2
}

// --- Notify-only event: StopFailure (skip-only; output dropped upstream) ---
declare const notifyCtx: StopFailureContext
{
  const r = notifyCtx.skip()
  void r
}

// --- Skip-only observe: SessionStart (representative) ---
// SessionStart shares its method set (skip only) with: SessionEnd, InstructionsLoaded,
// PostToolUseFailure, Notification, SubagentStart, WorktreeRemove, PostCompact.
// METHOD_SETS exhaustive wiring (in src/engine/context-methods.test.ts) covers the
// runtime side; this stanza covers the bundled-.d.ts side.
declare const sessionStartCtx: SessionStartContext
const sessionStartResult = sessionStartCtx.skip({ injectContext: 'session start observed' })
void sessionStartResult

// --- Tool-keyed PermissionRequest:Bash arm ---
declare const permReqCtx: PermissionRequestContext
if (permReqCtx.toolName === 'Bash') {
  const r = permReqCtx.allow({
    updatedInput: { timeout: 60000 satisfies Patch<BashToolInput>['timeout'] },
  })
  void r
  const r2 = permReqCtx.block({ reason: 'r' })
  void r2
  const r3 = permReqCtx.skip()
  void r3
}

// --- UnknownPermissionRequestContext: the M2 elision sentinel ---
//     This import line is the canary for the export-elision regression.
//     If `dts-bundle-generator` drops `export` from the type, this file
//     fails to compile.
declare const unknownPermCtx: UnknownPermissionRequestContext
{
  const r = unknownPermCtx.allow({ updatedInput: { foo: 'bar' } })
  void r
  const r2 = unknownPermCtx.skip()
  void r2
}

// --- PermissionDenied (retry/skip) ---
declare const permDeniedCtx: PermissionDeniedContext
{
  const r = permDeniedCtx.retry()
  void r
  const r2 = permDeniedCtx.skip()
  void r2
}
