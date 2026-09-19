# Shared Interactive Approval Transport — Internal Command API

`createApprovalInteraction`, the `ApprovalInteraction` shape, question/reply semantics, and closure/failure latching. Part of [Shared Interactive Approval Transport](../interactive-approvals.md).

## Internal Command API

`createApprovalInteraction(options, testing?)` in `channel.ts` returns an
`ApprovalInteraction` with `request(question, signal)`, asynchronous `close()`,
and a private command-side `acknowledgeDenial(decision, nativeDenial)` method.
Options contain a `CheckInput` identity, optional `disposition` (`run` by default
or `suppressed`), and optional invocation-wide `AbortSignal`. The second argument
overrides internal HOME, clock, process-liveness and wait dependencies for tests;
it is not a public configuration surface.

Each question contains a hook name, increasing ordinal, optional author-supplied
question headline, required reason and exact
`{ toolName, input }` operation. Input accepts bounded JSON, not only shell
commands or object-shaped tool arguments. The channel snapshots the question
before yielding and binds its digest to the response. Ordinals begin at one;
requests within one interaction are sequential. Concurrent requests terminate
that interaction rather than sharing a response.

Replies are `approved`, or a failure with a message and kind `declined`,
`cancelled`, `unavailable` or `timed-out`. Transport setup can reject before an
interaction exists; callers must handle setup errors and await closure on their
own exit paths. A pending request closed by the caller is cancelled. Failures
latch for that invocation. Closure marks local state closed before attempting
terminal publication and always aborts local waits and removes the invocation
abort listener. If publication fails, the original write error is retained;
`close()` drains any pending request in `finally` before rejecting with that
error. Failed publication therefore cannot leave a queued positive reply able
to reopen local consent. Setup failure still preserves its original error.
A suppressed interaction publishes completion
immediately and cannot request consent; a no-question caller can close without
waiting for an MCP attachment.

These are internal APIs. Hook result constructors remain synchronous; the engine,
not `ctx.ask()`, owns the asynchronous wait.

## Related

- [Shared Interactive Approval Transport](../interactive-approvals.md) — parent overview
- [Engine Checkpoints](./engine-checkpoints.md)
- [Generated Registration & Identity](./registration-and-identity.md)
