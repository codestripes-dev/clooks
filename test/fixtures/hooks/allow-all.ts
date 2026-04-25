// Fixture migrated to ctx.<verb>(...) form per FEAT-0063 M4. Inline structural
// types match the runtime methods attached by `attachDecisionMethods`.
type AllowCtx = { allow: () => { result: 'allow' } }
type SkipCtx = { skip: () => { result: 'skip' } }

export const hook = {
  meta: { name: 'allow-all' },
  PreToolUse(ctx: AllowCtx) {
    return ctx.allow()
  },
  PostToolUse(ctx: SkipCtx) {
    return ctx.skip()
  },
  UserPromptSubmit(ctx: AllowCtx) {
    return ctx.allow()
  },
}
