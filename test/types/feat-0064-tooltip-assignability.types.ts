// FEAT-0064 M3 acceptance-gate test.
//
// Coverage is allocated per *primitive shape × opts-bag combination actually in
// use* across the 22 events (~12-15 unique combos). For each method-shape
// primitive we assert (a) opts-shape (positive assignment + `@ts-expect-error`
// on bogus key), (b) return type (positive `satisfies` + `@ts-expect-error`
// against a foreign event-result), and (c) for required-opts shapes (Block,
// Ask, Continue, Stop, Success, Failure), a missing-opts `@ts-expect-error`.
//
// Two dedicated narrowing stanzas verify `Patch<Input>` still narrows after
// composition for the two generic types (`PreToolUse`, `PermissionRequest`).
//
// Run via `bun run typecheck`. The expect-error directives are the gate:
// if any directive does NOT fire, `tsc --noEmit` reports "unused
// ts-expect-error" and this milestone fails.

import type {
  PreToolUseContext,
  PermissionRequestContext,
  StopContext,
  SubagentStopContext,
  ConfigChangeContext,
  PreCompactContext,
  UserPromptSubmitContext,
  PostToolUseContext,
  PostToolUseFailureContext,
  NotificationContext,
  SessionStartContext,
  SessionEndContext,
  InstructionsLoadedContext,
  SubagentStartContext,
  WorktreeRemoveContext,
  WorktreeCreateContext,
  StopFailureContext,
  PermissionDeniedContext,
  TeammateIdleContext,
  TaskCreatedContext,
  TaskCompletedContext,
  PostCompactContext,
} from '../../src/types/contexts.js'
import type {
  StopEventResult,
  SubagentStopResult,
  ConfigChangeResult,
  PreCompactResult,
  UserPromptSubmitResult,
  PostToolUseResult,
  PostToolUseFailureResult,
  NotificationResult,
  SessionStartResult,
  SessionEndResult,
  InstructionsLoadedResult,
  SubagentStartResult,
  WorktreeRemoveResult,
  WorktreeCreateResult,
  StopFailureResult,
  PermissionDeniedResult,
  TeammateIdleResult,
  TaskCreatedResult,
  TaskCompletedResult,
  PostCompactResult,
  PreToolUseResult,
  PermissionRequestResult,
} from '../../src/types/results.js'

declare const stopCtx: StopContext
declare const subagentStopCtx: SubagentStopContext
declare const configChangeCtx: ConfigChangeContext
declare const preCompactCtx: PreCompactContext
declare const userPromptCtx: UserPromptSubmitContext
declare const postToolUseCtx: PostToolUseContext
declare const postToolUseFailureCtx: PostToolUseFailureContext
declare const notificationCtx: NotificationContext
declare const sessionStartCtx: SessionStartContext
declare const sessionEndCtx: SessionEndContext
declare const instructionsLoadedCtx: InstructionsLoadedContext
declare const subagentStartCtx: SubagentStartContext
declare const worktreeRemoveCtx: WorktreeRemoveContext
declare const worktreeCreateCtx: WorktreeCreateContext
declare const stopFailureCtx: StopFailureContext
declare const permissionDeniedCtx: PermissionDeniedContext
declare const teammateIdleCtx: TeammateIdleContext
declare const taskCreatedCtx: TaskCreatedContext
declare const taskCompletedCtx: TaskCompletedContext
declare const postCompactCtx: PostCompactContext
declare const preToolUseCtx: PreToolUseContext
declare const permReqCtx: PermissionRequestContext

// --- Allow<DebugMessage, R> ---
// Representative: Stop, SubagentStop, ConfigChange, PreCompact.
{
  // opts shape
  const _ok0: Parameters<StopContext['allow']>[0] = undefined
  const _ok1: Parameters<StopContext['allow']>[0] = { debugMessage: 'x' }
  // @ts-expect-error — bogus field rejected
  const _bad: Parameters<StopContext['allow']>[0] = { bogus: true }
  void _ok0
  void _ok1
  void _bad

  // return type — positive satisfies
  const r = stopCtx.allow() satisfies StopEventResult
  void r
  // @ts-expect-error — return type does not satisfy foreign event-result (success/failure shape)
  const _drift = stopCtx.allow() satisfies WorktreeCreateResult
  void _drift

  // Cross-check sibling consumers compile
  void (subagentStopCtx.allow() satisfies SubagentStopResult)
  void (configChangeCtx.allow() satisfies ConfigChangeResult)
  void (preCompactCtx.allow() satisfies PreCompactResult)
}

