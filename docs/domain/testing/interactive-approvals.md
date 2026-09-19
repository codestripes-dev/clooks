# Native Interactive Approval Probes

`test/fixtures/interactive-approvals/` contains illustrative command checkpoints,
not the production Clooks engine. The separate `--generated` mode below uses
`test/fixtures/production-approvals/` with compiled Clooks and actual init-generated
registration. Its 26-case inventory contains project shell, global-only shell,
project non-shell and six shell-only combined cases.
Native clients, hook schedulers, MCP connections and final tools execute for real.
Illustrative passes do not establish production ordering. In automated probes,
the loopback model and elicitation replies are scripted. Passing automated cases
do not establish human consent, model reasoning, normal trust policies, or release
conformance. Human TTY manual evidence with no scripted elicitation responder
can establish human replies for the observed case; the model remains scripted,
and that evidence does not establish production behavior.

This index points to focused sub-docs in `docs/domain/testing/interactive-approvals/`. The detailed material is split across files to stay under the 300-line per-file domain-doc cap.

## Commands

Run from the repository root with explicitly supplied existing executables:

    CLOOKS_CLAUDE_BINARY=/absolute/path/to/claude \
      CLOOKS_CODEX_BINARY=/absolute/path/to/codex \
      bun run test:approvals-native --baseline

In illustrative mode, `--baseline` selects two approvals in each handler order
for both agents. Omit it to select the illustrative inventory, or supply exact
case names such as `codex-long-command-first`. `--transport` instead runs the SDK
stdin-closure regression. Unknown, duplicate and empty selections fail. `passed.json` covers
only the named executed cases, never unimplemented scenarios.

## Sub-docs

| Document | Path | Topics |
|----------|------|--------|
| Generated Registration | `interactive-approvals/generated-registration.md` | `--generated` mode: case naming/selection, native `init`, build snapshotting, production fixture execution, decline/cancellation evidence, failure handling |
| Generated Registration — Protocol & Timing | `interactive-approvals/generated-registration-protocol.md` | Elicitation/UI mailbox protocol, compiled-engine coverage, timing/deadline budgets, registration E2E, acceptance/cancellation verification |
| Claude Interactive Config Discriminators | `interactive-approvals/interactive-config.md` | `--interactive-config` modes (disk, cli-no-tools, cli-restart, cli-second-turn), readiness diagnostics |
| Scoped Registration & External Boundaries | `interactive-approvals/scoped-bootstrap-boundaries.md` | Scoped registration/bootstrap cases, overlap candidates, external native timeout/dual-exit boundaries |
| Isolation & Fixture Lifetime | `interactive-approvals/isolation-and-lifetime.md` | Illustrative-fixture isolation/evidence contracts, mailbox fixture lifetime and budgets |
