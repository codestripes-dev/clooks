// Fixture for `clooks test` harness — beforeHook passes through, handler
// runs, afterHook observes the handlerResult. Each phase writes a marker to
// stderr so a single test can assert the call order via the captured stderr.

type BeforeEvent = { passthrough: () => { result: 'passthrough' } }
type AfterEvent = {
  handlerResult: unknown
  passthrough: () => { result: 'passthrough' }
}
type AllowCtx = { allow: () => { result: 'allow' } }

export const hook = {
  meta: { name: 'harness-lifecycle-full' },
  beforeHook(event: BeforeEvent) {
    process.stderr.write('lifecycle:before;')
    return event.passthrough()
  },
  PreToolUse(ctx: AllowCtx) {
    process.stderr.write('lifecycle:handler;')
    return ctx.allow()
  },
  afterHook(event: AfterEvent) {
    const handlerTag = (event.handlerResult as { result: string }).result
    process.stderr.write(`lifecycle:after(${handlerTag});`)
    return event.passthrough()
  },
}