// --- Allow<DebugMessage & Inject & SessionTitle, R> ---
// Representative: UserPromptSubmit.
{
  const _ok: Parameters<UserPromptSubmitContext['allow']>[0] = {
    debugMessage: 'd',
    injectContext: 'i',
    sessionTitle: 't',
  }
  void _ok
  // @ts-expect-error — bogus field rejected
  const _bad: Parameters<UserPromptSubmitContext['allow']>[0] = { bogus: true }
  void _bad

  void (userPromptCtx.allow() satisfies UserPromptSubmitResult)
  // @ts-expect-error — return type does not satisfy foreign event-result (success/failure shape)
  const _drift = userPromptCtx.allow() satisfies WorktreeCreateResult
  void _drift
}

// --- Allow<{updatedInput?: Patch<Input>} & UpdatedPermissions & DebugMessage, PermissionRequestResult> ---
// PermissionRequest-only — exercises the `updatedPermissions` opts field.
{
  const _ok: Parameters<PermissionRequestContext['allow']>[0] = {
    updatedPermissions: [],
    debugMessage: 'd',
  }
  void _ok
  // @ts-expect-error — bogus field rejected
  const _bad: Parameters<PermissionRequestContext['allow']>[0] = { bogus: true }
  void _bad

  void (permReqCtx.allow({ updatedPermissions: [] }) satisfies PermissionRequestResult)
  // @ts-expect-error — return type drifted (success/failure shape)
  const _drift = permReqCtx.allow({ updatedPermissions: [] }) satisfies WorktreeCreateResult
  void _drift
}

// --- Block<Reason, R> --- (also covers inline-spelled Stop/SubagentStop block)
// Representative: Stop, SubagentStop, ConfigChange, PreCompact.
{
  const _ok: Parameters<StopContext['block']>[0] = { reason: 'r', debugMessage: 'd' }
  void _ok
  // @ts-expect-error — reason required
  const _missingReason: Parameters<StopContext['block']>[0] = { debugMessage: 'd' }
  void _missingReason
  // @ts-expect-error — opts required (would silently pass if Block swapped to Skip)
  const _missingOpts = stopCtx.block()
  void _missingOpts

  void (stopCtx.block({ reason: 'r' }) satisfies StopEventResult)
  // @ts-expect-error — return type drifted (success/failure shape)
  const _drift = stopCtx.block({ reason: 'r' }) satisfies WorktreeCreateResult
  void _drift

  void (subagentStopCtx.block({ reason: 'r' }) satisfies SubagentStopResult)
  void (configChangeCtx.block({ reason: 'r' }) satisfies ConfigChangeResult)
  void (preCompactCtx.block({ reason: 'r' }) satisfies PreCompactResult)
}

// --- Block<Reason & Inject & SessionTitle, R> ---
// Representative: UserPromptSubmit.
{
  const _ok: Parameters<UserPromptSubmitContext['block']>[0] = {
    reason: 'r',
    injectContext: 'i',
    sessionTitle: 't',
  }
  void _ok
  // @ts-expect-error — reason required
  const _bad: Parameters<UserPromptSubmitContext['block']>[0] = { injectContext: 'i' }
  void _bad
  // @ts-expect-error — opts required
  const _missing = userPromptCtx.block()
  void _missing

  void (userPromptCtx.block({ reason: 'r' }) satisfies UserPromptSubmitResult)
}

