# Shared Interactive Approval Transport — MCP Server

`handleApprovalCheck`, per-agent message layout, elicitation schema/response validation, `createApprovalServer`, and stream/signal handling. Part of [Shared Interactive Approval Transport](../interactive-approvals.md).

## MCP Server

`handleApprovalCheck(input, elicit, options?)` validates one check, performs the
rendezvous, relays questions and returns a native hook result. A supplied
`question` must be nonblank and at most 512 JavaScript UTF-16 code units; it is
preserved verbatim, including multiline text. Omission and `undefined` preserve
legacy behavior. Invalid values reject the whole ask before elicitation or tool
effects on both agents. The field is shared presentation metadata and never
enters native hook JSON.

Codex retains the existing human-facing message byte-for-byte. Its sections are
separated by double newlines: optional question, exact operation, complete reason
when a question exists, and `Requested by <hookName>`. Exact command-only Bash
input renders as `Command:\n<command>` when the command has no control or Unicode
line-separator characters. Other inputs render as
`Tool: <toolName>\nInput:\n<JSON>`.

Claude uses the same complete legacy layout for non-Bash operations and for Bash
commands containing a newline or another prohibited control character. For an
exact `Bash` operation with record input and a safe single-line string `command`,
its first block is the optional question (otherwise the complete reason), the
actual command, and the existing `Requested by <hookName>` label, joined by
single newlines. When a question exists, the complete reason follows as its own
unmodified block. When the input has keys beyond `command`, the complete legacy
`Tool: Bash\nInput:\n<JSON>` block follows and includes every field, including
the command. Exact command-only input does not duplicate JSON. All JSON uses
two-space indentation and is never truncated by Clooks. Neither agent's
message includes the internal ordinal or serialized question envelope.

Claude Code 2.1.273's native preview shows at most the first three message lines
plus a continuation marker when a message exceeds four lines, truncates
individual lines to the available width, and offers no expansion control.
Leading with the question, command and hook improves that preview but cannot
promise that every detail is visible. Author questions and reasons are never
shortened, so a multiline headline can consume the native preview budget.

The form is selected from the verified mailbox agent. Claude Code receives
the exact fieldless schema `{ type: "object", properties: {} }`, which its native client
presents as one `Accept`/`Decline` confirmation. Codex retains one required
string property named `decision`, titled `Decision`, with decline-first enum
values `Decline` and `Approve` and no default; an empty form is not used because
Codex can auto-accept it. SDK 1.26's restricted requested-schema shape uses only
root `type`, `properties` and, for Codex, `required`.

Claude approves only `action: accept` with exact empty-object content `{}`.
Missing, null, non-object or nonempty acceptance content fails closed. Claude
decline/cancel accepts absent content or exact `{}` only; malformed content fails
closed rather than becoming a typed user decision. Codex approves only
`action: accept` with exact content `{ decision: "Approve" }`; its decline,
cancel and accepted `Decline` responses remain refusals. Both local parsers
reject unexpected top-level or content fields. Agent selection uses the
validated mailbox key, never response shape or client naming. Missing peers and
expiry of bounded non-human work also do not approve. Wire
consent is separate from the correlated internal `confirmed: boolean` mailbox
reply.
Before attachment and after a response, the active request monitors command
completion/death and its local invocation deadline. Human response time is not
charged to that deadline: the command timestamps the wait when it publishes the
question, including the bounded attachment interval and server pre-elicitation
latency, and the server timestamps it immediately before requesting elicitation.
The host supplies no acknowledgement that a prompt rendered. Each peer extends
its local deadline by its own observed interval. For later questions, the
invocation-scoped attachment already exists, so the command relies on the
server's pre-elicitation budget check during that latency. The immutable wire
deadline is retained for correlation, abandoned-state cleanup and bounded
non-human work. During elicitation the server still monitors cancellation,
disconnect and command death, and late answers cannot reopen completed work.

Successful completion, suppression and unmatched closure return text containing
`{}`. After a valid form refusal/cancellation, the companion first publishes the bound
negative reply and waits within the resumed non-human budget for the command's
matching `denial-ack.json`; only that acknowledgement makes the companion return
`{}`. Missing, malformed, stale or crossed acknowledgement, command death before
a valid acknowledgement, timeout, or acknowledgement-publication failure returns native `PreToolUse`
denial JSON inside a successful MCP tool result. Other observable failures keep
the same denial fallback rather than relying on `isError: true` for enforcement.
The companion does not emit an allow, duplicate context, or rewrite tool input.
Direct model calls without a matching command cannot mint consent.

`createApprovalServer(options?)` returns `{ server, close }` using the official
TypeScript MCP SDK. It advertises only `check`, limits concurrent checks and
tracks their promises. Recoverable SDK protocol reports, including a late reply
to a cancelled elicitation RPC, do not close the server or unrelated checks.
The pinned SDK 1.26 dependency has a maintained patch adding exact
`RequestOptions.timeout: null`; Clooks uses that value for elicitation so the SDK
does not install its own response timer. With exact `null`, SDK
`maxTotalTimeout` and `resetTimeoutOnProgress` have no timer to cap or reset.
Omitted timeout still means 60 seconds, numeric values retain their original
behavior, and abort-signal cancellation, result validation and late-response
cleanup remain active.
There is no server-wide abort handler on generic `server.onerror`. Tests can
connect SDK in-memory transports or inject an
elicitation function into the lower-level handler. SDK runtime imports are kept
off the command-side channel path.

`serveApprovalStreams(input, output, options?)` connects SDK stdio framing to
Node `Readable`/`Writable` streams and returns `Promise<void>`. Options carry an
abort signal and optional internal runtime overrides, as for the server factory.
This tests EOF and malformed-input behavior without process death and owns no
process signal handlers. `runApprovalServer({ signal }?)` supplies stdin/stdout and
signal handlers. The stdio transport's own error callback handles fatal
framing/read failures, separately from recoverable SDK protocol reports. EOF,
transport failure and cancellation abort active checks;
shutdown awaits their settlement and closes the server and cleanup cursor.
Cleanup and listener removal run in `finally` even if SDK transport close rejects;
explicitly awaited shutdown still reports that failure. The process wrapper
removes its SIGINT/SIGTERM handlers, while the stream helper removes its input
EOF/error listeners.
Its lifecycle is awaited by the CLI. See [CLI Architecture](../cli-architecture.md)
for protocol-only stdout and shutdown dispatch.

## Related

- [Shared Interactive Approval Transport](../interactive-approvals.md) — parent overview
- [Generated Registration & Identity](./registration-and-identity.md)
- [Storage & Validation](./storage-and-validation.md)
