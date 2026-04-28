// Fixture for `clooks test` harness M4 — handler returns null.
// Exercises `JSON.stringify(null)` on the harness's happy-path branch in
// src/commands/test.ts. Distinct from the `undefined`/void branch which is
// short-circuited to print `{}\n`.

export const hook = {
  meta: { name: 'harness-return-null' },
  PreToolUse() {
    return null
  },
}
