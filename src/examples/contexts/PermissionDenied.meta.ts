// Required-fields documentation for the PermissionDenied example payload.
// Grounded in src/types/contexts.ts (PermissionDeniedContext) and
// docs/domain/raw-claude-ai/hook-docs/PermissionDenied.md.

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "PermissionDenied".' },
    {
      name: 'toolName',
      type: 'string',
      description: 'The tool\'s name (any string — e.g. "Bash", "Edit", or an MCP tool).',
    },
    {
      name: 'toolInput',
      type: 'object',
      description: 'Tool input as Claude Code received it. Keys are camelCase.',
    },
    {
      name: 'toolUseId',
      type: 'string',
      description: 'Identifier of the originating tool call.',
    },
    {
      name: 'denialReason',
      type: 'string',
      description: "The classifier's explanation for why the tool call was denied.",
    },
  ],
} as const
