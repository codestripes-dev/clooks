// Smoke fixture exercising the M1 decision-method runtime on PreToolUse.
// Handler returns `ctx.skip()` — the method is attached by `attachDecisionMethods`
// inside `runHookLifecycle` before the handler runs.
export const hook = {
  meta: { name: 'method-smoke' },
  PreToolUse(ctx: { skip: () => { result: 'skip' } }) {
    return ctx.skip()
  },
}
