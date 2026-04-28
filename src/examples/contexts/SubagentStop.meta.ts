// Required-fields documentation for the SubagentStop example payload.
// Grounded in src/types/contexts.ts (SubagentStopContext) and
// docs/domain/raw-claude-ai/hook-docs/SubagentStop.md.

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "SubagentStop".' },
    {
      name: 'stopHookActive',
      type: 'boolean',
      description: 'True when Claude Code is already continuing as a result of a stop hook.',
    },
    {
      name: 'agentId',
      type: 'string',
      description: 'Unique identifier for the subagent.',
    },
    {
      name: 'agentType',
      type: 'string',
      description: 'Subagent type (e.g. "Bash", "Explore", "Plan", or a custom agent name).',
    },
    {
      name: 'agentTranscriptPath',
      type: 'string',
      description: "Absolute path to the subagent's own transcript file.",
    },
    {
      name: 'lastAssistantMessage',
      type: 'string',
      description: "The text content of the subagent's final response.",
    },
  ],
} as const
