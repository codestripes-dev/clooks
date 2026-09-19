# Hook Author Testing

How hook authors exercise a single hook against a synthetic event using `clooks test`. Aimed at developers writing hooks for their own project or for the marketplace. For the project's own E2E suite (which validates Clooks itself), see [testing.md](../testing.md).

This index points to focused sub-docs in `docs/domain/testing/hook-author-testing/`. The detailed material is split across files to stay under the 300-line per-file domain-doc cap.

## Overview

`clooks test` is a one-shot harness that runs **one** hook handler against **one** synthetic event payload. The fast-feedback loop between editing a hook and running it under Claude Code.

Mental model: the harness reads a JSON payload describing a single event, loads the hook file, finds the per-event handler, dispatches the handler with a context object, then prints whatever the handler returned (the decision result) as JSON to stdout, and exits with a code reflecting the decision.

The harness deliberately skips two layers the engine runs in production:

- **Wire normalization.** The harness consumes the cleaned-up `Context` shape that hooks program against, not Claude Code's wire-shape JSON. There is no wire-to-context translator in the harness path.
- **The multi-hook reducer.** The harness runs exactly one hook. Composition, ordering, and result reduction are not exercised.

This is intentional. The harness validates **handler logic** (and per-hook lifecycle — `beforeHook` / `afterHook` do run; see [Lifecycle wrappers](hook-author-testing/invocation-and-shape.md#lifecycle-wrappers)). Engine plumbing — wire translation, multi-hook reduction — is validated by Clooks's own E2E suite.

The harness body lives in `src/commands/test.ts:59` (`runHarness`). Synthetic context construction lives in `src/testing/create-context.ts:174` (`createHarnessContext`).

## Sub-docs

| Document | Path | Topics |
|----------|------|--------|
| Invocation & JSON Shape | `hook-author-testing/invocation-and-shape.md` | The two output contracts, invocation forms, the synthetic Context JSON shape (required/defaulted fields, `hookConfig` overrides, lifecycle wrappers), decision-result interpretation |
| Examples & Usage | `hook-author-testing/examples-and-usage.md` | Worked PreToolUse/UserPromptSubmit/AskUserQuestion examples, the CI loop pattern, known limitations, the drift gate |

## Related

- [testing.md](../testing.md) — Clooks's own E2E test suite (validates the runtime, not hooks).
- [cli-architecture/commands-hooks.md](../cli-architecture/commands-hooks.md) — Command Reference includes `clooks test`.
- [claude-code-hooks/io-contract.md](../claude-code-hooks/io-contract.md) — Claude Code's wire shape (the harness does NOT consume this; cross-reference for "what does Claude Code actually send?").
- [hook-type-system/decision-methods.md](../hook-type-system/decision-methods.md) — Per-event decision methods that produce the result objects the harness prints.
