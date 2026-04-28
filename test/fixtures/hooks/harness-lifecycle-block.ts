// Fixture for `clooks test` harness — beforeHook short-circuits with block.
// Asserts that when beforeHook returns `event.block({...})`, the per-event
// handler is NOT called and the block result is what the harness emits.

type BeforeEvent = {
  block: (opts: { reason: string }) => { result: 'block'; reason: string }
}
type AllowCtx = { allow: () => { result: 'allow' } }

export const hook = {
  meta: { name: 'harness-lifecycle-block' },
  beforeHook(event: BeforeEvent) {
    process.stderr.write('lifecycle:before;')
    return event.block({ reason: 'before-blocked' })
  },
  PreToolUse(ctx: AllowCtx) {
    // Should never run — beforeHook short-circuited.
    process.stderr.write('lifecycle:handler-RAN;')
    return ctx.allow()
  },
  afterHook() {
    // Should never run — handler was skipped.
    process.stderr.write('lifecycle:after-RAN;')
  },
}
