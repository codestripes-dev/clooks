// Fixture for `clooks test` harness — handler returns void/undefined.
// Exercises the harness's "treat undefined as skip-equivalent and print {}"
// branch in src/commands/test.ts. Notification is a notify-only event whose
// handler legitimately returns void.

export const hook = {
  meta: { name: 'harness-void' },
  Notification() {
    // Intentional: no return value.
  },
}
