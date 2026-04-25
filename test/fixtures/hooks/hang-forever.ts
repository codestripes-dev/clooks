// Fixture intentionally never resolves to exercise the engine's hook timeout.
// No ctx.<verb>(...) call — the hang is the test signal.
export const hook = {
  meta: { name: 'hang-forever' },
  PreToolUse() {
    return new Promise(() => {}) // never resolves
  },
}
