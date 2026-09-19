# Shared Interactive Approval Transport — Storage & Validation

Storage layout and internal limits, cleanup/retention behavior, and the compiled validation-boundary test inventory. Part of [Shared Interactive Approval Transport](../interactive-approvals.md).

## Storage And Limits

`storage.ts` owns private runtime/storage helpers. Production resolves absolute
`HOME` to its real path, then uses `.clooks/.cache/approvals-live/v1`, independently
of project configuration overrides or `CODEX_HOME`. Managed ancestors must be
real same-owner directories without group/other write permission; existing
0755 `.clooks` and `.cache` directories are valid. The dedicated namespace and
mailboxes are private. Existing directories are not chmodded. Packet reads reject
symlinks, non-files, wrong ownership, exposed permissions and oversized content.
Their zeroed read buffer starts at the observed file size plus one byte, capped
at the packet limit plus one; if a packet grows after inspection, one bounded
fallback buffer preserves in-limit reads and detects growth past the limit.

Internal defaults, not user configuration:

| Limit | Value |
| --- | --- |
| Active non-human invocation budget | 295 seconds, from 300 seconds minus a 5-second reserve; paused for each human approval wait |
| Unmatched check discovery | 5 seconds; bounded startup mitigation, not a guarantee |
| Command attachment wait | 3 seconds, capped by remaining invocation time |
| Poll interval | 20 ms |
| SDK human-response timeout | Disabled with exact `timeout: null`; cancellation and peer/process death remain active |
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
SDK-backed fake-clock cases prove both agents can pair when the check starts
1,226 milliseconds before the command, while exact-bound cases preserve neutral
unmatched closure, terminal late-ask refusal and late no-ask completion. Healthy
and suppressed no-ask paths remain immediate, and command attachment remains
independently bounded at three seconds.
Injected-clock cases advance 331 seconds inside elicitation before the command
can poll again, proving approval, decline and cancel are not converted into a
Clooks timeout. `src/interaction/sdk-timeout.test.ts` exercises the real SDK
request path: null creates no timer, omitted and numeric values retain timers,
and abort still cancels and drains a null-timeout request.
`storage.test.ts` covers permission/publication boundaries, exact terminal
retention, dead-role grace, active-role preservation and cursor progress beyond
128 unprunable entries. It also covers empty, malformed, partial and exact-limit
reads plus post-inspection growth through the exact packet limit and one byte
beyond it. `server.test.ts` uses the official SDK for initialization, schema,
elicitation, cancellation, concurrent-check limits and stream shutdown.
`src/commands/mcp.test.ts` covers awaiting server shutdown, signal forwarding,
startup failure propagation and stderr-only help. The compiled counterpart is
`test/e2e/interactive-transport.e2e.test.ts`. Focused regressions cover failed
terminal publication with a queued accept, late cancelled RPC responses while
another check waits, and SDK close rejection with cursor/listener cleanup.
See [Testing](../testing.md) for the Docker-only compiled test workflow and
[native approval probes](../testing/interactive-approvals.md) for separate fixture
evidence.

Native availability and transport correctness are distinct. Clooks imposes no
human-response timer, while generated native registrations use the very-high
finite fallback described above. Claude Code 2.1.273 treats hook timeout zero as
hook exclusion and omission as 600 seconds. Its recorded short-timeout probe
aborted MCP before Bash proceeded, so eventual native expiry or loss of both
enforcing peers can still permit execution without consent. Codex 0.154 pauses
its MCP handler during elicitation but retains a separate bounded command handler.
Older registrations keep their former 330-second values until explicitly
refreshed with init. The Codex cold-child lazy-start limitation remains, and
production warming is not prescribed. Native fixture acceptance does not
establish compiled engine or release behavior.

## Related

- [Shared Interactive Approval Transport](../interactive-approvals.md) — parent overview
- [MCP Server](./mcp-server.md)
- [Engine Checkpoints](./engine-checkpoints.md)
