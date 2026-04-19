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
