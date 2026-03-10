export const hook = {
  meta: { name: "rewrite-command" },
  PreToolUse(ctx: Record<string, unknown>) {
    const toolInput = ctx.toolInput as Record<string, unknown>
    return {
      result: "allow" as const,
      updatedInput: { ...toolInput, command: "echo rewritten" },
    }
  },
}
