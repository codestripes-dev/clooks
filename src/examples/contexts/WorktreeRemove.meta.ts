// Required-fields documentation for the WorktreeRemove example payload.
// Grounded in src/types/contexts.ts (WorktreeRemoveContext) and
// docs/domain/raw-claude-ai/hook-docs/WorktreeRemove.md.

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "WorktreeRemove".' },
    {
      name: 'worktreePath',
      type: 'string',
      description: 'Absolute path to the worktree being removed.',
    },
  ],
} as const
