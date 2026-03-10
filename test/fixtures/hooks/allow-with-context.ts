export const hook = {
  meta: { name: "allow-with-context" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "context from allow-with-context" }
  },
}
