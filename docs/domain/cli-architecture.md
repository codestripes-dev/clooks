# CLI Architecture

How the clooks binary dispatches between hook engine mode and interactive CLI mode, and the patterns used by commands, TUI wrappers, and JSON output.

## Empty Hook Input

The default engine reader in `src/engine/stdin.ts` reads `Bun.stdin.bytes()` once. Zero bytes or only ASCII JSON whitespace (space, tab, LF, CR) raise `EmptyStdinError`; all other bytes go unchanged to `new Blob([bytes]).json()`. BOM, nonbreaking space and malformed UTF-8 are not classified as empty. Injected `RunEngineDeps.readStdin` readers still return parsed `Promise<unknown>` values.

Both stdin catches use `formatStdinError`: only the dedicated error receives the empty-input diagnostic; ordinary failures retain the existing JSON parse prefix and error message. Configured empty input exits 2 with empty stdout and no hook handler execution. Claude still imports modules before its late read; Codex still reads before imports and retains its translated failure prefix/disposition. Final newline ownership is unchanged. Missing configuration bypasses unused input validation except when existing Codex approval storage requires identifying the invocation for retirement. The raw-read cache retains payloads and errors even after an advisory-only cwd-fallback read; stdin is never reread for retirement.

## Dual-Mode Dispatch

`src/cli.ts` is the compiled binary's entrypoint. It serves two roles from a single executable:

1. **Engine mode** — An agent hook system pipes a JSON event on stdin with no arguments. The selected adapter writes provider-specific output. Claude has its existing runtime; Codex implements twelve events, including observation-only SessionEnd and Codex-only Interrupt.
2. **CLI mode** — A developer types a subcommand (e.g., `clooks config`). Commander.js parses arguments and runs the command's action handler.

### Dispatch logic

The dispatch reads `process.argv.slice(2)` and applies these rules in order:

1. **Version check** — If args include `--version` or `-v`, print `clooks <VERSION>` and exit 0. This fires before any other logic, so `clooks -v config` prints the version (not the config). Version is handled here, not in Commander, to avoid ambiguity with subcommand flags.
2. **First positional scan** — Find the first arg that does not start with `-`. This handles global flags before the subcommand (e.g., `clooks --json config` finds `config`, not `--json`).
3. **Known subcommand** — If the first positional is in `KNOWN_COMMANDS`, set `currentMode = 'cli'`, dynamic-import `router.ts`, and call `runCLI(args)`.
4. **Has args but no known subcommand** — Same as above. Covers `--help`, misspelled subcommands, and unknown flags. Commander handles the error/help display.
5. **No args, piped stdin** (`!process.stdin.isTTY`) — Engine mode. Call `runEngine()`.
6. **No args, TTY stdin** — CLI mode. Call `runCLI(args)` with empty args, which triggers Commander's help output.

### Engine mode flow

`runEngine()` selects an agent adapter from `CLOOKS_AGENT` before reading stdin:

- unset or empty `CLOOKS_AGENT` -> `claude-code`
- `CLOOKS_AGENT=claude-code` -> explicit Claude Code adapter
- `CLOOKS_AGENT=codex` -> Codex adapter with `supportsRuntime: true`, handling all twelve target events through event-specific normalization, capability policy and translation
- any other value -> exit code 2 with a diagnostic before runtime execution

These exits establish Clooks refusal, not universal upstream blocking. Codex's handling is event-specific; native evidence is scoped by event and capability in [Codex Native Testing](testing/codex-native.md).

The selector does not inspect stdin. Registration owns agent identity because Claude and Codex share event names such as `SessionStart`, `PreToolUse`, `PostToolUse`, and `Stop`.

After selection, `runEngine()` delegates to `runEngineCore(adapter, deps)`. The core remains responsible for project discovery, config loading, hook loading, matching, execution, lifecycle handling, circuit-breaker behavior, and result reduction. The adapter owns the wire-specific operations: event-name parsing and validation from the raw payload, context normalization, Claude-only plugin/settings advisories, notify-only/system-message routing, and final wire output. Normalization now runs once before the no-hook/no-match exits because turn-state maintenance needs session identity even when no user hook handles the boundary event. See [Turn State](turn-state.md).

The normalization boundary is `normalizeInvocation(payload, eventName)`. It returns public `context` separately from private provider, raw payload, session/child identity and optional tool-codec metadata. Only the public context enters lifecycle inputs. Claude retains its recursive key normalization, PermissionDenied rename and existing late-input ordering; its retained raw payload is a separate deep copy. Codex declares `inputStage: 'before-hooks'`: after discovery/config loading, it validates configured input before imports and retains the recognized event for failure translation. No-config still bypasses unused payload normalization; config-error handling reads Codex input to identify a refusal before importing hooks. Adapters hold no mutable invocation state. Discovery receives `adapter.discoveryEnvironment(process.env)`; Claude retains the original environment, while Codex gets a copied view without `CLAUDE_PROJECT_DIR`, preserving explicit `CLOOKS_PROJECT_ROOT`.

