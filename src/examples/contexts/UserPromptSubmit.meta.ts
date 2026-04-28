// Required-fields documentation for the UserPromptSubmit example payload.
// Grounded in src/types/contexts.ts (UserPromptSubmitContext) and
// docs/domain/raw-claude-ai/hook-docs/UserPromptSubmit.md.

import type { RequiredFieldDocFor } from '../index.js'

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "UserPromptSubmit".' },
    {
      name: 'prompt',
      type: 'string',
      description: 'The text the user submitted.',
    },
  ],
} as const satisfies { readonly required: ReadonlyArray<RequiredFieldDocFor<'UserPromptSubmit'>> }
