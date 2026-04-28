// Fixture for `clooks test` harness M4 — wrong-named export.
// Exercises `validateHookExport` rejecting a module that does not export the
// expected `hook` named binding (see src/loader.ts).

export const notHook = {}
