# Native Interactive Approval Probes — Generated Registration

`--generated` mode: case naming/selection, actual `clooks init`, build snapshotting, production fixture execution, decline/cancellation evidence, and failure handling. Part of [Native Interactive Approval Probes](../interactive-approvals.md); see also [Protocol & Timing](./generated-registration-protocol.md).

## Generated Registration

Run the compiled-production mode with the same explicit native executables:

    CLOOKS_CLAUDE_BINARY=/absolute/path/to/claude \
      CLOOKS_CODEX_BINARY=/absolute/path/to/codex \
      bun run test:approvals-native --generated

This defaults to exactly 26 cases. The structured descriptors in
`test/native-approvals/generated.ts` use these names: each agent has project
shell `<agent>-generated-<approve|decline-first|decline-second|cancel-first|cancel-second|noask>`,
global-only shell `<agent>-generated-global-<approve|decline-second>`, and
project non-shell `<agent>-generated-project-non-shell-<approve|decline-second>`:
Claude uses `Write`; Codex uses `apply_patch`. The combined shell descriptors
are `claude-generated-combined-approve`,
`claude-generated-combined-decline-second`, `claude-generated-combined-noask`,
and the corresponding three `codex` names. Combined cases use one fixed
project-then-global init order; alternate init orders and non-shell combined
cases are not in this inventory.
Explicit subsets use those names, for example
`bun run test:approvals-native --generated codex-generated-project-non-shell-approve`
with the same environment assignments. Duplicate/unknown cases and illustrative
flags such as `--baseline` are rejected. The inventory is intentionally scoped,
not a Cartesian product.

`test/native-approvals/generated.ts` runs actual compiled
`clooks init --agent <agent> --json`, selecting `claude-code` or `codex`, in
disposable Git projects. Global cases run global-only init; project cases run
project init. Seed disposable trust metadata before `init` for both agents;
the test must not rely on a CLI override to suppress native trust writes. The
generated command/MCP pair, server entry, project identity and entrypoint are
captured and checked using the scope-aware snapshot rules below. Combined
fixtures place hooks 1-2 only in HOME config/files and hooks 3-5 only in the
project, with the source `import.meta.path` recorded in the journal to prove
the merged layer. For Codex combined cases, the observer is pre-seeded in the
project hooks before `init` because both native hook files are occupied; trust
metadata is seeded before `init` as described above, and pre-fixture snapshots
are retained. `native.ts` uses a distinct
generated branch for the existing model/RPC/cleanup machinery: no illustrative
server or CLI pair replaces init's registration. Claude uses print mode and
Codex uses app-server, not a human TTY approval session. Fixture-only observers,
scripted responders, local-model settings and native trust stay separate in
disposable local/user settings. Both init and native launch omit
`CLAUDE_CONFIG_DIR` and `CLOOKS_HOME_ROOT`; Claude uses default-layout
`HOME/.claude.json`, not `config/.claude.json`.

Only generated mode snapshots production build inputs, including the required
`.clooks/vendor/plugin` imports, and typechecks/compiles Clooks inside Docker with
`--compile --bytecode --format=esm`. The resulting `/export/build/clooks` is
selected on each disposable PATH; build logs, source
and binary hashes, Bun version and source commit accompany the frozen input
manifest. Illustrative mode does not compile production Clooks.

The production fixtures execute five real hooks, with asks at 2 and 4 except
in `noask`. Assertions bind native session/tool IDs (plus Codex turn ID), owner,
nonce and displayed operation to the production mailbox. Before each reply,
later hooks/effects must be absent. Approval requires exactly one original-call
effect after hook 5; declines require attributed native refusal, stopped later
hooks and no effect/PostToolUse; no ask requires zero prompts/questions/replies.
For combined cases, global owns the active merged pipeline and
`project:<persistedid>` is suppressed. Exactly two native-bound mailboxes are
required; pending active checks may observe a suppressed peer still starting
and must not require premature completion. Both mailbox pairs must settle before
native teardown. The suppressed project peer always completes neutrally with no
questions, replies or failures; an active global decline records its command
failure while its companion completion remains neutral.
No duplicate pipeline, prompt or effect is accepted. Helper regressions in
`generated.test.ts` check selection and false-pass resistance, not native
enforcement.

For a normal user decline or cancellation, the command is the sole native
denial source. The command publishes its attributed failure and, only after its
denial JSON has been written, a bound `denial-ack` containing the check claim,
refusal ordinal, displayed-question digest, decision and denial-output digest.
That acknowledgement proves completion of the command's pipe write; it does not
prove that the native client displayed or accepted the denial. The companion
must complete neutrally and return `{}`. The native original tool result must
independently contain the same command-attributed reason. Generated packet
oracles therefore require the exact `[hook-N] Approval <declined|cancelled>.
Operation not run.` command reason, a `confirmed: false` refusal reply, a valid
acknowledgement, neutral `check-done`, stopped later hooks and no effect or
PostToolUse. They do not infer an exact UI note count from mailbox packets.

If the command exits before publishing a valid acknowledgement, its output write
fails, or the acknowledgement is missing, malformed or does not bind the exact
denial, the companion remains fail-closed and reports denial. Approval and
no-ask paths publish no denial acknowledgement and retain their prior neutral
companion behavior.

## Related

- [Native Interactive Approval Probes](../interactive-approvals.md) — parent overview and commands
- [Generated Registration — Protocol & Timing](./generated-registration-protocol.md)
- [Claude Interactive Config Discriminators](./interactive-config.md)
- [Scoped Registration & External Boundaries](./scoped-bootstrap-boundaries.md)
- [Isolation & Fixture Lifetime](./isolation-and-lifetime.md)
