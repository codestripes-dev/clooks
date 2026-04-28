// Required-fields documentation for the InstructionsLoaded example payload.
// Grounded in src/types/contexts.ts (InstructionsLoadedContext) and
// docs/domain/raw-claude-ai/hook-docs/InstructionsLoaded.md.

import type { RequiredFieldDocFor } from '../index.js'

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "InstructionsLoaded".' },
    {
      name: 'filePath',
      type: 'string',
      description: 'Absolute path to the instruction file that was loaded.',
    },
    {
      name: 'memoryType',
      type: 'string',
      description:
        'Scope of the file. One of "User" (global), "Project" (repo), "Local" (repo), "Managed" (MDM).',
    },
    {
      name: 'loadReason',
      type: 'string',
      description:
        'Why the file was loaded. One of "session_start", "nested_traversal", "path_glob_match", "include" (or a future string such as "compact").',
    },
  ],
} as const satisfies { readonly required: ReadonlyArray<RequiredFieldDocFor<'InstructionsLoaded'>> }