An invocation-specific result policy reaches the executor as its optional tenth argument. The executor audits author-capability and parallel-contract results immediately before their effects. Codex's `deferRuntimeErrorAudit` instead lets ordinary error capture, onError selection and counter accounting precede audits of selected blocking errors. Any latched `policyFailure` returns separately from reduced results. The engine selects `translateFailure` when that failure exists, otherwise `translateFinalOutput`; even an allow returned by diagnostic composition or final adjustment cannot select normal translation after rejection. Failure translation receives the private invocation and failure, and its exit code is authoritative: an adapter may express a refusal as exit-0 JSON. No private envelope is spread into hook contexts, result JSON or diagnostic text. This is an internal extension; there is no new public agent/raw field or decision method.

`composeDiagnostics` is provider-owned and returns `{ result, stderr, systemMessages }`. The core emits local stderr and supplies system messages to final translation. Claude preserves its existing routing. Codex PreToolUse puts trace messages into context, degraded notices into human system messages and debug lines only on stderr. Configured no-hook, no-match and result-undefined paths invoke final translation and retain its exit code. The no-config bypass does not fully normalize unused payloads; existing Codex approval storage requires only the identifying fields needed for retirement.

Codex PreToolUse prepares carrier-free input before normalization, including private raw metadata. After execution, the approval controller uses detached, configured-order accepted votes and pipeline identity to issue the first pending confirmation or discharge the final reduced ask. Diagnostic composition and final adjustment follow resolution. The final-output helper validates serialized input against an approval permit before atomic consumption and output; every successful PreToolUse exit also retires existing acknowledgements by base invocation, including config-degraded and no-config exits. Blocks retain approvals. Absent-store no-ask paths avoid opening/creating the database, and no-config keeps its otherwise-unused-input fast path. Identity/storage/serialization failures cannot count as acknowledgement; output failure after consumption loses the tokens. Claude never accesses approval storage. Runtime integration passed full frozen-source Docker validation. The passing [15-case native suite](testing/codex-native.md#hybrid-approval-case-evidence) covers bounded shell and direct-patch approval workflows, rewrite execution/denial controls and actual-pack `rm -r`; it does not establish forced-removal permission or full conformance.

For `before-hooks` adapters, `runEngineCore()` catches invocation/runtime errors using the retained event and private invocation and calls `translateFailure()`. Internal `EngineCompletion` carries intentional exits so they are not mistaken for runtime failures; the selected exit code reaches the process after the catch boundary. Codex normalizes twelve events before imports. Invalid input or unsupported result capabilities use event-specific denial/block/termination requests where supported and local stderr/exit 2 otherwise. SessionEnd requires no model, permission mode or turn ID; it has no turn-state policy, emits no stdout on success and routes diagnostics locally to stderr. Its failure cannot veto closure. Interrupt requires model, permission mode and native turn ID, preserves the existing turn boundary and exposes no child identity. It emits only optional stdout `systemMessage` diagnostics, with no decision, context or cancellation veto. Both observers register a three-second total pipeline timeout. Provider-specific hook/load/config failure paths and private `resolveTurnPolicy()` are connected. The earlier PreToolUse integration and expanded ten-event boundary passed Docker validation; generated-error accounting uses `deferRuntimeErrorAudit`. This is not a full native-capability or enforcement claim. See [Cross-Agent Hooks](cross-agent-hooks.md#current-runtime-capabilities).

### KNOWN_COMMANDS

`src/known-commands.ts` exports a `Set<string>` of recognized subcommand names. This set exists so `cli.ts` can detect subcommands without importing Commander.js (keeping engine mode fast — no Commander overhead).

The set must stay in sync with the commands registered in `router.ts`. This is enforced by a test in `cli.test.ts` that imports both and asserts equality.

## Mode-Aware Signal Handlers

`cli.ts` installs global handlers for `SIGINT`, `SIGTERM`, `uncaughtException`, and `unhandledRejection` before any dispatch logic runs. The signal handlers branch on `currentMode`:

- **Engine mode** (`currentMode === 'engine'`) — Write a diagnostic to stderr and exit with code 2 (`EXIT_STDERR`). This is the existing process-failure channel; whether the upstream agent can block the operation depends on the event. It is not a verified universal Codex enforcement guarantee.
- **CLI mode** (`currentMode === 'cli'`) — Exit with code 0. Interactive commands should exit cleanly on Ctrl-C.

`uncaughtException` and `unhandledRejection` always exit with code 2 regardless of mode.

## Commander.js Setup

`src/router.ts` creates the Commander program:

```typescript
const program = new Command()
program
  .name('clooks')
  .description('A hook runtime for AI coding agents.')
  .showSuggestionAfterError(true)  // "did you mean?" on typos
  .exitOverride()                   // throw CommanderError instead of process.exit()
  .configureOutput({
    writeOut: (str) => process.stdout.write(str),
    writeErr: (str) => process.stderr.write(str),
  })
  .option('--json', 'Output results as JSON')
  .addHelpText('after', `\nRun clooks --version to print the version (v${VERSION}).`)
```

Key details:

- **`{ from: 'user' }`** — `program.parseAsync(args, { from: 'user' })` tells Commander the args are pre-sliced (no `node` or script path prefix). Required for Bun compiled binaries where `process.argv[0]` is `"bun"` and `process.argv[1]` is a virtual path.
- **`exitOverride()`** — Prevents Commander from calling `process.exit()` directly. Instead it throws `CommanderError`, which `runCLI()` catches and translates to the appropriate exit code.
- **Version not registered** — Commander does not register `.version()`. Version is handled in `cli.ts` fast path to avoid ambiguity (see Dual-Mode Dispatch above).

### runCLI error handling

`runCLI(args)` wraps `parseAsync` in a try/catch that handles:

1. `CommanderError` — Exit with the error's exit code (0 for help, non-zero for parse errors).
2. `CancelError` — User cancelled a prompt. Exit 0 (the cancel message was already printed by `withCancel()` in `prompts.ts`).
3. Anything else — Re-throw. The global `uncaughtException` handler catches it and exits 2.

## OutputContext Pattern

The `--json` global flag flows through an `OutputContext` object:

```typescript
interface OutputContext { json: boolean }
```

Commands obtain it via `getCtx(cmd)` (defined in `src/tui/context.ts`), which reads `cmd.optsWithGlobals().json`. Commander passes `(options, cmd)` to every action handler, so `cmd` is always available.

All TUI output functions (`printIntro`, `printSuccess`, `printInfo`, `printWarning`, `printError`, `printOutro`) accept `OutputContext` as their first parameter and are JSON-mode aware. In JSON mode, `printError(ctx, command, message)` writes a `{"ok":false,...}` envelope to stdout and returns; in human mode it writes a styled error to stderr via `@clack/prompts`.

## Command Interface Pattern

Each command exports a factory function that returns a `Command`:

```typescript
export function createConfigCommand(): Command {
  return new Command('config')
    .description('Show resolved clooks configuration')
    .action(async (_opts, cmd) => {
      const ctx = getCtx(cmd)
      // ...
    })
}
```

The router registers commands via `program.addCommand(createConfigCommand())`.

## TUI Wrapper Contract

TUI primitives live in `src/tui/`. They wrap `@clack/prompts` with two guards:

### Non-interactive suppression

Two suppression mechanisms with different scope:

- **Prompt suppression** — `isNonInteractive(ctx)` in `prompts.ts` returns true when `ctx.json` is true OR `process.stdin.isTTY` is false. Prompts return their default value if one exists, or throw an error. The TTY guard is required because `@clack/prompts` does not check for TTY internally — prompts hang forever on piped stdin.
- **Output/spinner suppression** — `printIntro`, `printSuccess`, `printInfo`, `printWarning`, `printOutro`, and `withSpinner` check `ctx.json` only. They suppress when `--json` is active but NOT based on TTY state. `printError(ctx, command, message)` is JSON-mode aware: in JSON mode it writes a JSON error envelope to stdout; in human mode it writes a styled error to stderr. Commands do not need to manually branch on `ctx.json` for error output.

### Cancel handling

`withCancel(result)` checks the prompt result with `isCancel()` from `@clack/prompts`. On cancel, it prints a styled cancel message via `@clack/prompts`' `cancel()` function, then throws `CancelError`. The error bubbles up to `runCLI()` which exits 0 (the cancel message was already printed by `withCancel`).

Commands that need custom cleanup on cancellation can catch `CancelError` in their own try/catch before it reaches the router.

### `promptMultiSelect`

`promptMultiSelect(ctx, options)` wraps `@clack/prompts`' `multiselect()`. In non-interactive mode (`isNonInteractive(ctx)`), returns all options (full list as the default). Callers that need different non-interactive behavior (e.g., `clooks add` requiring `--all` in CI) must add their own guard before calling the picker.

## JSON Output Envelope

Commands that support `--json` write a single JSON line to stdout:

```typescript
interface JsonEnvelope {
  ok: boolean
  command: string
  data?: unknown
  error?: string
}
```

`jsonSuccess(command, data)` and `jsonError(command, error)` in `src/tui/json-envelope.ts` produce the serialized string.

## Command Reference

### Plugin Installer

The sibling marketplace owns `clooks/skills/setup/scripts/install.sh`, shared by
Claude `/clooks:setup` and Codex `$clooks:setup`. This is an installer-local helper,
not a new runtime command or resolver. Plugin startup never invokes it.

| Action | Behavior |
|--------|----------|
| `install` | Reuse executable PATH binary first, then managed `~/.local/bin/clooks`; download only when absent |
| `resolve` | Validate the selection and print only its absolute path to stdout; diagnostics go to stderr |
| `check` | Report selected binary/version and project config-file presence; missing/broken binaries return nonzero |
| `update` | Explicit checksum/version-validated managed replacement; refuse external PATH selections and managed symlinks |

Reuse validates `--version` and any explicit `CLOOKS_VERSION` pin without download
or shell-profile edits. A mismatch requires explicit update; broken selected
binaries do not silently fall back. Downloaded executables are validated before
atomic replacement from a temporary file on the destination filesystem, preserving
the previous binary on download/checksum/version failure. Fresh install retains
the existing shell-profile PATH setup; update does not edit profiles.

Skills call resolve, then invoke its exact quoted stdout path for version/init in
separate tool calls, stopping on failure. They do not rely on shell-variable
persistence or compound-command wrappers. Managed-only off-PATH selection warns:
absolute-path init may work while generated entrypoints cannot find `clooks`.
Child-shell exports/profile edits do not repair the running agent's PATH. Check
does not prove configuration validity or native activation. Global/both-agent
registration is never inferred from cwd.

### `clooks approve <token>`

Noninteractive registration of an existing short-lived Codex approval record. `src/commands/approve.ts` uses the standard command factory, OutputContext and JSON envelope; `router.ts` and `KNOWN_COMMANDS` register it for CLI dispatch. It never loads project configuration, issues a token, executes its target, consumes it or extends its fixed five-minute expiry. An agent shell call to this command remains subject to ordinary hooks; no engine bypass is added.

Lookup uses `${CLOOKS_HOME_ROOT ?? homedir()}/.clooks/approvals/codex.sqlite`, independent of cwd and `CODEX_HOME`, without searching alternate homes. Human success includes the original expiry as an ISO timestamp. JSON success is `{ ok: true, command: "approve", data: { token, acknowledgedAt, expiresAt } }`, with integer Unix-millisecond times. Repeated registration preserves both timestamps. Operation errors use `printError` and exit 1; missing arguments use Commander usage errors. No TTY or interactive prompt is required.

The Codex PreToolUse runtime now issues pending confirmations and resolves registered or inline acknowledgements. If the shell invocation registering A itself receives ask B, an approved inline retry can discharge B and then register A; it does not consume A or bypass explicit blocks. See [Codex Approvals](codex-approvals.md) for carrier eligibility, exact binding, lifecycle and passing compiled Docker coverage. The passing [15-case native suite](testing/codex-native.md#hybrid-approval-case-evidence) covers bounded shell and direct-patch approval workflows, including actual-pack `rm -r`, not forced-removal permission or full conformance.

### `clooks init` / `clooks init --global`

Project setup command. Creates `.clooks/` directory, writes default `clooks.yml`, generates the bash entrypoint, and registers it with the selected agent hook system.

Agent routing is explicit through `--agent claude-code`, `--agent codex`, or `--agent all`. Omitting `--agent` is equivalent to `--agent claude-code` for backward compatibility: project init writes `.claude/settings.json`, and global init writes `~/.claude/settings.json`.

`--agent codex` still creates the shared `.clooks/` runtime files, but registers project `.codex/hooks.json` or the effective global Codex home's `hooks.json` instead of Claude settings. Global init and uninstall resolve a nonempty `CODEX_HOME`, otherwise `HOME/.codex`. Overrides must be absolute and contain no CR/LF; resolution uses physical directory identity, including the nearest existing ancestor of a missing directory, without creating it. Project registration ignores `CODEX_HOME`. `CLOOKS_HOME_ROOT` remains a runtime override and never selects an installation location. Codex registration writes one Clooks command hook per supported registration event and warns that Codex may require hook review/trust before project hooks run. `--agent all` performs shared setup once, then registers both agents. Global Codex output uses the actual resolved registration path, including created/updated/skipped JSON strings.

With `--global`, operates on `HOME/.clooks/`: creates the home directory structure, writes global `clooks.yml`, generates an executable global entrypoint, and registers the selected global agent files. Claude Code publishes its legacy `.global-entrypoint-active` flag only after successful Claude registration. Codex publishes a versioned `.global-entrypoint-active.codex` receipt only after successful Codex registration and executable launcher creation. The receipt records the physical installation and Codex homes plus POSIX `cksum` of committed registration bytes; it detects stale registration, not native hook activation.

Before any Codex/all global init writes, read-only preflight validates the effective home and both persisted identities. Invalid, conflicting, or different-home records abort before shared types/schema/launcher or Claude writes. An empty legacy Codex flag identifies the default home and must be unhooked before switching to a custom home. After preflight, init atomically persists `.codex-registration-home`, a separate single-home recovery record, then retires any old Codex receipt before repairing shared runtime files. This prevents launcher repair from making old suppression newly eligible when later registration fails. Recovery-write failure leaves the old receipt untouched; retirement failure aborts before launcher repair. Later setup, registration, checksum, or publication failure retains cleanup identity without a newly eligible receipt. Same-home retry republishes success; another home cannot overwrite that cleanup identity. Successful earlier Claude registration in an all-agent attempt remains committed on later Codex failure.

The recovery record never suppresses project execution. Newly generated project scripts require a matching, fresh receipt and usable global launcher; legacy empty Codex flags are insufficient. Existing project scripts require project re-init to obtain these checks. Receipt freshness cannot establish that native Codex hooks are enabled, reviewed, or firing. External activation and Codex runtime implementation remain separate concerns.

Claude-only global init remains independent: it neither reads nor retires Codex state, and ignores `CODEX_HOME`. Because the launcher is shared, its repair can restore the eligibility of an existing valid Codex receipt even if Claude registration subsequently fails. This is an explicit exception to the selected Codex/all failure behavior above, not evidence of Codex registration or native activation during a Claude-only attempt.

Both registrars reject invalid nonempty JSON roots, hook maps, managed-event arrays, and traversed group/hook containers with a path/field-specific error and repair-and-retry guidance. Rejection leaves registration bytes unchanged. Missing containers and empty or whitespace files remain valid initialization inputs. Unknown fields and untraversed event values are preserved as JSON values. Detection and uninstall counters use the shared strict reader across all events, so ambiguous unknown-event containers produce errors rather than an absence result. Normal unhook only removes owned hooks from the existing supported event catalog.

Registration writes use `src/registration-file.ts`: an exclusive temporary file in the destination directory is created with initial access permissions no broader than the existing destination, before any bytes are written. After writing, existing permission bits are restored and the closed file is renamed over the destination. New destinations use ordinary `0666` permissions filtered by the process umask. Failed writes preserve the previous destination and clean up only the attempt's own temporary file, best effort. Reads and writes reject symlink destinations, including dangling links, and other nonregular files. No-op registration and unhook preserve exact file bytes. Successful changes may reformat JSON. This guarantees atomic visibility per file, not power-loss durability, concurrent-writer merging, or a transaction across both agents.

Ownership requires a command hook and a bounded generated command form. Codex project init creates or retains the committed `.clooks/bin/codex-project-id` marker and registers a fixed locator with that ID; Claude-only/global init creates no project marker. The locator searches registration identity, not configuration, and passes its located root to existing core discovery unless an explicit override exists. See [Bash Entrypoint](bash-entrypoint.md#hook-registration) for boundaries and ambiguous-copy diagnostics. Codex recognition accepts only the exact new project form and the supported quoted global command, with no compatibility parser for unreleased absolute project commands. Init converges owned duplicates within a registration file into one canonical command per event, preserving unrelated hooks, empty unrelated groups, and metadata on surviving mixed groups. Options on removed owned hooks or owned-only groups are not retained by that canonicalization. Claude retains its existing registration migration behavior and removes individual owned hooks during unhook. Its detector accepts the project variable form, legacy relative form, shell-safe absolute paths, and an exact context-supplied command for historical unquoted global paths containing spaces or punctuation. Generic shell mentions and extra arguments are not ownership evidence. CLI selectors, result arrays, and legacy Claude JSON count aliases are unchanged.

### `clooks config` / `clooks config --resolved`

Shows the resolved clooks configuration. In default mode, displays hook count, timeout, onError, and maxFailures.

With `--resolved`, outputs the fully merged config with **provenance annotations** — showing each value's source layer (home/project/local) and file path. This is useful for debugging three-layer config merge behavior. Supports `--json` for structured output.

The resolved command loads all three config files independently (does not reuse `loadConfig()`) to track per-value provenance. It also performs a live `existsSync()` check on each hook's source file — hooks whose files are missing are tagged `(dangling)` in human output and include `"dangling": true` / `"status": "dangling"` in JSON output. Shadowed hooks are not checked (they are inactive).

### `clooks types` / `clooks types --global`

Extracts the embedded `.d.ts` type declarations to `.clooks/hooks/types.d.ts`. The file provides `ClooksHook`, all 22 event context types, all result types, and config generics — giving hook authors full IntelliSense without npm or package.json.

Always overwrites unconditionally (no version check). With `--global`, writes to `~/.clooks/hooks/types.d.ts` instead. Supports `--json` for structured output.

### `clooks add <url>`

Installs hooks from GitHub and registers them in the project. Accepts two URL forms:

- **Blob URL** (`https://github.com/<owner>/<repo>/blob/<ref>/<filename>`) — single-file install. Only `.ts` and `.js` files are accepted.
- **Repo URL** (`https://github.com/<owner>/<repo>`) — multi-hook pack install. Fetches `clooks-pack.json` manifest, presents a TUI multi-select picker, downloads selected hooks.

**Flags:** `--all` (install all pack hooks without prompting), `--global` (install to `~/.clooks/`), `--project` (install to project `.clooks/`, default).

**Blob URL pipeline:**

1. Parse via `parseGitHubBlobUrl()` — extracts `owner`, `repo`, `ref`, `filename`, `filenameStem`.
2. Load config via `loadConfig(scope.root)` — verifies `clooks init` has been run.
3. Check for name conflicts — exits with error if the stem already exists in `clooks.yml`.
4. Fetch raw file from `raw.githubusercontent.com`.
5. Write to `.clooks/vendor/github.com/<owner>/<repo>/<filename>`.
6. Validate via `validateHookExport()` — deletes file on failure.
7. Append hook entry to `clooks.yml` with short address `uses:` value (`owner/repo:hook-name`).

**Repo URL (pack) pipeline:**

1. Detect repo URL via `isGitHubRepoUrl()`.
2. Fetch `clooks-pack.json` manifest from `raw.githubusercontent.com/<owner>/<repo>/HEAD/clooks-pack.json`.
3. Validate manifest via `validateManifest()` in `src/manifest.ts`.
4. Non-interactive guard: if stdin is not a TTY and `--all` is not set, list available hooks and exit 0.
5. Present `promptMultiSelect` picker (or select all if `--all`).
6. For each selected hook: fetch, write, validate (soft — warns but continues on failure), register.
7. Append each installed hook to `clooks.yml` with short address `uses:` value.

**Error cases:** invalid/unrecognized URL, unsupported file extension, not initialized, HTTP 404, fetch failure, manifest missing or invalid, all hooks skipped due to conflicts.

**TUI output:** spinner during fetch, multi-select picker for packs, per-hook success/warning messages, outro with summary.

**`--json` support:** On success, `{ ok: true, command: "add", data: { name, address, url } }` (blob) or `{ ok: true, command: "add", data: { installed: string[] } }` (pack). On error, `{ ok: false, command: "add", error: "<message>" }`.

### `clooks new-hook`

Interactive scaffolding command. Prompts for a hook name (kebab-case validated) and scope (project/global), then generates a ready-to-edit `.ts` hook file with the correct `import type { ClooksHook } from './types'` and a typed `ClooksHook<Config>` export.

Refuses to overwrite an existing file (safe by default). Does NOT auto-register the hook in `clooks.yml` — users must add it manually. Supports `--name` and `--json` flags for non-interactive use.

### `clooks update plugin:<pack-name>`

Re-vendors hooks from the plugin cache for a specific pack. Overwrites existing vendor files with updated content from the cache. New hooks (added in the plugin update) are validated and registered. Existing config entries are never modified — only new entries are appended.

Discovery queries both Claude and Codex by default, independently of `CLOOKS_AGENT`; `--agent claude-code|codex` filters the source provider. Every matching manifest and referenced file is preflighted before writes/imports. Equivalent sources coalesce by physical vendor destination, including aliases and missing descendants of existing prefixes. Project/local config destinations remain separate. Manifest or byte disagreement and missing source files fail without modifying any destination. Filtering does not resolve conflicting marketplaces within one provider; those must be disabled explicitly.

The existing fourth discovery-function argument to `updatePluginPack()` remains an isolated Claude-only injection. The options form accepts optional discovery functions and explicit Codex home; missing injected dependencies never fall back to defaults. `createUpdateCommand()` accepts optional discovery dependencies alongside its existing root resolver. No provenance database or agent-process lookup is involved.

Exits with code 1 when all hooks fail (errors only, no successes). Supports `--json` for structured output.

See `docs/domain/vendoring/plugin-vendoring.md` for the full update algorithm.

### `clooks test <hook-file>` / `clooks test example <Event>`

One-shot hook author harness. Runs a single hook handler against a synthetic event payload and prints the decision JSON to stdout, with an exit code mapped from the decision's `result` tag.

Two subcommand forms with deliberately different output contracts:

- **`clooks test <hook-file>`** — reads a JSON payload from stdin (or `--input <file>`), dispatches the matching per-event handler from the hook file, and writes the handler's return value as a single JSON line to stdout. `hookConfig` defaults to `meta.config`; `--config <path>` / `--config-json '<json>'` (mutually exclusive) override it, and `--hook-name <alias>` disambiguates entry resolution under `--config`. Output is **valid JSON** — pipe to `jq`. Input contract is the **cleaned-up `Context` shape** (the type hooks program against), not Claude Code's wire shape; the harness skips wire normalization and the multi-hook reducer.
- **`clooks test example <Event>`** — prints prose-and-JSON documentation for the named event: a minimum-viable JSON fixture block, the required-fields list, and (for the four tool-keyed events) inline documentation of all 10 built-in tools' `toolInput` shapes plus a fallback note for `ExitPlanMode` and `mcp__*` tools. Output is **documentation, not parseable JSON** — authors copy-paste the JSON block; do **not** pipe to `jq`.

**Exit codes for `clooks test <hook>`:** `allow`/`skip`/`success`/`continue`/`retry`/`ask`/`defer` and `undefined` return → 0; `block`/`failure`/`stop` → 1; hook throws or harness usage error → 2. `clooks test example` always exits 0 on a known event, 2 on unknown.

**`--config` and `--config-json`** are mutually exclusive and both shallow-merge their override over `meta.config` defaults — same shape as production's `loadHook` (`src/loader.ts:144-146`). Full contract (entry resolution, `--hook-name`, `enabled: false` behavior) lives in [testing/hook-author-testing.md](testing/hook-author-testing.md#hookconfig--overriding-via---config----config-json). **No `--tool` flag** for `clooks test example` — tool-keyed events inline all 10 tools' `toolInput` shapes in one document.

Routing: `clooks test` is registered in `KNOWN_COMMANDS` so the dual-mode dispatcher routes it to CLI mode; `example` is wired as a true sub-`Command` via `testCmd.addCommand(exampleCmd)`. Hook author guide: [testing/hook-author-testing.md](testing/hook-author-testing.md).

### `clooks uninstall`

Removes Clooks from a project or global scope. An explicit `--agent claude-code`, `--agent codex`, or `--agent all` selects registrations without detecting unrelated providers. Without `--agent`, the command inspects the chosen scope: one registered provider is selected automatically; both offer an interactive Claude Code/Codex/both picker. Both providers with `--force` or noninteractive input require explicit `--agent`; force confirms actions, never selects an agent. Global detection uses only the effective `CODEX_HOME` (or `HOME/.codex`), not other recorded homes. Agent selection does not depend on `CLOOKS_AGENT`.

When neither provider is registered, automatic selection reports no registrations without offering deletion or clearing stale flags. Explicit `--full` still permits orphan `.clooks/` cleanup through the existing all-reference checks. Explicit provider selection retains stale-global-flag cleanup. Explicit `--unhook` confirms registration removal but never offers directory deletion; `--unhook` and `--full` are mutually exclusive in both interactive and forced use. Without `--unhook`, the existing interactive deletion confirmations remain in place.

With `--project --unhook`, the command removes Clooks-owned registrations for the selected agent from `.claude/settings.json`, `.codex/hooks.json`, or both, while preserving unrelated hooks. With `--global --unhook`, it does the same for `HOME/.claude/settings.json` and the effective Codex home's `hooks.json`. Codex state clears only for the matching home after an all-event remaining-reference check. Unhooking home B neither edits recorded home A nor erases A's receipt/recovery identity. Unknown-event references retain identity and block switching until explicitly repaired; a missing registration file allows matching state cleanup.

Cleanup scope follows the final deletion decision, whether supplied by `--full --force` or an interactive answer. Before deleting the shared `.clooks/` directory, the command inspects both agents and requires cleanup of all owned references. Interactive deletion asks for additional all-agent consent when another agent was not selected or an earlier unhook was declined. Declining or cancelling that required confirmation leaves all registrations and runtime files in that scope unchanged, including any earlier approved unhook. After agent selection is resolved, `--full --force` authorizes all-reference cleanup within the explicit project/global scope.

Global full deletion includes distinct effective and recorded Codex homes, with an empty legacy flag contributing the default home. Malformed/unreadable state and conflicting identities block cleanup before writes. The global additional-consent prompt names Claude's settings path and every known Codex hooks path. Prior consent to selected home B does not authorize recorded home A, even with the same Codex selector. This is a bounded set, not a directory scan or many-home registry; older unrecorded homes need explicit unhook with their own `CODEX_HOME`.

All registration files needed for an action are preflighted before writes. Invalid other-agent data blocks full deletion, but does not block independent selected-agent unhook. Owned commands on unsupported events block deletion with their file path and event names; uninstall does not expand the supported event catalog to remove them. A second all-event inspection immediately before directory deletion rejects remaining references, including ones introduced during cleanup. These checks do not provide a transaction against concurrent external writers.

Cleanup commits one registration file at a time. Each successful global unregister is followed by removal of its corresponding dedup flag, including stale selected flags whose registration file is absent. A later unregister or flag-removal failure returns an error and retains the shared runtime and custom hooks; earlier successful cleanup remains committed and retry is safe. Preserved-group counts are computed for every action agent, even when it had only unrelated hooks or stale flags. Unselected-agent counts remain zero.

Without a scope flag, uninstall presents an interactive scope picker (project, global, or both). Choosing both executes project scope first, then global scope, resolving omitted agents independently in each scope. Decisions and cancellation are scoped to the current operation: completed project cleanup is not rolled back when global cleanup is declined or cancelled. No-change messages identify the scope or root to avoid implying cross-scope rollback. `--force` skips all confirmation prompts and requires explicit scope (`--project`/`--global`) and action (`--unhook`/`--full`) flags. Noninteractive use still requires force and explicit scope/action. `--json` outputs a structured result envelope with legacy Claude fields plus separate Claude/Codex counts. Its `agent` and `agents` fields report the explicit or detected selection, even when deletion requires both agents; no detected registration is `agent: null`, `agents: []`. Per-agent counts report the actual action. Never loads or validates `clooks.yml` — works even when config is broken.

For JSON compatibility, `eventsRemoved` and `nonClooksPreserved` remain Claude Code aliases. Agent-aware callers should read `claudeEventsRemoved`, `codexEventsRemoved`, `claudeNonClooksPreserved`, and `codexNonClooksPreserved`. Multi-home Codex cleanup unions removed event names in registration-catalog order and sums preserved groups across distinct files; human output names each changed path. For example, `clooks uninstall --agent codex --json` reports Codex removals in `codexEventsRemoved`; `eventsRemoved` stays empty unless Claude registrations were also removed.

## Key Files

- `src/cli.ts` — Dual-mode dispatch, signal handlers, version check.
- `src/known-commands.ts` — `KNOWN_COMMANDS` set.
- `src/router.ts` — Commander program, `runCLI()`, global flags.
- `src/commands/config.ts` — `createConfigCommand()` — config display and `--resolved` provenance.
- `src/commands/init.ts` — `createInitCommand()` — project and global setup (`clooks init`, `clooks init --global`).
- `src/settings.ts` — Settings.json management utility (register/unregister Clooks in `.claude/settings.json`).
- `src/agents/codex/settings.ts` — Codex command builders and hooks.json registrar.
- `src/registration-file.ts` — Shared validated registration reads and atomic file replacement.
- `src/registration-state.ts` — Codex receipt/recovery identity parsing, atomic publication and matching-home state cleanup.
- `src/commands/types.ts` — `createTypesCommand()` — extracts embedded .d.ts type declarations (`clooks types`, `clooks types --global`).
- `src/commands/new-hook.ts` — `createNewHookCommand()` — interactive hook scaffolding (`clooks new-hook`).
- `src/commands/add.ts` — `createAddCommand()` — GitHub URL download and registration (`clooks add`), both blob URL and repo URL flows.
- `src/commands/uninstall.ts` — `createUninstallCommand()` — project and global uninstall (`clooks uninstall`).
- `src/commands/update.ts` — `createUpdateCommand()` — re-vendor plugin hooks (`clooks update plugin:<pack>`).
- `src/commands/test.ts` — `createTestCommand()` and `runHarness()` — one-shot hook harness (`clooks test <hook-file>` and `clooks test example <Event>`).
- `src/examples/index.ts` — text-imported example payloads for all 22 events plus per-event required-fields metadata; consumed by `src/commands/test/render-example.ts`.
- `src/manifest.ts` — `validateManifest()`, `ClooksPackManifest` type — pack manifest validation.
- `src/platform.ts` — platform/scope helpers used by `clooks add` (`--global`/`--project`).
- `src/tui/context.ts` — `OutputContext` type and `getCtx(cmd)` helper.
- `src/tui/json-envelope.ts` — `JsonEnvelope` type, `jsonSuccess()`, `jsonError()`.
- `src/tui/prompts.ts` — `CancelError`, `withCancel`, `promptText`, `promptSelect`, `promptConfirm`, `promptMultiSelect`.
- `src/tui/output.ts` — `@clack/prompts` log wrappers with JSON suppression.
- `src/tui/spinner.ts` — `withSpinner` wrapper with JSON suppression.
- `src/cli.test.ts` — KNOWN_COMMANDS sync test.

## Gotchas

- **KNOWN_COMMANDS must match router commands.** If you add a command to the router, add the name to `KNOWN_COMMANDS` too (or vice versa). The test in `cli.test.ts` catches desync.
- **Bun compiled binary argv.** Commander must parse with `{ from: 'user' }` because Bun sets `process.argv[0]` to `"bun"` and `process.argv[1]` to a virtual `/$bunfs/root/` path. The `from: 'user'` option tells Commander the args are already sliced.
- **Commander `exitOverride()`.** Without this, Commander calls `process.exit()` on `--help` and parse errors, bypassing our error handling. With it, Commander throws `CommanderError` which `runCLI()` catches.
- **`@clack/prompts` cancel symbol.** The cancel value is `Symbol("clack:cancel")` (a unique symbol), NOT `Symbol.for("clack:cancel")` (a global symbol). Direct comparison (`=== Symbol.for(...)`) silently fails. Always use the `isCancel()` function.
- **`@clack/prompts` no TTY check.** Prompts hang forever on non-TTY stdin. The TUI wrappers in `src/tui/prompts.ts` guard against this with `isNonInteractive()`.
- **Spinner SIGINT handler.** `@clack/prompts` spinner installs its own `process.on('SIGINT')` handler that calls `process.exit(0)`. This coexists safely in CLI mode (our handler also exits 0), but be aware it exists.

## Related

- `docs/domain/bun-runtime.md` — Compile targets, performance, binary virtual filesystem
- `docs/domain/config.md` — Config parsing consumed by the `config` command
