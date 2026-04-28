// Required-fields documentation for the SessionEnd example payload.
// Grounded in src/types/contexts.ts (SessionEndContext) and
// docs/domain/raw-claude-ai/hook-docs/SessionEnd.md.

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "SessionEnd".' },
    {
      name: 'reason',
      type: 'string',
      description:
        'Why the session ended. One of "clear", "resume", "logout", "prompt_input_exit", "bypass_permissions_disabled", "other" (or a future string).',
    },
  ],
} as const
