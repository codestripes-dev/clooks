# Hook Author Testing

How hook authors exercise a single hook against a synthetic event using `clooks test`. Aimed at developers writing hooks for their own project or for the marketplace. For the project's own E2E suite (which validates Clooks itself), see [testing.md](../testing.md).

## Overview

`clooks test` is a one-shot harness that runs **one** hook handler against **one** synthetic event payload. The fast-feedback loop between editing a hook and running it under Claude Code.

Mental model: the harness reads a JSON payload describing a single event, loads the hook file, finds the per-event handler, dispatches the handler with a context object, then prints whatever the handler returned (the decision result) as JSON to stdout, and exits with a code reflecting the decision.

The harness deliberately skips two layers the engine runs in production:

- **Wire normalization.** The harness consumes the cleaned-up `Context` shape that hooks program against, not Claude Code's wire-shape JSON. There is no wire-to-context translator in the harness path.
- **The multi-hook reducer.** The harness runs exactly one hook. Composition, ordering, and result reduction are not exercised.

This is intentional. The harness validates **handler logic**. Engine plumbing — wire translation, multi-hook reduction, lifecycle wrapping — is validated by Clooks's own E2E suite.

The harness body lives in `src/commands/test.ts:59` (`runHarness`). Synthetic context construction lives in `src/testing/create-context.ts:174` (`createHarnessContext`).

## Two outputs, two interaction patterns

`clooks test` has two subcommands with deliberately different output contracts. Mixing them up is the most common authoring mistake.

### `clooks test <hook-file>` emits valid JSON

Output is exactly one JSON object on stdout — the value the handler returned. Pipe it to `jq`. Automate freely.

```bash
echo '{"event":"PreToolUse","toolName":"Bash","toolInput":{"command":"echo hi"},"toolUseId":"tu_test_0001","originalToolInput":{"command":"echo hi"}}' \
  | clooks test ./.clooks/hooks/my-hook.ts
# {"result":"allow"}
```

### `clooks test example <Event>` emits prose-and-JSON documentation

Output is a human-readable document with a JSON code block embedded inside it. **Do not pipe it to `jq`.** The document as a whole is not parseable JSON. Authors copy-paste the JSON block out of it as the starting point for their own fixtures.

```bash
clooks test example PreToolUse
# Prints a Markdown-like document. Read it. Copy the JSON block.
# Do NOT pipe to jq — the surrounding prose makes the document invalid JSON.
```

This distinction is load-bearing: `clooks test <hook>` is for automation, `clooks test example` is for reading.

## Invocation forms

```bash
# Stdin
cat fixture.json | clooks test ./.clooks/hooks/my-hook.ts

# Explicit input file
clooks test ./.clooks/hooks/my-hook.ts --input fixture.json

# Example documentation for an event
clooks test example PreToolUse
clooks test example UserPromptSubmit
```

`clooks test example <Event>` always exits 0 on a known event; exits 2 on an unknown event with a message pointing at `clooks types`.

## The JSON shape

The harness consumes the **cleaned-up** Context shape — the same shape hooks program against, not Claude Code's wire shape. A fixture is a JSON object with an `event` field plus the event-specific required fields. The harness fills in `BaseContext` defaults and attaches decision methods.

For Claude Code's wire shape (what the agent actually sends, before normalization), see [claude-code-hooks/io-contract.md](../claude-code-hooks/io-contract.md). Authors do not need to touch that — the harness fixture matches the type the handler programs against.

### Required fields per event

The harness errors with exit 2 if the `event` field is missing or unknown, or if the hook does not export a handler for that event. Per-event required fields:

| Event | Required |
|---|---|
| `PreToolUse`, `PostToolUse` | `event`, `toolName`, `toolInput` |
| `PermissionRequest`, `PermissionDenied` | `event`, `toolName`, `toolInput` |
| `UserPromptSubmit` | `event`, `prompt` |
| `SessionStart` / `SessionEnd` | `event`, `source` / `reason` |
| `WorktreeCreate` / `WorktreeRemove` | `event`, `path` |
| `Notification` | `event`, `notificationType`, `message` |
| `PreCompact` / `PostCompact` | `event`, `trigger` |
| `StopFailure` | `event`, `errorType` |
| `ConfigChange` | `event`, `source` |
| `InstructionsLoaded` | `event`, `memoryType`, `loadReason`, `path` |
| `Stop` / `SubagentStop` / `SubagentStart` | `event` |
| `TeammateIdle` / `TaskCreated` / `TaskCompleted` | `event` + the event-specific payload |

The above is reproduced from the feature spec. The authoritative per-event shape lives in `src/types/contexts.ts`. When in doubt, run `clooks test example <Event>` — its required-fields section is generated from the same metadata the harness validates against.

