// Required-fields documentation for the ConfigChange example payload.
// Grounded in src/types/contexts.ts (ConfigChangeContext) and
// docs/domain/raw-claude-ai/hook-docs/ConfigChange.md.

import type { RequiredFieldDocFor } from '../index.js'

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "ConfigChange".' },
    {
      name: 'source',
      type: 'string',
      description:
        'Which settings file changed. One of "user_settings", "project_settings", "local_settings", "policy_settings", "skills" (or a future string). "policy_settings" changes cannot be blocked.',
    },
  ],
} as const satisfies { readonly required: ReadonlyArray<RequiredFieldDocFor<'ConfigChange'>> }
