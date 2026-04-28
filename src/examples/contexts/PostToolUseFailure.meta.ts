// Required-fields documentation for the PostToolUseFailure example payload.
// Grounded in src/types/contexts.ts (PostToolUseFailureContext) and
// docs/domain/raw-claude-ai/hook-docs/PostToolUseFailure.md.

import type { RequiredFieldDocFor } from '../index.js'

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "PostToolUseFailure".' },
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
      name: 'error',
      type: 'string',
      description: 'String describing what went wrong.',
    },
  ],
} as const satisfies { readonly required: ReadonlyArray<RequiredFieldDocFor<'PostToolUseFailure'>> }
