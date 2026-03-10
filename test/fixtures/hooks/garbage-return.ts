export const hook = {
  meta: { name: "garbage-return" },
  PreToolUse() {
    return { result: "banana" }
  },
}
