// Fixture for `clooks test` harness — beforeHook/afterHook throw paths.
// Reads the throw target from `process.env.LIFECYCLE_THROW` at invocation
// time (not import time) so the same module can serve both branches across
// tests despite Bun's module cache.

type AllowCtx = { allow: () => { result: 'allow' } }

export const hook = {
  meta: { name: 'harness-lifecycle-throws' },
  beforeHook() {
    if (process.env.LIFECYCLE_THROW === 'before') throw new Error('boom-before')
    return { result: 'passthrough' as const }
  },
  PreToolUse(ctx: AllowCtx) {
    return ctx.allow()
  },
  afterHook() {
    if (process.env.LIFECYCLE_THROW === 'after') throw new Error('boom-after')
  },
}
