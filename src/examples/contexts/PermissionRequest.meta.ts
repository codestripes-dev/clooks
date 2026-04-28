// Required-fields documentation for the PermissionRequest example payload.
// Grounded in src/types/contexts.ts (PermissionRequestContext) and
// docs/domain/raw-claude-ai/hook-docs/PermissionRequest.md.

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "PermissionRequest".' },
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
  ],
} as const
