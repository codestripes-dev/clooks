export const hook = {
  meta: { name: "crash-on-run-multi" },
  PreToolUse() { throw new Error("intentional crash") },
  UserPromptSubmit() { throw new Error("intentional crash") },
}
