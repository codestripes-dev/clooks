# Hook Author Testing — Invocation & JSON Shape

The two output contracts, invocation forms, the synthetic Context JSON shape (required/defaulted fields, `hookConfig` overrides, lifecycle wrappers), and decision-result interpretation. Part of [Hook Author Testing](../hook-author-testing.md).

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

For Claude Code's wire shape (what the agent actually sends, before normalization), see [claude-code-hooks/io-contract.md](../../claude-code-hooks/io-contract.md). Authors do not need to touch that — the harness fixture matches the type the handler programs against.

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
| `agent` | `"claude-code"`; explicitly set `"codex"` to exercise that branch |
| `helpers.belongsToPlugin` | always returns `false` for JSON harness fixtures |
| `sessionId` | `"test-session-0000000000000000"` |
| `cwd` | `process.cwd()` |
| `transcriptPath` | `"/tmp/clooks-test-transcript.jsonl"` |
| `parallel` | `false` |
| `signal` | a real `AbortController().signal` (never aborted) |
| `permissionMode`, `agentId`, `agentType` | omitted (already optional on `BaseContext`) |

A handler that reads `ctx.cwd` to resolve a path needs no override. A handler that branches on `ctx.permissionMode` should set `permissionMode` in the JSON to exercise each branch.

JSON cannot supply a function, so `clooks test` intentionally uses a no-I/O `helpers.belongsToPlugin` implementation that returns `false`; it never reads the developer's real plugin homes. In source unit tests, call `createContext` or `createHarnessContext` with an explicit `helpers` fake to exercise a positive result. Use compiled engine E2E coverage to test real agent discovery. Neither form treats membership as authorization.

`agent` is deliberate synthetic identity: omission defaults to Claude regardless of `CLOOKS_AGENT`. Only `"claude-code"` and `"codex"` are accepted; explicit null, empty or unknown values produce a usage error before lifecycle/handler execution. Both lifecycle slots see the same value at `event.input.agent`. Setting `"agent":"codex"` does not run Codex normalization, capability policy or output translation; the harness still consumes normalized context and emits the hook's decision object.

**The harness does not simulate agent scoping.** `clooks test` dispatches the matching handler directly — it never runs `matchHooksForEvent()`, so a hook's `meta.agents` (or a `clooks.yml` `agents` override) has no effect here: the handler runs regardless of the fixture's `agent` value, which only changes what `ctx.agent` reads inside the handler. Eligibility itself — whether an agent-excluded hook's handler runs at all — is covered by the engine's own tests and by `test/e2e/agent-scoping.e2e.test.ts`, not by this harness. See `docs/domain/cross-agent-hooks/agent-scoping.md` for what "excluded" means at runtime.

### `hookConfig` — overriding via `--config` / `--config-json`

The harness dispatches every handler with a `hookConfig` map as the second argument. Two mutually-exclusive flags control what reaches the handler — passing both is exit 2. When neither is passed, only `meta.config` defaults flow through (the baseline behavior). Both flags shallow-merge the override over `meta.config` defaults — same shape as production's `loadHook` (`src/loader.ts:144-146`): `{ ...hook.meta.config, ...override }`. The only difference is where `override` comes from:

- **`--config <path>`** — reads a `clooks.yml`-shaped YAML file. The file is the **only** merge layer; the harness does not pull in `~/.clooks/clooks.yml` or `.clooks/clooks.local.yml`. The harness finds the entry whose `resolvedPath` matches the hook file under test and uses that entry's `config:` field as `override`. `lifecycleMeta.configPath` reflects the resolved YAML path.
- **`--config-json '<json>'`** — parses the literal as a JSON object (null/array/scalar are exit 2) and uses it directly as `override`. `lifecycleMeta.configPath` stays at the no-config stub.

**`--hook-name <alias>`** is the documented escape hatch when path-match is ambiguous (a YAML registers the same hook under multiple aliases) or when matching needs to be explicit. It requires `--config`. If the matched entry has `enabled: false`, the harness runs the handler anyway with no warning — `enabled` is a clooks-runtime gate, not a hook-behavior concern, and the explicit `clooks test` invocation already signals intent. For a worked example showing both flags producing identical merged config, see [hook-config-overrides.md](../hook-config-overrides.md).

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
| `ask` | Raw PreToolUse consent request; no live question is opened by this harness. | 0 |
| `defer` | Raw PreToolUse defer decision, distinct from consent. | 0 |
| `block` | Hook refuses the action. | 1 |
| `failure` | Implementation event reports failure. | 1 |
| `stop` | Continuation event: halt. | 1 |
| (handler returns `undefined`) | Notify-only hook. Stdout prints `{}`. | 0 |
| (handler throws) | Hook crashed. Stderr `clooks test: hook threw: <message>`. | 2 |
| (harness usage error) | Missing args, bad JSON, no handler for event, etc. | 2 |

Exit codes are designed for shell composition: 0 means "the hook ran cleanly and made a decision the harness understood as permissive or neutral"; 1 means "the hook ran cleanly and decided to refuse or report failure"; 2 is reserved for harness or hook errors and is never an author-intended outcome.

`ask` and `defer` retain synthetic exit 0 for the existing test-command contract.
Neither means consent was obtained, native permission was granted, or a target
tool executed. The runtime's live checkpoint wait belongs to the engine, not this
single-hook harness. Defer is not an approval response and has separate native
mode restrictions. Do not use a harness exit 0 as authorization to execute a tool.

The full mapping lives in `src/commands/test.ts:31` (`exitCodeForResult`).

## Related

- [Hook Author Testing](../hook-author-testing.md) — parent overview
- [Examples & Usage](./examples-and-usage.md)
