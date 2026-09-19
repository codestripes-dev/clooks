# Shared Interactive Approval Transport — Engine Checkpoints

`executeHooks`' interaction/signal arguments, the approval-specific lifetime boundary, sequential and parallel ask handling, raw-history recording, and final-operation reconfirmation. Part of [Shared Interactive Approval Transport](../interactive-approvals.md).

## Engine Checkpoints

`executeHooks` receives the interaction as optional
argument 11 and invocation signal as optional argument 12, after result policy.
`RunEngineDeps` can inject both interaction creation and the signal.

The lifetime boundary is approval-specific: pending live interactions must close
and drain, but this is not a general graceful-shutdown contract for all engine
events. `RunEngineDeps.onApprovalLifecycle(active)` tells the CLI when paired
PreToolUse owns awaited abort; `runEngineCore` resets it in `finally` around
`runEngineCoreOwned`. Typed `ApprovalFailure` narrows approval-error translation
without changing unrelated Claude fatal exits. Its explicit constructor preserves
message/cause and supplies the diagnostic name. Non-approval engine exits retain
their immediate path.

`InvocationResultPolicy.mutableToolInput` preserves legacy shared input references
when the run layer wraps a policy. Ordinary Claude allow-patch merging remains
unchanged; ask patches require strict validation before consent. Private
PreToolUse observations are collected for both agents on every PreToolUse,
without a policy opt-in flag.

Paired PreToolUse metadata is `CLOOKS_APPROVAL_PROTOCOL=1`,
`CLOOKS_APPROVAL_OWNER=global|project:<id>` and
`CLOOKS_APPROVAL_DISPOSITION=run|suppressed`. `CLOOKS_AGENT` still selects the
adapter. The run layer opens pairing before project discovery/config/imports;
adapter `approvalIdentity` parses the original native IDs. Missing interaction
does not simulate consent: an actual ask produces a setup/refusal failure, while
a no-ask invocation needs no user response. Generated registration is described
below; its review/testing is separate from the accepted engine boundary.

Sequential execution completes beforeHook, handler and afterHook, then audits
the detached result. An accepted ask captures the original question and reason before handoff
can replace it with a file pointer, builds the candidate operation including its
patch, and waits before committing that candidate or starting the next hook.
Approval continues the same invocation once. Decline, cancellation, expiry or
transport failure latches an interaction failure outside configurable hook-crash
degradation; a user decline is not counted as a crashing hook.

An exact valid form refusal or cancellation is carried as a typed internal
user decision. Its final PreToolUse denial is respectively
`[hook-name] Approval declined. Operation not run.` or
`[hook-name] Approval cancelled. Operation not run.` Both adapters serialize that
denial as their normal exit-0 PreToolUse block. Codex omits its duplicate
`systemMessage` only for these two typed outcomes. Malformed responses, transport
errors, shared-signal cancellation and unrelated policy failures retain their
existing fallback translations.

Parallel hooks retain concurrent startup and the prohibition on input rewrites.
The batch is audited and effective blocks selected before its asks are presented
in configured order, not promise-settlement order. A known denial suppresses
unnecessary questions; a defer vote does not. Later groups wait for this phase.
Already-started trusted hook I/O cannot be undone by cancellation.

Raw history and lifecycle observation retain the returned ask, not a fabricated
allow or replay. `ctx.turn` remains the invocation-start snapshot throughout the
pipeline; recording an ask does not update the next hook's live history. Once
committed, the raw ask appears once in the next invocation's applicable history,
subject to the existing [turn-state persistence limits](../turn-state.md).
Private `resolvedAsk` bookkeeping treats approved asks as allows
for reduction, including their eligible contexts and accepted sequential input
changes. Explicit denial and defer retain their precedence and field-dropping
rules. Approval does not override either native sandbox policy or a later guard.

After diagnostics, adapter adjustment and native serialization, the run layer
extracts the actual operation through `serializedApprovalOperation`. Each earlier
approval whose operation differs is reconfirmed in original checkpoint order,
using fresh increasing ordinals without executing any hook again. Already encoded
output is not run through a codec twice. Denial output does not request final
confirmation; a later adjustment cannot erase an existing denial. The operation
is checked again after confirmation, and output is held until interaction close;
close failure is translated as refusal.

For a typed user refusal, the run layer resets approval-lifecycle ownership and
selects exit 0 before writing the exact native denial. Only completion of the
stdout stream write callback permits publication of the matching denial
acknowledgement. A failed write publishes no acknowledgement. Callback completion
is a local pipe-write receipt, not proof that the agent consumed the output.

`ask` is a live consent checkpoint, not `defer`. Claude defer retains its native
mode-dependent behavior; Codex defer remains unsupported. A mixed ask/defer flow
must still resolve its asks because defer is not a universal native veto. The
standalone `clooks test` command reports raw `ask` and `defer` with exit 0 and
does not open a live interaction: that exit code is synthetic test classification,
not consent, native permission or proof that a tool ran.

## Related

- [Shared Interactive Approval Transport](../interactive-approvals.md) — parent overview
- [Internal Command API](./command-api.md)
- [Generated Registration & Identity](./registration-and-identity.md)
