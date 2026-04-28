// Required-fields documentation for the PreToolUse example payload.
// Grounded in src/types/contexts.ts (PreToolUseContext) and
// docs/domain/raw-claude-ai/hook-docs/PreToolUse.md.

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "PreToolUse".' },
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
      name: 'originalToolInput',
      type: 'object',
      description:
        'Read-only snapshot of toolInput as Claude Code originally sent it, before any hook patches. Mirror toolInput in test fixtures.',
    },
    {
      name: 'toolUseId',
      type: 'string',
      description: 'Identifier Claude Code assigns to this tool call (e.g. "tu_test_0001").',
    },
  ],
} as const
