// Fixture migrated to ctx.<verb>(...) form per FEAT-0063 M4.
type AllowCtx = {
  allow: (opts: { injectContext: string }) => { result: 'allow'; injectContext: string }
}

export const hook = {
  meta: { name: 'allow-with-context' },
  PreToolUse(ctx: AllowCtx) {
    return ctx.allow({ injectContext: 'context from allow-with-context' })
  },
}
