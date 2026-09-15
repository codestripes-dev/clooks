# Codex Approvals: Historical Token Runtime

This page records the former token-retry runtime and its retained CLI/store
components. The current engine integration no longer uses that runtime path;
replacement live-checkpoint integration is implemented and compiled-test validated.
The retained `clooks approve` command/store and their files have not yet been
physically retired. Descriptions of token issuance, retry discharge and runtime
consumption below are historical, not current engine guidance or evidence of
generated-registration conformance. Historical validation receipts keep their original
scope. See [Shared Interactive Approval Transport](interactive-approvals.md) for
the implemented transport and engine checkpoint behavior.

## Former Runtime

Codex PreToolUse handlers can return `ctx.ask({ reason })` through a Clooks runtime fallback. After the hooks finish, an unresolved confirmation becomes a native denial with the hook alias, reason, opaque token, fixed expiry and instructions to ask the user and wait. Acknowledged confirmations can discharge the final ask on a matching retry. This is not native Codex `ask` support: Clooks never emits native ask, and Claude retains native approval behavior. The runtime baseline passed full frozen-source Docker validation. The pinned Codex 0.153.4 native suite passed all 15 cases, covering two-ask shell inline retries, direct-patch CLI registration, bounded rewrite permission controls and actual-pack `rm -r` execution/replay refusal. This is not forced-removal allow proof or full conformance. See [native evidence and limits](testing/codex-native.md#hybrid-approval-case-evidence).

Only handler PreToolUse asks enter the approval fallback. Any string reason is valid, including empty or whitespace-only strings; those receive a display-only fallback while their exact original bytes remain bound. A dynamically returned `beforeHook` ask is unsupported: the shared lifecycle warns, treats it as a no-op and continues the handler, without creating a confirmation or an independent denial. The policy rejects an ask supplied with before-hook origin, but production lifecycle handling does not forward that return. Other-event handler asks and `defer` remain refused. Existing sequential codec-supported input patches are accepted on ask as on allow; parallel rewrites remain refused.

## Registration

`clooks approve <token>` acknowledges an existing record noninteractively. It does not issue tokens, execute a target, consume the approval, extend its lifetime, or load project configuration. `--json` returns the standard `approve` envelope with `token`, `acknowledgedAt` and `expiresAt` (integer Unix milliseconds). Human output includes the original expiry as an ISO timestamp. Invalid, unknown, expired, consumed or inaccessible records return an error and exit 1. Missing arguments follow Commander usage errors.

State resolves to `${CLOOKS_HOME_ROOT ?? homedir()}/.clooks/approvals/codex.sqlite`, without searching other homes or using `CODEX_HOME`. The command needs no session/project flag: its opaque token locates the previously bound record. Registration acknowledges approval under a trusted-repository, cooperative-agent model; it does not prove human consent.

An agent's shell call to `clooks approve` remains subject to ordinary hooks. If registering token A itself receives ask B, the agent can obtain user approval for B and use `CLOOKS_APPROVAL_TOKENS=<B> clooks approve <A>`. B belongs to that shell invocation; the command then registers A without consuming A. There is no engine exemption or recursive CLI invocation. An explicit block remains blocked and may require policy correction or registration from the user's own terminal.

## Inline Transport

MCP (`mcp__`) inputs are bound as their actual JSON value, including null, scalars,
arrays, and raw argument strings emitted by Codex when JSON parsing fails. Pre/post
hooks can observe those shapes without a fabricated record. Only record inputs
receive the existing partial-patch codec; non-record observation does not enable
arbitrary replacement. Non-shell approval retries use `clooks approve` and unchanged
arguments, never the shell carrier. Compiled replay coverage is not evidence that
an MCP server accepts non-object arguments. Separate [native MCP evidence](testing/codex-native.md#native-handoff-interrupt-and-mcp)
verifies six non-record shapes denied before server execution and one record
rewrite reaching the server and PostToolUse; non-record approval retries remain
compiled replay evidence.

The controller recognizes only a byte-zero `CLOOKS_APPROVAL_TOKENS=<token>[,<token>...] ` prefix in the pending native `Bash` or `exec_command` command. This is tool-input syntax, not acknowledgement from the hook process's inherited environment. Tokens cannot be quoted or contain shell syntax; the prefix carries at most 64 IDs. Registered and inline acknowledgements use the same exact records and can be combined across retries.

Inline eligibility is deliberately narrow: an unquoted external executable word using letters, digits, underscore, dot, slash or hyphen, followed by supported literal arguments, including simple quoted literals. Shell builtins/reserved words, control operators, redirects, newlines, escapes, substitutions and parameter expansions are refused. Uncertain commands and non-shell tools use `clooks approve` followed by unchanged tool arguments; do not wrap a command in `eval` or `sh -c` to manufacture eligibility.

The prefix is removed before normalization, including private raw input, so hook inspection and original-input binding see the carrier-free command. The private attempt retains the original native input. Without an emitted replacement, native execution keeps the prefix; Clooks does not request a rewrite just to remove it. A real accepted rewrite emits the codec's replacement. The Bash launcher is unchanged.

## Binding Boundary

`src/agents/codex/approvals.ts` constructs canonical SHA-256 keys: recursively sorted object keys, preserved array order and exact string bytes from lossless JSON. `approval-store.ts` accepts the three lowercase, 64-character hex keys and enforces equality; it does not independently reconstruct them. The database stores no raw tool input, command, session identifier, hook source or configuration.

- `baseInvocationHash` identifies version, provider, session, referenced agent (null for root), native tool, cwd and carrier-free original input. Turn and tool-use IDs are excluded so approval survives a reply and retry.
- `decisionHash` adds permission mode, the current ordered pipeline and actual emitted operation. Pipeline identity includes global/event configuration, hook aliases and order, execution mode, resolved entry/config paths, entry-file byte hashes, effective loaded hook config and configured entries. The emitted input is the encoded reduced replacement when present, otherwise the carrier-free original input, not unconditionally the materialized input seen by later hooks.
- `confirmationHash` adds the individual accepted ask observation: alias, origin, configured ordinal, accepted result fields and detached before/after tool inputs. Changing one confirmation requires its own reapproval; changing shared pipeline or emitted-input identity invalidates all affected confirmations.

Binding is not a filesystem snapshot or transitive dependency-provenance guarantee. Imported dependencies and filesystem contents are not frozen between attempts or between permission and execution. Tokens acknowledge consent only under the trusted-repository, cooperative-agent model; they do not override native permissions or sandbox policy.

## Execution and Reduction

Approval resolution runs after ordinary execution and reduction, before diagnostic composition. Structured PreToolUse blocks and asks retain their existing vote behavior: every scheduled hook and sequential rewrite runs unless the existing failure/contract rules stop execution. Parallel observations follow configured result-processing order, not promise settlement order. A block or latched policy failure wins; incomplete execution cannot discharge a pending ask, including a failure that otherwise degrades or continues.

The first unresolved ask in configured order is shown. Issuance does not acknowledge it. Earlier acknowledgements survive intermediate denied retries while subsequent asks are confirmed. Once every current ask is acknowledged, only the reduced final `ask` tag changes to `allow`; reason, context, debug and replacement fields remain those of the original reducer. Votes are not remapped and reduced again; losing-ask context is not newly aggregated. Turn history still records raw asks.

Partial patches retain existing semantics: undefined fields are no-ops, null explicitly unsets, and untouched values survive codec validation. If ask A patches X to Y and the winning ask B supplies no patch, later hooks see Y but the reducer can omit replacement entirely when no contributing allow patch exists. The native operation then remains X. A winning ask patch or contributing allow patch can instead cause the materialized input to be emitted. Approval binds that actual emitted operation and each ask's observations separately.

This also applies to ordinary local function object arguments such as `update_plan` and namespaced local tools. The generic codec emits the full replacement without renaming keys or names; command-only and MCP contracts are unchanged. Known public discriminators retain required/optional field validation before a candidate reaches later hooks or approval issuance. Changing the encoded candidate invalidates an acknowledged confirmation even if hook bytes/configuration are unchanged. Local tools use CLI acknowledgement, not shell inline carriers. `write_stdin`, parallel rewrites and non-PreToolUse mutations remain unsupported. Non-record local inputs remain unsupported.

## Lifecycle

Schema v1 records contain `token`, the three binding keys, `issuedAt`, `expiresAt`, nullable `acknowledgedAt`, and nullable `consumedAt`. Tokens are `ca1_` followed by 32 cryptographically random bytes encoded as lowercase hex. The private database retains the raw token so an identical live confirmation can recover the same token across processes.

- `issueOrReuse(binding)` serializes lookup and insertion in one write transaction. It reuses an exact live pending or acknowledged record with unchanged issuance/expiry. Multiple exact live matches are an invariant error. Otherwise it issues a fresh pending token.
- `acknowledge(token)` validates liveness and sets acknowledgement once. Repeated registration is idempotent and never slides expiry.
- `resolveAttempt(binding, presentedTokens, confirmations)` atomically validates and acknowledges presented tokens, then combines them with registered exact records. It deduplicates IDs/confirmations and returns pending confirmation hashes plus `{ token, expectedConfirmationHash }` requirements. Any invalid presented member rolls back the whole acknowledgement group. It does not issue missing records or consume approvals.
- `finalizePermit(baseInvocationHash, expectedDecisionHash, requiredTokens)` updates every required row only when token, base, decision, per-token confirmation hash, acknowledgement, unconsumed state and expiry all match. Each update must affect exactly one row; otherwise all updates roll back. In the same transaction it retires all other acknowledged, unconsumed records for that base, including older decisions. Retirement uses `consumedAt`; it does not claim tool execution.

The lifetime is fixed at exactly 300000 milliseconds from issuance; the expiry boundary itself is invalid. Every write acquires `BEGIN IMMEDIATE` before sampling the injected clock. Repeated retries and lock waits do not extend validity. Pending records are not approvals. Blocks retain acknowledgements; consumption/retirement is irreversible even if later output, tool execution or native permission checking fails.

A null expected decision hash is accepted only with an empty required set for retirement-only calls. Every successful Codex PreToolUse exit retires matching base acknowledgements, including no-config, zero-hook, no-match, no-ask and config-degraded exits. This prevents a successful retry while hooks are absent from leaving approvals reusable when those hooks return. Empty-set finalization does not require an approval for an otherwise ordinary call.

The run layer caches raw input and read errors separately from normalization; an advisory read cannot consume stdin twice. With no existing store and no ask, early exits do not create/open a database or add otherwise-unused stdin reads. Existing-store no-config retirement extracts only the base identity, not unrelated model/turn/tool-use fields. Invalid identity or inaccessible existing storage refuses locally instead of silently skipping retirement. Claude does not access approval storage. The absent-store existence check does not serialize concurrent first creation; no exactly-once guarantee is claimed for that race.

After diagnostics/adjustment and native serialization, the run layer validates the serialized tool-input disposition against the bound candidate before atomically consuming every required token and retiring other base acknowledgements. Serialization, mismatch or consumption errors refuse rather than emit permissive bytes. Output failure after the transaction loses approval; native denial or later tool failure does not restore it. Two processes requiring the same tokens can produce at most one successful consumption, not exactly-once native execution.

## Storage Limits

Operations open and close `bun:sqlite` locally, using rollback journaling (`DELETE`), `synchronous=FULL`, a 1000ms busy timeout, and short explicit write transactions without awaits, hooks or output. The constructor does no I/O. Only issuance may initialize an absent or empty, uninitialized version-zero database; version zero with existing schema objects and unknown versions are refused. Failed initialization may leave an empty database that issuance can retry; corrupt bytes are never deleted or silently recreated.

The managed approvals directory is mode 0700 and database mode 0600. Managed directory/file symlinks and nonregular sidecars are refused. The selected home itself is trusted; this is not protection from hostile concurrent filesystem replacement. Database size is capped at 16MiB using `max_page_count` and an existing-file size check. Journal disk usage is separate from the database ceiling.

At most 10000 unexpired rows (including consumed rows until expiry) and 64 supplied confirmations/tokens per operation are accepted. Overflow refuses new work rather than evicting live approvals. Each successful write prunes at most 256 expired rows. Disk, corruption, schema, lock and invariant errors fail the approval operation; there is no background worker or hook-path vacuum.

Approval storage is separate from best-effort [turn history](turn-state.md). Prompt boundaries do not reset its records. No public hook types, configuration schema or turn-state behavior are changed.

## Evidence

`src/agents/codex/approval-store.test.ts` exercises real SQLite transactions, exact bindings, fixed expiry, rollback, retirement, bounded state, allocation failure/recovery, corruption and independent-process contention. The worker fixture uses disposable HOME, CODEX_HOME, state root and project cwd, explicit handshakes, deadlines and process reaping. `src/commands/approve.test.ts` covers command envelopes and noninteractive registration.

`test/e2e/codex-approvals.e2e.test.ts` is run through Docker. Its test-only hooks import the source store through the compiled engine/config loader; registration exercises the implementation bundled into the compiled CLI. It checks repeated registration, concurrency, routing, unchanged hook blocking, home selection and failures. This remains store/CLI evidence, not proof of integrated runtime asks or native Codex enforcement. Separate runtime coverage in `src/agents/codex/approvals.test.ts`, `src/engine/execute.approvals.test.ts`, `src/engine/run.approvals.test.ts` and `test/e2e/codex-approval-runtime.e2e.test.ts` passed in the full frozen-source Docker gate, alongside the store/CLI suite. The gate included tooling, unit coverage and compiled E2E, with matching source hashes and successful cleanup. Historical native unsupported-ask refusal evidence describes the earlier runtime, not acceptance of this fallback. Separate native cases passed for two-ask inline shell rewrites (execution and forbidden exec-policy denial), direct `apply_patch` with agent-side CLI registration, and patch rewrites (execution and read-only denial). The read-only case used a separate compiled CLI process to simulate user registration outside the native shell sandbox. Pending attempts had no target effects; successful cases checked exact effects, and consumed approvals could not be reused. These synthetic-model cases are part of the passing 15-case native suite, not human-consent proof, new PermissionRequest coverage or full conformance. The repository's vendored no-rm-rf confirmation branch now returns ask on both providers; its other explicit blocks, strict-mode promotion and parser are unchanged. The actual-pack native case passed with `rm -r`: two independent asks preserve the target until both inline acknowledgements, then removal succeeds; replay with consumed tokens leaves the restored target unchanged. This does not prove native permission for `rm -rf`. See [native evidence and limits](testing/codex-native.md#hybrid-approval-case-evidence).
