type BlockCtx = { block: (opts: { reason: string }) => { result: 'block'; reason: string } }

export const hook = {
  meta: { name: 'block-always' },
  PreToolUse(ctx: BlockCtx) {
    return ctx.block({ reason: 'test block' })
  },
  UserPromptSubmit(ctx: BlockCtx) {
    return ctx.block({ reason: 'test block' })
  },
}
