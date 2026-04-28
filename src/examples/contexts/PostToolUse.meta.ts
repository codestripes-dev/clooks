// Required-fields documentation for the PostToolUse example payload.
// Grounded in src/types/contexts.ts (PostToolUseContext) and
// docs/domain/raw-claude-ai/hook-docs/PostToolUse.md.

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "PostToolUse".' },
    {
      name: 'toolName',
      type: 'string',
      description:
        'The tool\'s name. See "Tool inputs" below for the 10 built-in tools\' toolInput shapes; any other string is accepted (ExitPlanMode, mcp__*).',
    },
    {
      name: 'toolInput',
      type: 'object',
      description: 'Shape depends on toolName. See "Tool inputs" below.',
    },
    {
      name: 'toolUseId',
      type: 'string',
      description: 'Identifier of the originating tool call.',
    },
    {
      name: 'toolResponse',
      type: 'unknown',
      description: 'The result the tool returned. Schema depends on the tool.',
    },
  ],
} as const