For the four tool-keyed events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`), `toolInput` is shape-keyed by `toolName`. The 10 built-in tools (`Bash`, `Edit`, `Write`, `Read`, `Glob`, `Grep`, `Agent`, `WebFetch`, `WebSearch`, `AskUserQuestion`) have specific `toolInput` shapes. `ExitPlanMode` and any `mcp__*` tool accept arbitrary `Record<string, unknown>` as `toolInput`. Run `clooks test example PreToolUse` for the full field-by-field documentation of all 10 tools' shapes inline in one document.

### Defaulted optional fields

The harness fills in `BaseContext` fields the JSON omits. Authors override only when the hook reads them. Defaults set by `createHarnessContext` (`src/testing/create-context.ts:174`):

| Field | Default |
|---|---|
| `sessionId` | `"test-session-0000000000000000"` |
| `cwd` | `process.cwd()` |
| `transcriptPath` | `"/tmp/clooks-test-transcript.jsonl"` |
| `parallel` | `false` |
| `signal` | a real `AbortController().signal` (never aborted) |
| `permissionMode`, `agentId`, `agentType` | omitted (already optional on `BaseContext`) |

A handler that reads `ctx.cwd` to resolve a path needs no override. A handler that branches on `ctx.permissionMode` should set `permissionMode` in the JSON to exercise each branch.

### `hookConfig` — defaults only, no overrides

The harness dispatches every handler with the hook's `meta.config` defaults as the second argument — same merge as production (`src/loader.ts:144-146`), minus `clooks.yml` overrides. **There is no `--config` flag in v1.**

If your hook declares `meta.config: { logDir: '.clooks' }`, the handler sees `{ logDir: '.clooks' }`. If your hook has no `meta.config`, the handler sees `{}`. Either way, the default-config code path is exercised.

If your hook's behavior depends on a non-default value from `clooks.yml`, the harness cannot simulate that today — exercise it in a real Claude Code invocation or in a unit test that constructs the config directly. A `--config` flag is the natural follow-up if marketplace authors hit this gap.

### Lifecycle wrappers

`beforeHook` and `afterHook` exports run in the same order as the engine: `beforeHook` first (return `event.block` / `event.skip` to short-circuit the handler **and** `afterHook`; `event.passthrough` or void to continue), then the handler, then `afterHook` (observer-only — `event.handlerResult` is set; the return is discarded). `event.meta` uses deterministic harness stubs (`gitRoot: null`, `timestamp: '2026-01-01T00:00:00.000Z'`, real `hookName`/`hookPath`/`clooksVersion`/`platform`); hooks that branch on real git state need a real Claude Code invocation.

## Decision-result interpretation

The handler returns a decision object — the value of `ctx.allow()`, `ctx.block({...})`, etc. The harness prints that object as JSON and exits with a code derived from the `result` tag.

| `result` tag | Meaning | Exit |
|---|---|---|
| `allow` | Hook approves the action. | 0 |
| `skip` | Hook has no opinion; pipeline continues. | 0 |
| `success` | Implementation event completed successfully. | 0 |
| `continue` | Continuation event: keep going. | 0 |
| `retry` | Implementation event: retry. | 0 |
| `ask` | `PreToolUse`: defer to user confirmation. Permissive. | 0 |
| `defer` | `PreToolUse`: hand off to a later hook or user. Permissive. | 0 |
| `block` | Hook refuses the action. | 1 |
| `failure` | Implementation event reports failure. | 1 |
| `stop` | Continuation event: halt. | 1 |
| (handler returns `undefined`) | Notify-only hook. Stdout prints `{}`. | 0 |
| (handler throws) | Hook crashed. Stderr `clooks test: hook threw: <message>`. | 2 |
| (harness usage error) | Missing args, bad JSON, no handler for event, etc. | 2 |

Exit codes are designed for shell composition: 0 means "the hook ran cleanly and made a decision the harness understood as permissive or neutral"; 1 means "the hook ran cleanly and decided to refuse or report failure"; 2 is reserved for harness or hook errors and is never an author-intended outcome.

`ask` and `defer` are exit 0 because they are permissive author-intended branches for `PreToolUse` hooks that want user confirmation rather than a hard refusal. Treating them as exit 1 would break shell loops that mean to allow ask'd flows.

The full mapping lives in `src/commands/test.ts:31` (`exitCodeForResult`).

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

- **No `--config` overrides.** `meta.config` defaults flow through; `clooks.yml`-style overrides cannot be simulated in v1. See [`hookConfig` — defaults only, no overrides](#hookconfig--defaults-only-no-overrides) above.
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

- [testing.md](../testing.md) — Clooks's own E2E test suite (validates the runtime, not hooks).
- [cli-architecture.md](../cli-architecture.md) — Command Reference includes `clooks test`.
- [claude-code-hooks/io-contract.md](../claude-code-hooks/io-contract.md) — Claude Code's wire shape (the harness does NOT consume this; cross-reference for "what does Claude Code actually send?").
- [hook-type-system/decision-methods.md](../hook-type-system/decision-methods.md) — Per-event decision methods that produce the result objects the harness prints.
