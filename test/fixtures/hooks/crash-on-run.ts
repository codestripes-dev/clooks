export const hook = {
  meta: { name: "crash-on-run" },
  PreToolUse() {
    throw new Error("intentional crash for testing")
  },
}
