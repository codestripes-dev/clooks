type AllowCtx = {
  toolInput: Record<string, unknown>
  allow: (opts: { injectContext: string }) => { result: 'allow'; injectContext: string }
}

export const hook = {
  meta: { name: 'read-command' },
  PreToolUse(ctx: AllowCtx) {
    const command = typeof ctx.toolInput.command === 'string' ? ctx.toolInput.command : 'unknown'
    return ctx.allow({ injectContext: `read-command saw: ${command}` })
  },
}
