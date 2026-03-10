export const hook = {
  meta: { name: "hang-forever" },
  PreToolUse() {
    return new Promise(() => {})  // never resolves
  },
}
