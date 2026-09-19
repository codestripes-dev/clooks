# CLI Architecture — Engine Mode & Dispatch

Stdin reading for engine mode, the three-way mode dispatch (engine/CLI/MCP), the engine-mode run path, and mode-aware signal handling. Part of [CLI Architecture](../cli-architecture.md).

## Empty Hook Input

The default engine reader in `src/engine/stdin.ts` reads `Bun.stdin.bytes()` once. Zero bytes or only ASCII JSON whitespace (space, tab, LF, CR) raise `EmptyStdinError`; all other bytes go unchanged to `new Blob([bytes]).json()`. BOM, nonbreaking space and malformed UTF-8 are not classified as empty. Injected `RunEngineDeps.readStdin` readers still return parsed `Promise<unknown>` values.

Both stdin catches use `formatStdinError`: only the dedicated error receives the empty-input diagnostic; ordinary failures retain the existing JSON parse prefix and error message. Configured empty input exits 2 with empty stdout and no hook handler execution. Unpaired Claude retains its late read; Codex reads before imports. The paired PreToolUse path reads native identity before discovery/configuration so it can open and close the live interaction. The raw-read cache retains payloads and errors even after an advisory-only cwd-fallback read; the run path no longer reads for token-store retirement.

## Mode Dispatch

`src/cli.ts` is the compiled binary's entrypoint. It serves three roles from a single executable:

1. **Engine mode** — An agent hook system pipes a JSON event on stdin with no arguments. The selected adapter writes agent-specific output. Claude has its existing runtime; Codex implements twelve events, including observation-only SessionEnd and Codex-only Interrupt.
2. **CLI mode** — A developer types a subcommand (e.g., `clooks config`). Commander.js parses arguments and runs the command's action handler.
3. **MCP mode** — `clooks mcp` runs the shared approval server over stdio. Commander routes the command, but stdout is reserved for MCP protocol traffic and shutdown awaits server cleanup. Engine checkpoints are implemented; generated registration is described below with its separate validation boundary.

### Dispatch logic

The dispatch reads `process.argv.slice(2)`, scans the first argument not starting
with `-`, and selects MCP mode early when that argument is `mcp`. This selection
also governs version output and signals before router import. Dispatch then uses:

1. **Version check** — If args include `--version` or `-v`, print `clooks <VERSION>` and exit 0, using stderr for MCP mode and stdout otherwise. This precedes command dispatch, so `clooks -v config` prints the version (not the config). Version is handled here, not in Commander, to avoid ambiguity with subcommand flags.
2. **First positional scan** — Find the first arg that does not start with `-`. This handles global flags before the subcommand (e.g., `clooks --json config` finds `config`, not `--json`).
3. **Known subcommand** — If the first positional is in `KNOWN_COMMANDS`, dynamic-import `router.ts`. Ordinary commands set `currentMode = 'cli'` and call `runCLI(args)`; MCP retains its mode and passes the shutdown signal to `runCLI`.
4. **Has args but no known subcommand** — Same as above. Covers `--help`, misspelled subcommands, and unknown flags. Commander handles the error/help display.
5. **No args, piped stdin** (`!process.stdin.isTTY`) — Engine mode. Call `runEngine()`.
6. **No args, TTY stdin** — CLI mode. Call `runCLI(args)` with empty args, which triggers Commander's help output.

### Engine mode flow

`runEngine()` selects an agent adapter from `CLOOKS_AGENT` before reading stdin:

- unset or empty `CLOOKS_AGENT` -> `claude-code`
- `CLOOKS_AGENT=claude-code` -> explicit Claude Code adapter
- `CLOOKS_AGENT=codex` -> Codex adapter with `supportsRuntime: true`, handling all twelve target events through event-specific normalization, capability policy and translation
- any other value -> exit code 2 with a diagnostic before runtime execution

These exits establish Clooks refusal, not universal upstream blocking. Codex's handling is event-specific; native evidence is scoped by event and capability in [Codex Native Testing](../testing/codex-native.md).

The selector does not inspect stdin. Registration owns agent identity because Claude and Codex share event names such as `SessionStart`, `PreToolUse`, `PostToolUse`, and `Stop`.

