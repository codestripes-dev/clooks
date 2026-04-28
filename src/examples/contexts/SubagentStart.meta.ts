// Required-fields documentation for the SubagentStart example payload.
// Grounded in src/types/contexts.ts (SubagentStartContext) and
// docs/domain/raw-claude-ai/hook-docs/SubagentStart.md.

import type { RequiredFieldDocFor } from '../index.js'

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "SubagentStart".' },
    {
      name: 'agentId',
      type: 'string',
      description: 'Unique identifier for the subagent invocation.',
    },
    {
      name: 'agentType',
      type: 'string',
      description: 'Subagent type (e.g. "Bash", "Explore", "Plan", or a custom agent name).',
    },
  ],
} as const satisfies { readonly required: ReadonlyArray<RequiredFieldDocFor<'SubagentStart'>> }
