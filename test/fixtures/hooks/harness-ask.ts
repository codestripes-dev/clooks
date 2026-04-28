// Fixture for `clooks test` harness — PreToolUse handler returning ctx.ask(...).
// Exercises the exit-0 mapping for `ask` (an author-intended branch, not a
// failure). See PLAN-FEAT-0067 Decision Log.

type AskCtx = { ask: (opts: { reason: string }) => { result: 'ask'; reason: string } }

export const hook = {
  meta: { name: 'harness-ask' },
  PreToolUse(ctx: AskCtx) {
    return ctx.ask({ reason: 'confirm?' })
  },
}
