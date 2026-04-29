// Fixture for `clooks test` harness — captures `event.meta.configPath` from
// the lifecycle wrapper and emits it via stderr so the harness test can
// assert on the resolved path. Used by the `runHarness — config flags` suite
// to verify that:
//   - `--config <yaml>`     sets configPath to the resolved YAML absolute path
//   - `--config-json '...'` leaves configPath at the deterministic /tmp stub
//
// Emits the configPath verbatim to stderr (prefixed `configPath=` and
// suffixed `;`) so the test can extract it from the captured stderr chunks
// without relying on module-level state (which would leak across imports).

type AllowCtx = { allow: () => { result: 'allow' } }
type BeforeEvent = {
  meta: { configPath: string }
  passthrough: () => { result: 'passthrough' }
}

export const hook = {
  meta: { name: 'harness-config-path-capture' },
  beforeHook(event: BeforeEvent) {
    process.stderr.write(`configPath=${event.meta.configPath};`)
    return event.passthrough()
  },
  PreToolUse(ctx: AllowCtx) {
    return ctx.allow()
  },
}
