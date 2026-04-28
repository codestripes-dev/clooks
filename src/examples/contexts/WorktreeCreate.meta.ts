// Required-fields documentation for the WorktreeCreate example payload.
// Grounded in src/types/contexts.ts (WorktreeCreateContext) and
// docs/domain/raw-claude-ai/hook-docs/WorktreeCreate.md.

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "WorktreeCreate".' },
    {
      name: 'name',
      type: 'string',
      description:
        'Slug identifier for the new worktree, either user-specified or auto-generated (e.g. "bold-oak-a3f2").',
    },
  ],
} as const
