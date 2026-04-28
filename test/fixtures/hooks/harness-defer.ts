// Fixture for `clooks test` harness — PreToolUse handler returning ctx.defer().
// Exercises the exit-0 mapping for `defer`. See PLAN-FEAT-0067 Decision Log.

type DeferCtx = { defer: () => { result: 'defer' } }

export const hook = {
  meta: { name: 'harness-defer' },
  PreToolUse(ctx: DeferCtx) {
    return ctx.defer()
  },
}
