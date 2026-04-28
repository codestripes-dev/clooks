// Required-fields documentation for the TaskCompleted example payload.
// Grounded in src/types/contexts.ts (TaskCompletedContext) and
// docs/domain/raw-claude-ai/hook-docs/TaskCompleted.md.

import type { RequiredFieldDocFor } from '../index.js'

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "TaskCompleted".' },
    {
      name: 'taskId',
      type: 'string',
      description: 'Identifier of the task being marked complete.',
    },
    {
      name: 'taskSubject',
      type: 'string',
      description: 'Title of the task.',
    },
  ],
} as const satisfies { readonly required: ReadonlyArray<RequiredFieldDocFor<'TaskCompleted'>> }
