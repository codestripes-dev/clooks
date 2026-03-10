export const hook = {
  meta: { name: "before-block" },
  beforeHook(event: any) {
    event.respond({ result: "block", reason: "before blocked" })
  },
  PreToolUse() { return { result: "allow" } },
}
