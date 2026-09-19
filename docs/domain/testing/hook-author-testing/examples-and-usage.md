# Hook Author Testing — Examples & Usage

Worked PreToolUse/UserPromptSubmit/AskUserQuestion examples, the CI loop pattern, known limitations, and the drift gate. Part of [Hook Author Testing](../hook-author-testing.md).

## Worked examples

### PreToolUse — Bash, end to end

A no-rm-rf-style hook that blocks any `rm -rf` and allows everything else. Hook file `./.clooks/hooks/no-rm-rf.ts`:

```ts
import type { ClooksHook } from './types'

export const hook: ClooksHook = {
  meta: { name: 'no-rm-rf', events: ['PreToolUse'] },
  PreToolUse(ctx) {
    const cmd = ctx.toolInput.command
    if (typeof cmd === 'string' && cmd.includes('rm -rf')) {
      return ctx.block({ reason: 'rm -rf is forbidden' })
    }
    return ctx.allow()
  },
}
```

Allow fixture `fixtures/allow-echo.json`:

```json
{
  "event": "PreToolUse",
  "toolName": "Bash",
  "toolInput": { "command": "echo hello" },
  "originalToolInput": { "command": "echo hello" },
  "toolUseId": "tu_test_0001"
}
```

```bash
clooks test ./.clooks/hooks/no-rm-rf.ts --input fixtures/allow-echo.json
# {"result":"allow"}
# exit 0
```

Block fixture `fixtures/block-rmrf.json`:

```json
{
  "event": "PreToolUse",
  "toolName": "Bash",
  "toolInput": { "command": "rm -rf /tmp/x" },
  "originalToolInput": { "command": "rm -rf /tmp/x" },
  "toolUseId": "tu_test_0002"
}
```

```bash
clooks test ./.clooks/hooks/no-rm-rf.ts --input fixtures/block-rmrf.json
# {"result":"block","reason":"rm -rf is forbidden"}
# exit 1
```

### UserPromptSubmit — allow

Fixture:

```json
{
  "event": "UserPromptSubmit",
  "prompt": "Write a function to calculate the factorial of a number"
}
```

A hook returning `ctx.allow()` produces:

```bash
clooks test ./.clooks/hooks/log-prompt.ts --input fixtures/prompt.json
# {"result":"allow"}
# exit 0
```

### AskUserQuestion shape

`AskUserQuestion` is a tool-keyed event variant. Its `toolInput` carries a `questions` array. A minimum-viable fixture for a `PreToolUse` hook gating `AskUserQuestion`:

```json
{
  "event": "PreToolUse",
  "toolName": "AskUserQuestion",
  "toolInput": {
    "questions": [
      { "question": "Proceed?", "header": "Confirm",
        "options": [{ "label": "yes" }, { "label": "no" }] }
    ]
  },
  "originalToolInput": {
    "questions": [
      { "question": "Proceed?", "header": "Confirm",
        "options": [{ "label": "yes" }, { "label": "no" }] }
    ]
  },
  "toolUseId": "tu_test_0003"
}
```

Run `clooks test example PreToolUse` to see the full inline documentation for `AskUserQuestion` and the other 9 built-in tools' `toolInput` shapes.

## CI loop pattern

The simplest CI integration is a bash loop over author-owned fixture files, asserting the decision against `jq -e`:

```bash
for f in fixtures/*.json; do
  clooks test ./.clooks/hooks/no-rm-rf.ts --input "$f" \
    | jq -e '.result == "allow"' > /dev/null \
    || { echo "FAIL: $f did not allow"; exit 1; }
done
```

Notes:

- `fixtures/*.json` here means **author-owned fixture files** — JSON files committed in your project alongside the hook. NOT the in-binary example payloads from `clooks test example`; those are documentation, not a fixture catalog.
- The natural starting point for an author-owned fixture is to run `clooks test example <Event>`, copy the JSON block out of the prose document into a `.json` file, then edit the values.
- `jq -e '.result == "block"'` works for negative-assertion fixtures.
- Exit code alone is enough for many cases — check `$?` directly if `jq` is unavailable.

The harness's stdout output is a single JSON line; chains like `... | jq '.reason'` work cleanly.

## Known limitations

The harness is for testing handler logic, not engine plumbing. The following are deliberately out of scope for v1:

- **No wire normalization.** The harness consumes the cleaned-up Context shape. Bugs in the engine's wire-to-context transformation are not caught here. Covered by Clooks's E2E suite.
- **Signal is never aborted.** `ctx.signal` is a real `AbortSignal` but the harness never aborts it. Hooks that branch on `signal.aborted` exercise only the non-aborted path. No `--abort-after` flag in v1.
- **Multi-hook reduction not run.** The harness runs exactly one hook. Composition, ordering, and reduction across multiple hooks for the same event require the engine.
- **YAML input not supported.** JSON only.

When a behavior depends on something in this list, fall back to a real Claude Code invocation or a direct unit test against engine helpers.

## Drift gate

Example payloads ship in `src/examples/contexts/<Event>.json` and are validated against the cleaned-up Context types at commit time by `scripts/verify-context-examples.ts`, wired into `lefthook.yml`'s `pre-commit` block as `verify-context-examples`. The validator generates a synthetic `.ts` file that asserts each payload `satisfies CreateContextPayload<'<Event>'>` and runs `tsc --noEmit` over it. The gate is scoped to changes under `src/examples/**` and `src/types/contexts.ts`.

If `verify-context-examples` fails, two recovery paths exist:

1. **The example is wrong.** The Context type changed in a way that requires the example to be updated. Edit the offending JSON to match. The `tsc` error names the event and the offending field.
2. **The Context type change is wrong.** Revert the change to `src/types/contexts.ts`.

Either way, re-run `bun run scripts/verify-context-examples.ts` until it exits 0, then commit. This drift gate protects authors who copy-paste from `clooks test example <Event>` output: if the cleaned-up types change, the rendered documentation tracks the type, and the validator catches the mismatch before a stale payload reaches an author.

## Related

- [Hook Author Testing](../hook-author-testing.md) — parent overview
- [Invocation & JSON Shape](./invocation-and-shape.md)
