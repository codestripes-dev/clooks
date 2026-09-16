# Shared Interactive Approval Transport

The shared transport lives in `src/interaction/`; `clooks mcp` exposes its MCP
stdio endpoint. It connects one command invocation to its matching native MCP
check without replaying the command. Engine checkpoints are implemented in
`execute.ts`, `run.ts` and `live-approvals.ts` and validated through the compiled
test suite. The transport itself does not execute hooks or install registration.
The historical Codex token-retry runtime, `clooks approve` command and token
store are removed. Legacy databases remain inert and untouched; token-looking
shell text and environment variables cannot grant consent. Compiled engine
validation is separate from native generated-registration conformance.

## Internal Command API

`createApprovalInteraction(options, testing?)` in `channel.ts` returns an
`ApprovalInteraction` with `request(question, signal)` and asynchronous `close()`.
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
PreToolUse observations are collected for both providers on every PreToolUse,
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

Parallel hooks retain concurrent startup and the prohibition on input rewrites.
The batch is audited and effective blocks selected before its asks are presented
in configured order, not promise-settlement order. A known denial suppresses
unnecessary questions; a defer vote does not. Later groups wait for this phase.
Already-started trusted hook I/O cannot be undone by cancellation.

Raw history and lifecycle observation retain the returned ask, not a fabricated
allow or replay. `ctx.turn` remains the invocation-start snapshot throughout the
pipeline; recording an ask does not update the next hook's live history. Once
committed, the raw ask appears once in the next invocation's applicable history,
subject to the existing [turn-state persistence limits](turn-state.md).
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

`ask` is a live consent checkpoint, not `defer`. Claude defer retains its native
mode-dependent behavior; Codex defer remains unsupported. A mixed ask/defer flow
must still resolve its asks because defer is not a universal native veto. The
standalone `clooks test` command reports raw `ask` and `defer` with exit 0 and
does not open a live interaction: that exit code is synthetic test classification,
not consent, native permission or proof that a tool ran.

## Generated Registration

Registration has passed compiled validation and independent review; this is not
generated-registration native conformance. `registration-approvals.ts`
creates a PreToolUse command/`mcp_tool` pair with explicit protocol, provider and
owner and 330-second native budgets. The companion calls `clooks.check` with
native session/tool-use IDs and Codex turn ID. Other events stay command-only.
`registration-project.ts` prepares separate Claude/Codex project markers; Codex
reuses its existing locator marker. Global owner is literal `global`.

`registration-mcp.ts` prepares only the owned `clooks` server. Claude project and
global files are `.mcp.json` and `HOME/.claude.json`; Codex uses project
`.codex/config.toml` or the effective global Codex home's `config.toml`. The TOML
helper parses before range edits, preserves unrelated syntax/comments and edits
owned command/args/timeouts without whole-file serialization. Init preflights
selected settings, server destinations, identities and shared outputs before
committing per file. Foreign server conflicts are not overwritten.

Claude-selected init/uninstall reject any defined `CLAUDE_CONFIG_DIR`, including
empty/default-valued overrides, and existing `HOME/.claude/.config.json` before
mutation. Codex-only operations and custom `CODEX_HOME` remain independent;
`CLOOKS_HOME_ROOT` does not relocate registration or approval IPC.

Suppression is command-authoritative: paired bypass/dedup calls the PATH-resolved
binary with disposition `suppressed` so the companion completes neutrally. The
MCP process never duplicates the launcher's selection logic. Uninstall recognizes
owned command/companion/server remnants, preserves servers still referenced by
other handlers, and full cleanup retains `.cache/approvals-live`. It reports
`retainedPaths` and `deleted:false` if the runtime directory remains. No runtime
migration advisories or automatic installation are introduced.

Full removal refuses a `.clooks` root symlink before mutations. A retained owned
Codex server keeps its recovery identity when unrelated hooks still reference
it. Claude global unhook instead retires its dedup flag after hook removal and
before the fallible server commit, avoiding project suppression if that commit
fails.

## Identity And Rendezvous

`protocol.ts` defines one strict `CheckInput` schema and derives the advertised
MCP input schema from it. Inputs contain literal protocol version `1`, provider
`claude-code` or `codex`, owner `global` or `project:<persisted-id>`, native
`session_id` and `tool_use_id`. Codex additionally requires native `turn_id`.
Unexpanded placeholders and extra fields are rejected. Owner scope is supplied
by the command/registration boundary, not inferred by the MCP process.

The mailbox key hashes canonical identity. Exclusive command/check claims,
a fresh command nonce, check claim identity, question ordinal and question digest
bind the exchange. Complete packets are published through a private temporary
file and an exclusive hard link; existing claims or packets are never replaced.

One immutable election selects a started command or a closed unmatched check.
The check waits up to one second for a start, then returns neutral if it wins
closure. A later command may still complete without asking, but an actual ask
requires a live attachment to its nonce and cannot reopen a closed election.
Process existence alone is not attachment. The check rereads completion after
observing command death, avoiding a false failure when completion publication
and process exit race.

## MCP Server

`handleApprovalCheck(input, elicit, options?)` validates one check, performs the
rendezvous, relays questions and returns a native hook result. A supplied
`question` must be nonblank and at most 512 JavaScript UTF-16 code units; it is
preserved verbatim, including multiline text. Omission and `undefined` preserve
legacy behavior. Invalid values reject the whole ask before elicitation or tool
effects on both providers. The field is shared presentation metadata and never
enters native hook JSON.

