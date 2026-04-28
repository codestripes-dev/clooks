// Required-fields documentation for the Stop example payload.
// Grounded in src/types/contexts.ts (StopContext) and
// docs/domain/raw-claude-ai/hook-docs/Stop.md.

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "Stop".' },
    {
      name: 'stopHookActive',
      type: 'boolean',
      description: 'True when Claude Code is already continuing as a result of a stop hook.',
    },
    {
      name: 'lastAssistantMessage',
      type: 'string',
      description: "The text content of Claude's final response.",
    },
  ],
} as const
