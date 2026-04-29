# Hook Config Overrides — Worked Example

Worked example for `clooks test`'s `--config` and `--config-json` flags. For the full contract — flag mutex, entry-resolution rule, `--hook-name` escape hatch, `enabled: false` behavior, merge shape — see [hook-author-testing.md](hook-author-testing.md#hookconfig--overriding-via---config----config-json).

## Both flags produce the same merged shape

Given a hook with non-trivial `meta.config` defaults at `./.clooks/hooks/my-hook.ts`:

```ts
import type { ClooksHook } from './types'

export const hook: ClooksHook<{ logDir: string; threshold: number }> = {
  meta: {
    name: 'my-hook',
    events: ['PreToolUse'],
    config: { logDir: '.clooks', threshold: 3 },
  },
  PreToolUse(ctx, config) {
    if (config.threshold >= 7) {
      return ctx.allow({ injectContext: JSON.stringify(config) })
    }
    return ctx.allow({ injectContext: `logging to ${config.logDir}` })
  },
}
```

A fixture YAML at `fixtures/threshold-7.yml` overrides only `threshold`:

```yaml
version: "1"
my-hook:
  uses: ../.clooks/hooks/my-hook.ts
  config:
    threshold: 7
```

A fixture event at `fixture.json`:

```json
{
  "event": "PreToolUse",
  "toolName": "Bash",
  "toolInput": { "command": "echo hi" },
  "originalToolInput": { "command": "echo hi" },
  "toolUseId": "tu_test_0001"
}
```

The two invocations below produce **identical stdout** — the YAML entry's `config` and the JSON literal arrive at the same merged shape `{ logDir: '.clooks', threshold: 7 }`:

```bash
clooks test ./.clooks/hooks/my-hook.ts --config fixtures/threshold-7.yml --input fixture.json
# {"result":"allow","injectContext":"{\"logDir\":\".clooks\",\"threshold\":7}"}
# exit 0

clooks test ./.clooks/hooks/my-hook.ts --config-json '{"threshold":7}' --input fixture.json
# {"result":"allow","injectContext":"{\"logDir\":\".clooks\",\"threshold\":7}"}
# exit 0
```

`logDir` flows through from `meta.config` defaults; only `threshold` is overridden. Without either flag, the handler would see `{ logDir: '.clooks', threshold: 3 }` and return `injectContext: 'logging to .clooks'` instead.

## Related

- [hook-author-testing.md](hook-author-testing.md) — full `clooks test` harness contract.
- [cli-architecture.md](../cli-architecture.md) — Command Reference for `clooks test`.
