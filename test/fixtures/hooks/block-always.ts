// Fixture migrated to ctx.<verb>(...) form per FEAT-0063 M4.
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
