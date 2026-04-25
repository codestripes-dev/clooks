// Fixture migrated to ctx.<verb>(...) form per FEAT-0063 M4.
type AllowCtx = {
  allow: (opts: { injectContext: string }) => { result: 'allow'; injectContext: string }
}

export const hook = {
  meta: {
    name: 'config-echo',
    config: { greeting: 'default-hello' },
  },
  PreToolUse(ctx: AllowCtx, config: Record<string, unknown>) {
    return ctx.allow({ injectContext: `config-echo received: ${JSON.stringify(config)}` })
  },
}
