// Fixture for `clooks test` harness M4 — handler returns a non-object value.
// Exercises `JSON.stringify`-of-a-number on the harness's happy-path branch
// in src/commands/test.ts (the renderer does not special-case primitives).

export const hook = {
  meta: { name: 'harness-return-number' },
  PreToolUse() {
    return 42
  },
}
