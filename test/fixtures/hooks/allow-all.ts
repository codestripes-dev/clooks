export const hook = {
  meta: { name: "allow-all" },
  PreToolUse() { return { result: "allow" as const } },
  PostToolUse() { return { result: "skip" as const } },
  UserPromptSubmit() { return { result: "allow" as const } },
}
