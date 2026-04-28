// Fixture for `clooks test` harness — beforeHook short-circuits with skip.
// Same shape as harness-lifecycle-block but exercising the skip branch.

type BeforeEvent = { skip: () => { result: 'skip' } }
type AllowCtx = { allow: () => { result: 'allow' } }

export const hook = {
  meta: { name: 'harness-lifecycle-skip' },
  beforeHook(event: BeforeEvent) {
    process.stderr.write('lifecycle:before;')
    return event.skip()
  },
  PreToolUse(ctx: AllowCtx) {
    process.stderr.write('lifecycle:handler-RAN;')
    return ctx.allow()
  },
  afterHook() {
    process.stderr.write('lifecycle:after-RAN;')
  },
}
