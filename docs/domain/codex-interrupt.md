# Codex Interrupt

`Interrupt` is a Codex-only observer for interruption of an active root turn.
It is not `Stop` or `SessionEnd`, cannot veto cancellation, and does not request
continuation. Claude registration and event recognition exclude it; shared
configuration, reserved names, hook exports, generated schema and types include it.

## Context and Results

The native envelope requires nonempty `session_id`, `turn_id`, `cwd`, `model`, and
`permission_mode`. Nullable or absent `transcript_path` normalizes to an empty
string; incompatible values are rejected before hooks load. Public context uses
`sessionId`, `cwd`, `model`, `permissionMode`, and `transcriptPath`, plus the common
runtime fields. Native `turn_id` stays private as `invocation.private.nativeTurnId`;
there is no public `turnId`. `ctx.turn` is hook history, not the native identifier.
Extra child-agent fields do not select a child scope. Interrupt uses root history
without advancing/resetting the turn or closing the session.

`InterruptContext` exposes only `skip({ debugMessage? })`; `InterruptResult` is
skip-only. No decision, context injection, input update, continue or veto control
is supported. Unsupported results and local failures produce only stdout JSON
`systemMessage`, with exit zero so the native parser can consume the diagnostic.
That exit status is not successful handler execution: local failure accounting
still applies. Debug messages remain local stderr. Human diagnostics are not
promised as model context.

Registration uses one command with `timeout: 3` for the entire pipeline, including
lifecycle handlers, imports and all observers. This matches SessionEnd's explicit
budget, but not its output behavior: SessionEnd output is ignored upstream while
Interrupt supports `systemMessage`. Registration upgrades missing/old entries,
is byte-idempotent when canonical, and preserves unrelated hooks during removal.

## Source and Test Evidence

Source baseline: `rust-v0.153.4`, commit
`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`. The links below pin that revision,
not the latest Codex release:

- [Input schema](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L627)
  and [output schema](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L485).
- [Output parser](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/output_parser.rs#L259):
  `parse_interrupt` reads only `systemMessage`.
- [Discovery deadline](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/discovery.rs#L740):
  one-second default, hard three-second maximum.
- [Hook runtime](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L486):
  `run_turn_interrupt_hooks` excludes subagents and
  flushes the transcript before invoking hooks.
- [Task cancellation](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tasks/mod.rs#L946):
  interruption, rather than ordinary shutdown or normal
  completion, invokes the observer after task cancellation.

Unit coverage lives in `src/agents/codex/interrupt.test.ts`; compiled registration
replay lives in `test/e2e/codex-interrupt.e2e.test.ts`. Synthetic stdin replay proves
Clooks dispatch, not native event delivery. The durable synthetic envelope is
`test/fixtures/codex/events/interrupt.json`.

The pinned full native smoke passed the `INTERRUPT` case implemented in
`test/native-codex/interrupt-scenario.ts`. It sends SIGINT only after an actual
scripted model request is active. The case verifies generated `timeout: 3`, native
observer execution, nonempty normalized session/model/permission fields, and a
transcript containing both the submitted prompt and the flushed `<turn_aborted>`
user marker before the hook reads it. Codex exec then shuts down gracefully with
exit code 1 and no terminating signal, within the harness's 30-second deadline.
That process deadline is distinct from the three-second hook pipeline budget.

This proves root-turn observer execution and transcript availability on the tested
interruption path. It does not prove diagnostic delivery to a human or model,
child delivery, cancellation veto, or behavior after invalid observer results.

## Trigger Guidance

Best trigger: start pinned `codex exec` against the scripted Responses provider,
wait until an actual model request is active, keep that response pending, then
send SIGINT to the Codex process. Avoid fixed-delay signals, a completed turn,
EOF/shutdown, or killing the whole process group (which can kill the observer).
Wait for orderly cancellation and the hook marker rather than force-killing
immediately. An app-server `turn/interrupt` against a known active turn is an
alternative when the harness already supports it.

Related: [cross-agent hooks](cross-agent-hooks.md),
[native testing](testing/codex-native.md).
