import { expect, test } from 'bun:test'
import type {
  PreToolUseResult,
  PostToolUseResult,
  UserPromptSubmitResult,
  PermissionRequestResult,
  StopEventResult,
  SubagentStopResult,
  ConfigChangeResult,
  PreCompactResult,
  PermissionDeniedResult,
  SessionStartResult,
  SessionEndResult,
  InstructionsLoadedResult,
  NotificationResult,
  PostToolUseFailureResult,
  SubagentStartResult,
  WorktreeRemoveResult,
  PostCompactResult,
  WorktreeCreateResult,
  TeammateIdleResult,
  TaskCreatedResult,
  TaskCompletedResult,
  StopFailureResult,
} from './results.js'

// --- ask / defer vocabulary ---

test('ask and defer are only valid on PreToolUseResult', () => {
  const ok1: PreToolUseResult = { result: 'ask', reason: 'confirm' }
  const ok2: PreToolUseResult = { result: 'defer' }
  expect(ok1.result).toBe('ask')
  expect(ok2.result).toBe('defer')

  // @ts-expect-error — ask is not a valid PostToolUse result
  const a: PostToolUseResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid PostToolUse result
  const b: PostToolUseResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid UserPromptSubmit result
  const c: UserPromptSubmitResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid UserPromptSubmit result
  const d: UserPromptSubmitResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid PermissionRequest result
  const e: PermissionRequestResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid PermissionRequest result
  const f: PermissionRequestResult = { result: 'defer' }
  // @ts-expect-error — ask on Stop is invalid
  const g: StopEventResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer on Stop is invalid
  const h: StopEventResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid SubagentStop result
  const i: SubagentStopResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid SubagentStop result
  const j: SubagentStopResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid ConfigChange result
  const k: ConfigChangeResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid ConfigChange result
  const l: ConfigChangeResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid PreCompact result
  const m: PreCompactResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid PreCompact result
  const n: PreCompactResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid SessionStart result
  const o: SessionStartResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid SessionStart result
  const p: SessionStartResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid SessionEnd result
  const q: SessionEndResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid SessionEnd result
  const r: SessionEndResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid InstructionsLoaded result
  const s: InstructionsLoadedResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid InstructionsLoaded result
  const t: InstructionsLoadedResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid Notification result
  const u: NotificationResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid Notification result
  const v: NotificationResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid PostToolUseFailure result
  const w: PostToolUseFailureResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid PostToolUseFailure result
  const x: PostToolUseFailureResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid SubagentStart result
  const y: SubagentStartResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid SubagentStart result
  const z: SubagentStartResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid WorktreeRemove result
  const aa: WorktreeRemoveResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid WorktreeRemove result
  const ab: WorktreeRemoveResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid PostCompact result
  const ac: PostCompactResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid PostCompact result
  const ad: PostCompactResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid WorktreeCreate result
  const ae: WorktreeCreateResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid WorktreeCreate result
  const af: WorktreeCreateResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid TeammateIdle result
  const ag: TeammateIdleResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid TeammateIdle result
  const ah: TeammateIdleResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid TaskCreated result
  const ai: TaskCreatedResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid TaskCreated result
  const aj: TaskCreatedResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid TaskCompleted result
  const ak: TaskCompletedResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid TaskCompleted result
  const al: TaskCompletedResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid PermissionDenied result
  const am: PermissionDeniedResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid PermissionDenied result
  const an: PermissionDeniedResult = { result: 'defer' }
  // @ts-expect-error — ask is not a valid StopFailure result
  const ao: StopFailureResult = { result: 'ask', reason: 'x' }
  // @ts-expect-error — defer is not a valid StopFailure result
  const ap: StopFailureResult = { result: 'defer' }
  // Extend to every other per-event result type — each line is both a
  // compile-time guarantee and a regression anchor. If a future refactor
  // accidentally widens one of these unions, the @ts-expect-error flips
  // from "expected error suppressed" to "unused directive" and build fails.
  void [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t, u, v, w, x, y, z]
  void [aa, ab, ac, ad, ae, af, ag, ah, ai, aj, ak, al, am, an, ao, ap]
})

test('AskResult.reason is required', () => {
  // @ts-expect-error — reason is required on AskResult
  const bad: PreToolUseResult = { result: 'ask' }
  void bad
})

test('DeferResult forbids reason/updatedInput/injectContext', () => {
  // @ts-expect-error — defer does not accept reason
  const a: PreToolUseResult = { result: 'defer', reason: 'nope' }
  // @ts-expect-error — defer does not accept updatedInput
  const b: PreToolUseResult = { result: 'defer', updatedInput: {} }
  // @ts-expect-error — defer does not accept injectContext
  const c: PreToolUseResult = { result: 'defer', injectContext: 'x' }
  void [a, b, c]
})

test('retry is only valid on PermissionDeniedResult', () => {
  // Positive case: retry is a valid PermissionDeniedResult
  const ok: PermissionDeniedResult = { result: 'retry' }
  expect(ok.result).toBe('retry')

  // Negative cases: retry must be rejected by every other per-event result type.
  // Each @ts-expect-error directive provides both a compile-time guarantee AND a
  // regression anchor. If a future refactor accidentally widens one of these unions,
  // the directive flips from "error suppressed" to "unused directive" and tsc fails.

  // @ts-expect-error — retry is not a valid PreToolUse result
  const a: PreToolUseResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid PostToolUse result
  const b: PostToolUseResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid UserPromptSubmit result
  const c: UserPromptSubmitResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid PermissionRequest result
  const d: PermissionRequestResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid Stop result
  const e: StopEventResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid SubagentStop result
  const f: SubagentStopResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid ConfigChange result
  const g: ConfigChangeResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid PreCompact result
  const h: PreCompactResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid SessionStart result
  const i: SessionStartResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid SessionEnd result
  const j: SessionEndResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid InstructionsLoaded result
  const k: InstructionsLoadedResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid Notification result
  const l: NotificationResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid PostToolUseFailure result
  const m: PostToolUseFailureResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid SubagentStart result
  const n: SubagentStartResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid WorktreeRemove result
  const o: WorktreeRemoveResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid PostCompact result
  const p: PostCompactResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid WorktreeCreate result
  const q: WorktreeCreateResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid TeammateIdle result
  const r: TeammateIdleResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid TaskCreated result
  const s: TaskCreatedResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid TaskCompleted result
  const t: TaskCompletedResult = { result: 'retry' }
  // @ts-expect-error — retry is not a valid StopFailure result
  const u: StopFailureResult = { result: 'retry' }

  // Silence unused-variable warnings without emitting runtime values
  void [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t, u]
})
