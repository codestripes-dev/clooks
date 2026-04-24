/**
 * The full-shape `{ ...ctx.toolInput, command: "..." }` idiom kept as a
 * regression guard alongside the patch-style `rewrite-command.ts`. Both
 * produce byte-identical wire output — don't delete this one.
 */
export const hook = {
  meta: { name: 'rewrite-command-full-shape' },
  PreToolUse(ctx: Record<string, unknown>) {
    const toolInput = ctx.toolInput as Record<string, unknown>
    return {
      result: 'allow' as const,
      updatedInput: { ...toolInput, command: 'echo rewritten' },
    }
  },
}
