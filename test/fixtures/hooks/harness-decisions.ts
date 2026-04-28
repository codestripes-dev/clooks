// Fixture for `clooks test` harness M4 unit tests. Each handler returns the
// decision-result tag native to its event, exercising the harness's
// exit-code mapping table from PLAN-FEAT-0067 Decision Log.
//
// Mapping recap:
//   allow / skip / success / continue / retry / ask / defer  → exit 0
//   block / failure / stop                                   → exit 1
//
// Inline structural types match the runtime methods attached by
// `attachDecisionMethods` — same shape as test/fixtures/hooks/allow-all.ts.

type AllowCtx = { allow: () => { result: 'allow' } }
type AskCtx = { ask: (opts: { reason: string }) => { result: 'ask'; reason: string } }
type BlockCtx = { block: (opts: { reason: string }) => { result: 'block'; reason: string } }
type DeferCtx = { defer: () => { result: 'defer' } }
type SkipCtx = { skip: () => { result: 'skip' } }
type SuccessCtx = { success: (opts: { path: string }) => { result: 'success'; path: string } }
type FailureCtx = { failure: (opts: { reason: string }) => { result: 'failure'; reason: string } }
type ContinueCtx = {
  continue: (opts: { feedback: string }) => { result: 'continue'; feedback: string }
}
type StopCtx = { stop: (opts: { reason: string }) => { result: 'stop'; reason: string } }
type RetryCtx = { retry: () => { result: 'retry' } }

export const hook = {
  meta: { name: 'harness-decisions' },
  // PreToolUse exposes allow/ask/block/defer/skip; pick allow for the
  // canonical 0-exit case.
  PreToolUse(ctx: AllowCtx) {
    return ctx.allow()
  },
  // UserPromptSubmit exposes allow/block/skip — used here for block (exit 1).
  UserPromptSubmit(ctx: BlockCtx) {
    return ctx.block({ reason: 'no' })
  },
  // PostToolUse exposes block/skip — used for skip (exit 0).
  PostToolUse(ctx: SkipCtx) {
    return ctx.skip()
  },
  // WorktreeCreate exposes success/failure.
  WorktreeCreate(ctx: SuccessCtx | FailureCtx) {
    return (ctx as SuccessCtx).success({ path: '/tmp/worktree' })
  },
  // PermissionDenied exposes retry/skip — used for retry (exit 0).
  PermissionDenied(ctx: RetryCtx) {
    return ctx.retry()
  },
  // TeammateIdle exposes continue/stop/skip — used for continue (exit 0).
  TeammateIdle(ctx: ContinueCtx) {
    return ctx.continue({ feedback: 'keep going' })
  },
  // TaskCreated exposes continue/stop/skip — used for stop (exit 1).
  TaskCreated(ctx: StopCtx) {
    return ctx.stop({ reason: 'halt' })
  },
}