// --- Block<Reason & Inject & UpdatedMcpToolOutput, R> ---
// Representative: PostToolUse.
{
  const _ok: Parameters<PostToolUseContext['block']>[0] = {
    reason: 'r',
    injectContext: 'i',
    updatedMCPToolOutput: { foo: 1 },
  }
  void _ok
  // @ts-expect-error — opts required
  const _missing = postToolUseCtx.block()
  void _missing

  void (postToolUseCtx.block({ reason: 'r' }) satisfies PostToolUseResult)
  // @ts-expect-error — return type drifted (success/failure shape)
  const _drift = postToolUseCtx.block({ reason: 'r' }) satisfies WorktreeCreateResult
  void _drift
}

// --- Block<Reason & Inject, PreToolUseResult> ---
// PreToolUse-only.
{
  const _ok: Parameters<PreToolUseContext['block']>[0] = { reason: 'r', injectContext: 'i' }
  void _ok
  // @ts-expect-error — bogus field rejected
  const _bad: Parameters<PreToolUseContext['block']>[0] = { bogus: true }
  void _bad
  // @ts-expect-error — opts required
  const _missing = preToolUseCtx.block()
  void _missing

  void (preToolUseCtx.block({ reason: 'r' }) satisfies PreToolUseResult)
  // @ts-expect-error — return type drifted (success/failure shape)
  const _drift = preToolUseCtx.block({ reason: 'r' }) satisfies WorktreeCreateResult
  void _drift
}

// --- Block<Reason & Interrupt, PermissionRequestResult> ---
// PermissionRequest-only.
{
  const _ok: Parameters<PermissionRequestContext['block']>[0] = { reason: 'r', interrupt: true }
  void _ok
  // @ts-expect-error — bogus field rejected
  const _bad: Parameters<PermissionRequestContext['block']>[0] = { bogus: true }
  void _bad
  // @ts-expect-error — opts required
  const _missing = permReqCtx.block()
  void _missing

  void (permReqCtx.block({ reason: 'r' }) satisfies PermissionRequestResult)
  // @ts-expect-error — return type drifted (success/failure shape)
  const _drift = permReqCtx.block({ reason: 'r' }) satisfies WorktreeCreateResult
  void _drift
}

// --- Skip<DebugMessage, R> ---
// Representative: SessionEnd, InstructionsLoaded, WorktreeRemove, PostCompact,
// StopFailure, TeammateIdle, TaskCreated, TaskCompleted, Stop, SubagentStop,
// ConfigChange, PreCompact, PermissionRequest.
{
  const _ok0: Parameters<SessionEndContext['skip']>[0] = undefined
  const _ok1: Parameters<SessionEndContext['skip']>[0] = { debugMessage: 'd' }
  // @ts-expect-error — bogus field rejected
  const _bad: Parameters<SessionEndContext['skip']>[0] = { injectContext: 'i' }
  void _ok0
  void _ok1
  void _bad

  void (sessionEndCtx.skip() satisfies SessionEndResult)
  void (instructionsLoadedCtx.skip() satisfies InstructionsLoadedResult)
  void (worktreeRemoveCtx.skip() satisfies WorktreeRemoveResult)
  void (postCompactCtx.skip() satisfies PostCompactResult)
  void (stopFailureCtx.skip() satisfies StopFailureResult)
  void (stopCtx.skip() satisfies StopEventResult)

  // @ts-expect-error — return type drifted (success/failure shape)
  const _drift = sessionEndCtx.skip() satisfies WorktreeCreateResult
  void _drift
}

// --- Skip<DebugMessage & Inject, R> ---
// Representative: SessionStart, PostToolUseFailure, Notification, SubagentStart, PreToolUse.
{
  const _ok: Parameters<SessionStartContext['skip']>[0] = { debugMessage: 'd', injectContext: 'i' }
  void _ok
  // @ts-expect-error — bogus field rejected
  const _bad: Parameters<SessionStartContext['skip']>[0] = { bogus: true }
  void _bad

  void (sessionStartCtx.skip() satisfies SessionStartResult)
  void (postToolUseFailureCtx.skip() satisfies PostToolUseFailureResult)
  void (notificationCtx.skip() satisfies NotificationResult)
  void (subagentStartCtx.skip() satisfies SubagentStartResult)
}

