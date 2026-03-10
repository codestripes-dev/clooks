export const hook = {
  meta: { name: "read-command" },
  PreToolUse(ctx: Record<string, unknown>) {
    const toolInput = ctx.toolInput as Record<string, unknown>
    const command = typeof toolInput.command === "string" ? toolInput.command : "unknown"
    return {
      result: "allow" as const,
      injectContext: `read-command saw: ${command}`,
    }
  },
}
