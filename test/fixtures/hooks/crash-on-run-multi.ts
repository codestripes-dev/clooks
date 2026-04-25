// Fixture intentionally throws to exercise the engine's fail-closed path.
// No ctx.<verb>(...) call — the throw is the test signal.
export const hook = {
  meta: { name: 'crash-on-run-multi' },
  PreToolUse() {
    throw new Error('intentional crash')
  },
  UserPromptSubmit() {
    throw new Error('intentional crash')
  },
}
