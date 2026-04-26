type AllowCtx = { allow: () => { result: 'allow' } }

export const hook = {
  meta: { name: 'before-block' },
  beforeHook(event: any) {
    return event.block({ reason: 'before blocked' })
  },
  PreToolUse(ctx: AllowCtx) {
    return ctx.allow()
  },
}
