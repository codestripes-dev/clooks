// Required-fields documentation for the TaskCreated example payload.
// Grounded in src/types/contexts.ts (TaskCreatedContext) and
// docs/domain/raw-claude-ai/hook-docs/TaskCreated.md.

import type { RequiredFieldDocFor } from '../index.js'

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "TaskCreated".' },
    {
      name: 'taskId',
      type: 'string',
      description: 'Identifier of the task being created.',
    },
    {
      name: 'taskSubject',
      type: 'string',
      description: 'Title of the task.',
    },
  ],
} as const satisfies { readonly required: ReadonlyArray<RequiredFieldDocFor<'TaskCreated'>> }
