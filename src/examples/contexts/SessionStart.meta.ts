// Required-fields documentation for the SessionStart example payload.
// Grounded in src/types/contexts.ts (SessionStartContext) and
// docs/domain/raw-claude-ai/hook-docs/SessionStart.md.

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "SessionStart".' },
    {
      name: 'source',
      type: 'string',
      description:
        'How the session started. One of "startup", "resume", "clear", "compact" (or a future string).',
    },
  ],
} as const
