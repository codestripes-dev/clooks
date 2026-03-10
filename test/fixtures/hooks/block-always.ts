export const hook = {
  meta: { name: "block-always" },
  PreToolUse() { return { result: "block" as const, reason: "test block" } },
  UserPromptSubmit() { return { result: "block" as const, reason: "test block" } },
}
