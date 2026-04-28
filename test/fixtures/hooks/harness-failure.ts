// Fixture for `clooks test` harness — WorktreeCreate handler returning
// ctx.failure(...). Exercises the exit-1 mapping for `failure`.

type FailureCtx = { failure: (opts: { reason: string }) => { result: 'failure'; reason: string } }

export const hook = {
  meta: { name: 'harness-failure' },
  WorktreeCreate(ctx: FailureCtx) {
    return ctx.failure({ reason: 'could not create' })
  },
}