After selection, `runEngine()` delegates to `runEngineCore(adapter, deps)`. The core remains responsible for project discovery, config loading, hook loading, matching, execution, lifecycle handling, circuit-breaker behavior, and result reduction. The adapter owns the wire-specific operations: event-name parsing and validation from the raw payload, context normalization, Claude-only plugin/settings advisories, notify-only/system-message routing, and final wire output. Normalization now runs once before the no-hook/no-match exits because turn-state maintenance needs session identity even when no user hook handles the boundary event. See [Turn State](../turn-state.md).

The normalization boundary is `normalizeInvocation(payload, eventName)`. It returns public `context` separately from private agent, raw payload, session/child identity and optional tool-codec metadata. Only the public context enters lifecycle inputs. Claude retains its recursive key normalization, PermissionDenied rename and existing late-input ordering; its retained raw payload is a separate deep copy. Codex declares `inputStage: 'before-hooks'`: after discovery/config loading, it validates configured input before imports and retains the recognized event for failure translation. No-config still bypasses unused payload normalization; config-error handling reads Codex input to identify a refusal before importing hooks. Adapters hold no mutable invocation state. Discovery receives `adapter.discoveryEnvironment(process.env)`; Claude retains the original environment, while Codex gets a copied view without `CLAUDE_PROJECT_DIR`, preserving explicit `CLOOKS_PROJECT_ROOT`.

An invocation-specific result policy reaches the executor as its optional tenth argument. The executor audits author-capability and parallel-contract results immediately before their effects. Codex's `deferRuntimeErrorAudit` instead lets ordinary error capture, onError selection and counter accounting precede audits of selected blocking errors. Any latched `policyFailure` returns separately from reduced results. The engine selects `translateFailure` when that failure exists, otherwise `translateFinalOutput`; even an allow returned by diagnostic composition or final adjustment cannot select normal translation after rejection. Failure translation receives the private invocation and failure, and its exit code is authoritative: an adapter may express a refusal as exit-0 JSON. No private envelope is spread into hook contexts, result JSON or diagnostic text. This is an internal extension; there is no new public agent/raw field or decision method.

`composeDiagnostics` is agent-owned and returns `{ result, stderr, systemMessages }`. The core emits local stderr and supplies system messages to final translation. Claude preserves its existing routing. Codex PreToolUse puts trace messages into context, degraded notices into human system messages and debug lines only on stderr. Configured no-hook, no-match and result-undefined paths invoke final translation and retain its exit code. The no-config bypass does not fully normalize unused payloads; paired PreToolUse identity parsing is separate from full hook-context normalization and no longer serves token retirement.

The current run path uses shared live checkpoints instead of Codex token issuance,
retry discharge or consumption. Explicit paired metadata selects identity and
disposition before discovery/configuration; ordinary `CLOOKS_AGENT` selection is
unchanged. The executor waits at asks, then the run layer inspects the actual
serialized operation and reconfirms changed approvals before closing and emitting
output. For a valid form refusal/cancellation, it resets approval-lifecycle ownership,
selects the normal PreToolUse denial exit, and writes the exact native denial before
publishing the private mailbox acknowledgement. Acknowledgement requires the
stdout write callback; command death before valid acknowledgement or
write/publication failure leaves the MCP
companion's fallback denial in force. The callback is a local pipe receipt, not
proof that the agent consumed output. Typed `ApprovalFailure` selects
approval-error translation without catching unrelated Claude fatal errors as
permission refusals. The former token
controller, store and `approve` command are removed; old databases remain inert
and untouched. Token-looking command text is literal input, not consent. The
[historical native token suite](../codex-approvals.md) does not validate this flow.