// --- Skip<DebugMessage & Inject & SessionTitle, R> ---
// Representative: UserPromptSubmit.
{
  const _ok: Parameters<UserPromptSubmitContext['skip']>[0] = {
    debugMessage: 'd',
    injectContext: 'i',
    sessionTitle: 't',
  }
  void _ok
  // @ts-expect-error — bogus field rejected
  const _bad: Parameters<UserPromptSubmitContext['skip']>[0] = { bogus: true }
  void _bad

  void (userPromptCtx.skip() satisfies UserPromptSubmitResult)
  // @ts-expect-error — return type drifted (success/failure shape)
  const _drift = userPromptCtx.skip() satisfies WorktreeCreateResult
  void _drift
}

// --- Skip<DebugMessage & Inject & UpdatedMcpToolOutput, R> ---
// Representative: PostToolUse.
{
  const _ok: Parameters<PostToolUseContext['skip']>[0] = {
    debugMessage: 'd',
    injectContext: 'i',
    updatedMCPToolOutput: 'opaque',
  }
  void _ok
  // @ts-expect-error — bogus field rejected
  const _bad: Parameters<PostToolUseContext['skip']>[0] = { bogus: true }
  void _bad

  void (postToolUseCtx.skip() satisfies PostToolUseResult)
  // @ts-expect-error — return type drifted (success/failure shape)
  const _drift = postToolUseCtx.skip() satisfies WorktreeCreateResult
  void _drift
}

// --- Continue<Feedback, R> ---
// Representative: TeammateIdle, TaskCreated, TaskCompleted.
{
  const _ok: Parameters<TeammateIdleContext['continue']>[0] = { feedback: 'keep going' }
  void _ok
  // @ts-expect-error — feedback required
  const _bad: Parameters<TeammateIdleContext['continue']>[0] = { debugMessage: 'd' }
  void _bad
  // @ts-expect-error — opts required
  const _missing = teammateIdleCtx.continue()
  void _missing

  void (teammateIdleCtx.continue({ feedback: 'f' }) satisfies TeammateIdleResult)
  void (taskCreatedCtx.continue({ feedback: 'f' }) satisfies TaskCreatedResult)
  void (taskCompletedCtx.continue({ feedback: 'f' }) satisfies TaskCompletedResult)

  // @ts-expect-error — return type drifted (success/failure shape)
  const _drift = teammateIdleCtx.continue({ feedback: 'f' }) satisfies WorktreeCreateResult
  void _drift
}

// --- Stop<Reason, R> ---
// Representative: TeammateIdle, TaskCreated, TaskCompleted.
{
  const _ok: Parameters<TeammateIdleContext['stop']>[0] = { reason: 'done' }
  void _ok
  // @ts-expect-error — feedback not on stop opts; reason required
  const _bad: Parameters<TeammateIdleContext['stop']>[0] = { feedback: 'x' }
  void _bad
  // @ts-expect-error — opts required
  const _missing = teammateIdleCtx.stop()
  void _missing

  void (teammateIdleCtx.stop({ reason: 'r' }) satisfies TeammateIdleResult)
  void (taskCreatedCtx.stop({ reason: 'r' }) satisfies TaskCreatedResult)
  void (taskCompletedCtx.stop({ reason: 'r' }) satisfies TaskCompletedResult)

  // @ts-expect-error — return type drifted (success/failure shape)
  const _drift = teammateIdleCtx.stop({ reason: 'r' }) satisfies WorktreeCreateResult
  void _drift
}

// --- Retry<DebugMessage, PermissionDeniedResult> ---
{
  const _ok0: Parameters<PermissionDeniedContext['retry']>[0] = undefined
  const _ok1: Parameters<PermissionDeniedContext['retry']>[0] = { debugMessage: 'd' }
  void _ok0
  void _ok1
  // @ts-expect-error — bogus field rejected (retry carries only debugMessage)
  const _bad: Parameters<PermissionDeniedContext['retry']>[0] = { reason: 'r' }
  void _bad

  void (permissionDeniedCtx.retry() satisfies PermissionDeniedResult)
  // @ts-expect-error — return type drifted (success/failure shape)
  const _drift = permissionDeniedCtx.retry() satisfies WorktreeCreateResult
  void _drift
}

