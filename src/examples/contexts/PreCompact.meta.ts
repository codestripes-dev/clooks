// Required-fields documentation for the PreCompact example payload.
// Grounded in src/types/contexts.ts (PreCompactContext) and
// docs/domain/raw-claude-ai/hook-docs/PreCompact.md.

import type { RequiredFieldDocFor } from '../index.js'

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "PreCompact".' },
    {
      name: 'trigger',
      type: 'string',
      description:
        'Whether compaction was triggered manually ("manual") or automatically ("auto").',
    },
    {
      name: 'customInstructions',
      type: 'string',
      description:
        'For "manual", the text the user passed to /compact. For "auto", an empty string.',
    },
  ],
} as const satisfies { readonly required: ReadonlyArray<RequiredFieldDocFor<'PreCompact'>> }