For `before-hooks` adapters, `runEngineCore()` catches invocation/runtime errors using the retained event and private invocation and calls `translateFailure()`. Internal `EngineCompletion` carries intentional exits so they are not mistaken for runtime failures; the selected exit code reaches the process after the catch boundary. Codex normalizes twelve events before imports. Invalid input or unsupported result capabilities use event-specific denial/block/termination requests where supported and local stderr/exit 2 otherwise. SessionEnd requires no model, permission mode or turn ID; it has no turn-state policy, emits no stdout on success and routes diagnostics locally to stderr. Its failure cannot veto closure. Interrupt requires model, permission mode and native turn ID, preserves the existing turn boundary and exposes no child identity. It emits only optional stdout `systemMessage` diagnostics, with no decision, context or cancellation veto. Both observers register a three-second total pipeline timeout. Agent-specific hook/load/config failure paths and private `resolveTurnPolicy()` are connected. The earlier PreToolUse integration and expanded ten-event boundary passed Docker validation; generated-error accounting uses `deferRuntimeErrorAudit`. This is not a full native-capability or enforcement claim. See [Cross-Agent Hooks](../cross-agent-hooks/codex-capabilities.md#current-runtime-capabilities).

### KNOWN_COMMANDS

`src/known-commands.ts` exports a `Set<string>` of recognized subcommand names. This set exists so `cli.ts` can detect subcommands without importing Commander.js (keeping engine mode fast — no Commander overhead).

The set must stay in sync with the commands registered in `router.ts`. This is enforced by a test in `cli.test.ts` that imports both and asserts equality.

## Mode-Aware Signal Handlers

`cli.ts` installs global handlers for `SIGINT`, `SIGTERM`, `uncaughtException`, and `unhandledRejection` before any dispatch logic runs. The signal handlers branch on `currentMode`:

- **Engine mode** (`currentMode === 'engine'`) — Write a diagnostic to stderr. During an active paired PreToolUse approval lifetime, abort and await the run layer's refusal/cleanup; otherwise exit immediately with code 2 (`EXIT_STDERR`). Whether the upstream agent blocks depends on the event; this is not a universal Codex enforcement guarantee.
- **CLI mode** (`currentMode === 'cli'`) — Exit with code 0. Interactive commands should exit cleanly on Ctrl-C.
- **MCP mode** (`currentMode === 'mcp'`) — Abort the server signal without immediate process exit. The awaited server lifecycle closes checks and transport; shutdown does not emit a CLI JSON envelope.

`uncaughtException` and `unhandledRejection` report diagnostics on stderr.
MCP sets exit code 2 and aborts for awaited cleanup. Active paired PreToolUse
aborts through the run layer; outside those lifetimes, fatal errors exit 2
immediately. MCP startup failures retain the stderr/exit-code path.

`RunEngineDeps.onApprovalLifecycle(active)` is the narrow CLI ownership signal,
set when paired PreToolUse opens its interaction and reset by `runEngineCore`
in `finally` around `runEngineCoreOwned`. Ordinary engine signal/fatal exits,
including non-approval Codex Stop, do not wait for a general hook drain. The MCP
server lifecycle is independent of this command-side ownership.

### MCP Command

`src/commands/mcp.ts` dynamically imports `runApprovalServer` and awaits it.
MCP help, version and argument errors use stderr, including `--json mcp`;
`--json` does not wrap MCP messages in the ordinary CLI output envelope. The
router uses an invocation-specific Commander instance when given a shutdown
signal, and MCP parser exits set `process.exitCode` rather than terminating
before cleanup. Ordinary CLI output conventions remain unchanged.

The server listens for EOF, transport failure, SIGINT and SIGTERM, cancels active
checks and awaits settlement before closing the transport and retained cleanup
cursor. Generic SDK protocol reports such as late cancelled RPC responses do not
trigger server-wide shutdown; fatal framing/read errors use the stdio transport
error callback separately. The
`serveApprovalStreams` helper separates stream lifecycle from process signal
registration for tests; it still uses the SDK's stdio framing. Listener and
cursor cleanup runs through `finally` even when SDK close rejects; the awaited
failure is not converted into successful shutdown. Its SDK runtime is not imported by
the command-side approval channel. See
[Shared Interactive Approval Transport](../interactive-approvals.md) for the internal
API and current limits. This command does not install or repair registration,
start hooks, or itself implement engine checkpoint ordering. That integration is
owned by the run/executor path, not MCP command dispatch.

## Related

- [CLI Architecture](../cli-architecture.md) — parent overview and key files
- [Command Framework](./command-framework.md) — Commander setup, TUI wrappers, JSON output
- [Setup Commands](./commands-setup.md) — `init`, `config`, `types`, plugin installer
- [Hook & Lifecycle Commands](./commands-hooks.md) — `add`, `new-hook`, `update`, `test`, `uninstall`
