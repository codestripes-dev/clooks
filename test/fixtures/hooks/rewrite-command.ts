export const hook = {
  meta: { name: 'rewrite-command' },
  PreToolUse() {
    return {
      result: 'allow' as const,
      updatedInput: { command: 'echo rewritten' },
    }
  },
}
