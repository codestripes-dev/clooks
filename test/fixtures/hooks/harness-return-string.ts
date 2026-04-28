// Fixture for `clooks test` harness M4 — handler returns a string.
// Exercises `JSON.stringify`-of-a-string on the harness's happy-path branch
// in src/commands/test.ts.

export const hook = {
  meta: { name: 'harness-return-string' },
  PreToolUse() {
    return 'oops'
  },
}
