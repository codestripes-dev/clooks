// Required-fields documentation for the Notification example payload.
// Grounded in src/types/contexts.ts (NotificationContext) and
// docs/domain/raw-claude-ai/hook-docs/Notification.md.

export default {
  required: [
    { name: 'event', type: 'string', description: 'Must be "Notification".' },
    {
      name: 'message',
      type: 'string',
      description: 'The notification text Claude Code is about to display.',
    },
  ],
} as const
