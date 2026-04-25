// Fixture migrated to ctx.<verb>(...) form per FEAT-0063 M4.
type AllowCtx = {
  allow: (opts: { updatedInput: { command: string } }) => {
    result: 'allow'
    updatedInput: { command: string }
  }
}

export const hook = {
  meta: { name: 'rewrite-command' },
  PreToolUse(ctx: AllowCtx) {
    return ctx.allow({ updatedInput: { command: 'echo rewritten' } })
  },
}
