# Native Interactive Approval Probes — Claude Interactive Config Discriminators

The `--interactive-config` modes (`disk`, `cli-no-tools`, `cli-restart`, `cli-second-turn`) and readiness diagnostics. Part of [Native Interactive Approval Probes](../interactive-approvals.md).

## Claude Interactive Config Discriminators

Use the same explicit binary environment assignments above and select exactly
one existing interactive case, for example:

    bun run test:approvals-native --interactive-config=disk claude-defer-interactive-command-first
    bun run test:approvals-native --interactive-config=cli-no-tools claude-defer-interactive-command-first
    bun run test:approvals-native --interactive-config=cli-restart claude-defer-interactive-command-first
    bun run test:approvals-native --interactive-config=cli-second-turn claude-defer-interactive-command-first

`disk` uses the existing server object in project `.mcp.json` and the same hooks
and permissions in `.claude/settings.local.json`, plus
`enabledMcpjsonServers: ["checkpoints"]`. It removes explicit CLI MCP/settings
registration and empty setting sources, but keeps `--tools Bash,Write`.
`cli-no-tools` instead retains original CLI registration and removes only
`--tools Bash,Write`. Both start with fresh disposable HOME and project trust.
The default `cli` retains the original explicit CLI registration.

`--interactive-readiness=mcp-status` is a separately named diagnostic for explicit
interactive cases: it opens the native `/mcp` status view, observes the connected
server, closes the view, then submits the first tool request. Receipts identify
that context because opening the view may advance native state. The default
`input-render` barrier only observes the prompt and typed-input rendering after
connection; neither is a proven ordinary-startup fix.

`cli-restart` completes a priming tool turn under the original CLI flags, performs
native cleanup, then relaunches unchanged HOME/project/config/argv/environment.
Priming is labeled separately, not counted as a successful interaction. Its
logs, model responses, mailbox records and cleanup move under `priming/`; the
actual scenario uses fresh logs, model sequence and native call ID. Generated
config bytes are checked unchanged, and current debug/journal must be absent
before relaunch, so old connection/reply evidence cannot satisfy the new case.
`restart.json` records input continuity and identities; `priming/summary.json`
records the original result and whether native created a discovery cache. The
runner never fabricates a cache or rewrites native/vendor code to create one.

`cli-second-turn` instead keeps one interactive process alive across two distinct
tool turns. The denied first turn is priming evidence, not a successful operation.
After its command exits, the harness archives its model requests, mailbox and
journal records under `priming/`, assigns a new call ID and submits a second user
turn. It keeps the full process debug log and the original server-birth record
for cleanup; `second-turn.json` records both identities. The second turn must
independently satisfy the normal two-approval/original-effect oracle, not replay
or resume the denied call.

Observed Claude 2.1.272 result: the first three bounded variants failed with a native
connection before the hook's `server 'checkpoints' not connected` skip. No MCP
call, replies or native effect occurred; the original operation was denied
`MCP peer unavailable`. Failure rc remains 1, not a normal-flow pass. The restart
had no persisted discovery-cache directory, so a verified cached-client restart
is still unproved. Exact artifacts and version hashes are retained in runner-owned
`tmp/approvals-native/run-*/` directories. These fixture failures do not establish
healthy interactive pairing, production support, or the underlying native cause.
The separately tested same-process second turn passed with one MCP call, two
replies and exactly one native effect. That demonstrates later-turn behavior,
not reliable cold first-turn interaction or a proved native root cause. Scope,
concurrency and child-operation behavior remain unverified by these cases.
The same diagnostic can also encounter a successful first turn, which violates
its required denied-priming precondition and must not be labeled a second-turn
pass. Such a failed diagnostic is distinct from a native approval failure.
An unmet priming precondition is recorded in `diagnostic-precondition.json` as
`precondition-not-reproduced`. The fixture sends a controlled native completion
marker, then fails using the retained assertion error after native exit; it does
not force a denial, retry for a preferred outcome, or wait for the outer timeout.
Diagnostic pass receipts identify the config and second-turn-only phase and
explicitly exclude the denied first turn from success.
Late Codex line-handler errors remain test failures after turn completion, replacement journals use no-overwrite creation, and diagnostic receipts separate the required denied first turn from artifact-verified outcomes.

Every Docker invocation also runs the fixture helper tests. Run those alone with
`bun test ./test/native-approvals/channel.test.ts`; the leading `./` selects the
file outside Bun's default `src/` root. Use that prefix for every direct target
outside `src/`; in a mixed command, an unprefixed `test/native-*` target can be
silently omitted while matching `src/` tests still run. These are validation-helper
tests, not native enforcement evidence. Full compiled tests still use
`bun run test:e2e`.

## Related

- [Native Interactive Approval Probes](../interactive-approvals.md) — parent overview and commands
- [Generated Registration](./generated-registration.md)
- [Scoped Registration & External Boundaries](./scoped-bootstrap-boundaries.md)