The human-facing message uses double-newline-separated sections. With a
question it renders the question, exact operation, complete reason verbatim,
then `Requested by <hookName>`. Without a question it renders the complete
reason first, then the operation and attribution; it never derives a headline
from reason text. An operation renders as `Command:\n<command>` only when the
packet's exact tool name is `Bash`, its input has exactly one `command` string
field, and that command is one line with no control characters. Raw Codex names
such as `exec_command`, Bash inputs with any other field, and every other tool
use `Tool: <toolName>\nInput:\n<JSON>`. JSON uses two-space indentation, retains
all fields, supports primitive inputs and is never truncated. The message omits
the internal question ordinal and serialized question envelope. The form has
one required string property named `decision`, titled `Decision`, with decline-first enum values
`Decline` and `Approve` and no default. SDK 1.26's restricted requested-schema
shape uses only root `type`, `properties` and `required`.

Only an elicitation response with `action: accept` and exact content
`{ decision: "Approve" }` approves. The local response parser is strict even
though the requested form schema cannot advertise `additionalProperties`:
missing or malformed content and unexpected top-level or content fields do not
approve. Decline, cancellation, missing peers and expiry also do not. Wire
consent is separate from the correlated internal `confirmed: boolean` mailbox
reply.
The active request monitors command completion/death and the invocation deadline;
late answers cannot reopen completed work.

Successful completion, suppression and unmatched closure return text containing
`{}`. Observable failures return text containing native `PreToolUse` denial JSON
inside a successful MCP tool result, rather than relying on `isError: true` for
enforcement. The companion does not emit an allow, duplicate context, or rewrite
tool input. Direct model calls without a matching command cannot mint consent.

`createApprovalServer(options?)` returns `{ server, close }` using the official
TypeScript MCP SDK. It advertises only `check`, limits concurrent checks and
tracks their promises. Recoverable SDK protocol reports, including a late reply
to a cancelled elicitation RPC, do not close the server or unrelated checks.
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
Its lifecycle is awaited by the CLI. See [CLI Architecture](cli-architecture.md)
for protocol-only stdout and shutdown dispatch.

## Storage And Limits

`storage.ts` owns private runtime/storage helpers. Production resolves absolute
`HOME` to its real path, then uses `.clooks/.cache/approvals-live/v1`, independently
of project configuration overrides or `CODEX_HOME`. Managed ancestors must be
real same-owner directories without group/other write permission; existing
0755 `.clooks` and `.cache` directories are valid. The dedicated namespace and
mailboxes are private. Existing directories are not chmodded. Packet reads reject
symlinks, non-files, wrong ownership, exposed permissions and oversized content.

Internal defaults, not user configuration:

| Limit | Value |
| --- | --- |
| Active invocation budget | 295 seconds, from 300 seconds minus a 5-second reserve |
| Unmatched check discovery | 1 second |
| Command attachment wait | 3 seconds, capped by remaining invocation time |
| Poll interval | 20 ms |
| SDK elicitation timeout cap | 325 seconds, capped by remaining active time |
| Packet size | 64 KiB |
| Questions per invocation | 32 |
| Concurrent server checks | 64 |
| Terminal retention constant | 10 minutes |
| Cleanup inspection budget | 128 directory entries per pass |

Cleanup is opportunistic on mailbox opening, not a background expiry service or
an exact deletion deadline. One process-local directory cursor inspects at most
128 entries per call and resumes on subsequent calls, so an unprunable prefix
does not restart every scan. It closes at directory exhaustion, root change,
iteration error or server shutdown. There is no cleanup daemon or idle timer.

Fully terminal roles become eligible ten minutes after the maximum completion
timestamp, even if the owning processes remain alive. A dead unfinished command
instead uses its start deadline, or claim time plus 300 seconds if no start
exists; a dead unfinished check uses claim time plus 300 seconds. Retention is
added after those abandoned-role fallback times. An unfinished role whose PID
is alive prevents collection regardless of age. Retirement excludes new
publication and eligibility is rechecked before removal.

Invalid or unreadable state is not permission to delete potentially live work.
Such state, and expired entries not yet reached by a later scan, may remain on
disk. Packet/check/scan limits do not establish a total disk quota, a bound on
the number of mailbox directories, or guaranteed collection during inactivity.
Terminal records are live IPC state, not durable consent or reusable approval
tokens.

## Validation Boundary

`src/interaction/protocol.test.ts` and `channel.test.ts` contain source-level
identity/JSON validation and exchange scenarios: both arrival orders, immutable
questions, non-positive replies, crossed identities, duplicate claims, bounded
missing attachment/deadline, cancellation and command-death completion races.
`storage.test.ts` covers permission/publication boundaries, exact terminal
retention, dead-role grace, active-role preservation and cursor progress beyond
128 unprunable entries. `server.test.ts` uses the official SDK for initialization,
schema, elicitation, cancellation, concurrent-check limits and stream shutdown.
`src/commands/mcp.test.ts` covers awaiting server shutdown, signal forwarding,
startup failure propagation and stderr-only help. The compiled counterpart is
`test/e2e/interactive-transport.e2e.test.ts`. Focused regressions cover failed
terminal publication with a queued accept, late cancelled RPC responses while
another check waits, and SDK close rejection with cursor/listener cleanup.
See [Testing](testing.md) for the Docker-only compiled test workflow and
[native approval probes](testing/interactive-approvals.md) for separate fixture
evidence.

Native availability and transport correctness are distinct. The Codex cold-child
lazy-start limitation is not fixed by this server, and production warming is not
prescribed. Native expiry or loss of both enforcing peers can permit execution;
controlled failures must deliver denial before the upstream deadline. Native
fixture acceptance does not establish compiled engine or release behavior.
