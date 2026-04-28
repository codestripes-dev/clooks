// Required-fields documentation for the TeammateIdle example payload.
// Grounded in src/types/contexts.ts (TeammateIdleContext) and
// docs/domain/raw-claude-ai/hook-docs/TeammateIdle.md.

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "TeammateIdle".' },
    {
      name: 'teammateName',
      type: 'string',
      description: 'Name of the teammate that is about to go idle.',
    },
    {
      name: 'teamName',
      type: 'string',
      description: 'Name of the team.',
    },
  ],
} as const
