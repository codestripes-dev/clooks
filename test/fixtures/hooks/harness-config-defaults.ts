// Fixture for `clooks test` harness — verifies `meta.config` defaults
// reach the handler's second argument. The handler returns a JSON object
// containing the config values it received so the harness test can assert
// on them.
//
// Production (engine) merges `meta.config` defaults with `clooks.yml`
// overrides in `src/loader.ts:144-146`. The harness has no `clooks.yml`,
// so the handler should receive the bare defaults.

type Config = { greeting: string; count: number }

export const hook = {
  meta: {
    name: 'harness-config-defaults',
    config: { greeting: 'hello-from-defaults', count: 7 } satisfies Config,
  },
  PreToolUse(_ctx: unknown, config: Config) {
    return {
      result: 'allow' as const,
      debugMessage: `${config.greeting}/${config.count}`,
    }
  },
}
