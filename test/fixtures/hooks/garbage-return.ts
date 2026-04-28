// Fixture intentionally returns invalid (non-result-tag) shape to exercise
// the engine's result-validation path. The plain-object return is the test
// signal — it MUST NOT migrate to ctx.<verb>(...) form, because no method
// produces a `{ result: "banana" }` shape.
export const hook = {
  meta: { name: 'garbage-return' },
  PreToolUse() {
    return { result: 'banana' }
  },
}
