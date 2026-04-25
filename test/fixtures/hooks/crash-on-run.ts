// Fixture intentionally throws to exercise the engine's fail-closed path.
// No ctx.<verb>(...) call — the throw is the test signal.
export const hook = {
  meta: { name: 'crash-on-run' },
  PreToolUse() {
    throw new Error('intentional crash for testing')
  },
}
