// Fixture migrated to ctx.<verb>(...) form per FEAT-0063 M4. The
// beforeHook still uses the upstream LifecycleEvent.respond() shape — that's
// pre-handler engine plumbing, not a Clooks decision-method site.
type AllowCtx = { allow: () => { result: 'allow' } }

export const hook = {
  meta: { name: 'before-block' },
  beforeHook(event: any) {
    event.respond({ result: 'block', reason: 'before blocked' })
  },
  PreToolUse(ctx: AllowCtx) {
    return ctx.allow()
  },
}
