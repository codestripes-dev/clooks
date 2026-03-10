export const hook = {
  meta: {
    name: "config-echo",
    config: { greeting: "default-hello" },
  },
  PreToolUse(_ctx: Record<string, unknown>, config: Record<string, unknown>) {
    return {
      result: "allow" as const,
      injectContext: `config-echo received: ${JSON.stringify(config)}`,
    }
  },
}
