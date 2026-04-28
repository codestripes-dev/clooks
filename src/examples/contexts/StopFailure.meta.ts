// Required-fields documentation for the StopFailure example payload.
// Grounded in src/types/contexts.ts (StopFailureContext) and
// docs/domain/raw-claude-ai/hook-docs/StopFailure.md.

import type { RequiredFieldDocFor } from '../index.js'

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "StopFailure".' },
    {
      name: 'error',
      type: 'string',
      description:
        'Error category. One of "rate_limit", "authentication_failed", "billing_error", "invalid_request", "server_error", "max_output_tokens", or "unknown". Branch alerting on this.',
    },
  ],
} as const satisfies { readonly required: ReadonlyArray<RequiredFieldDocFor<'StopFailure'>> }
