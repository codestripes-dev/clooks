/**
 * The full-shape `{ ...ctx.toolInput, command: "..." }` idiom kept as a
 * regression guard alongside the patch-style `rewrite-command.ts`. Both
 * produce byte-identical wire output — don't delete this one.
 *
 * Migrated to ctx.<verb>(...) form per FEAT-0063 M4. The full-shape spread
 * is preserved inside the opts bag — the test signal is that the engine's
 * patch-merge layer accepts a fully-spread updatedInput identically to a
 * partial patch.
 */
type AllowCtx = {
  toolInput: Record<string, unknown>
  allow: (opts: { updatedInput: Record<string, unknown> }) => {
    result: 'allow'
    updatedInput: Record<string, unknown>
  }
}

export const hook = {
  meta: { name: 'rewrite-command-full-shape' },
  PreToolUse(ctx: AllowCtx) {
    return ctx.allow({ updatedInput: { ...ctx.toolInput, command: 'echo rewritten' } })
  },
}