// --- Success<Path, WorktreeCreateResult> ---
{
  const _ok: Parameters<WorktreeCreateContext['success']>[0] = { path: '/abs/path' }
  void _ok
  // @ts-expect-error — path required
  const _bad: Parameters<WorktreeCreateContext['success']>[0] = { debugMessage: 'd' }
  void _bad
  // @ts-expect-error — opts required
  const _missing = worktreeCreateCtx.success()
  void _missing

  void (worktreeCreateCtx.success({ path: '/p' }) satisfies WorktreeCreateResult)
}

// --- Failure<Reason, WorktreeCreateResult> ---
{
  const _ok: Parameters<WorktreeCreateContext['failure']>[0] = { reason: 'no disk' }
  void _ok
  // @ts-expect-error — reason required
  const _bad: Parameters<WorktreeCreateContext['failure']>[0] = { debugMessage: 'd' }
  void _bad
  // @ts-expect-error — opts required
  const _missing = worktreeCreateCtx.failure()
  void _missing

  void (worktreeCreateCtx.failure({ reason: 'r' }) satisfies WorktreeCreateResult)
}

// --- Defer<DebugMessage, PreToolUseResult> ---
// PreToolUse-only.
{
  const _ok0: Parameters<PreToolUseContext['defer']>[0] = undefined
  const _ok1: Parameters<PreToolUseContext['defer']>[0] = { debugMessage: 'd' }
  // @ts-expect-error — bogus field rejected (defer carries only debugMessage)
  const _bad: Parameters<PreToolUseContext['defer']>[0] = { reason: 'r' }
  void _ok0
  void _ok1
  void _bad

  void (preToolUseCtx.defer() satisfies PreToolUseResult)
  // @ts-expect-error — return type drifted (success/failure shape)
  const _drift = preToolUseCtx.defer() satisfies WorktreeCreateResult
  void _drift
}

// --- Ask<{reason; updatedInput?} & DebugMessage & Inject, PreToolUseResult> ---
// PreToolUse-only.
{
  // @ts-expect-error — opts required
  const _missing = preToolUseCtx.ask()
  void _missing

  if (preToolUseCtx.toolName === 'Bash') {
    void (preToolUseCtx.ask({ reason: 'why' }) satisfies PreToolUseResult)
    // @ts-expect-error — reason required on Ask
    const _bad = preToolUseCtx.ask({ debugMessage: 'd' })
    void _bad
    // @ts-expect-error — return type drifted (success/failure shape)
    const _drift = preToolUseCtx.ask({ reason: 'why' }) satisfies WorktreeCreateResult
    void _drift
  }
}

// --- Generic narrowing #1: PreToolUse — Patch<Input> still narrows post-composition ---
{
  if (preToolUseCtx.toolName === 'Bash') {
    // command is Bash's required key; positive assignment.
    preToolUseCtx.allow({ updatedInput: { command: 'echo x' } })
    // @ts-expect-error — filePath belongs to Edit/Write, not Bash
    preToolUseCtx.allow({ updatedInput: { filePath: '/tmp/x' } })
  }
  if (preToolUseCtx.toolName === 'Write') {
    preToolUseCtx.allow({ updatedInput: { filePath: '/p', content: 'c' } })
    // @ts-expect-error — command belongs to Bash, not Write
    preToolUseCtx.allow({ updatedInput: { command: 'x' } })
  }
}

// --- Generic narrowing #2: PermissionRequest — Patch<Input> still narrows post-composition ---
{
  if (permReqCtx.toolName === 'Bash') {
    permReqCtx.allow({ updatedInput: { command: 'x' } })
    // @ts-expect-error — filePath belongs to Edit/Write, not Bash
    permReqCtx.allow({ updatedInput: { filePath: '/p' } })
  }
  if (permReqCtx.toolName === 'Edit') {
    permReqCtx.allow({
      updatedInput: { filePath: '/p', oldString: 'a', newString: 'b' },
    })
    // @ts-expect-error — command belongs to Bash, not Edit
    permReqCtx.allow({ updatedInput: { command: 'x' } })
  }
}
