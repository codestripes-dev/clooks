# CLI Architecture

How the clooks binary dispatches between hook engine mode and interactive CLI mode, and the patterns used by commands, TUI wrappers, and JSON output.

## Dual-Mode Dispatch

`src/cli.ts` is the compiled binary's entrypoint. It serves two roles from a single executable:

1. **Engine mode** — Claude Code pipes a JSON event on stdin with no arguments. The engine runs hooks and writes a JSON response to stdout.
2. **CLI mode** — A developer types a subcommand (e.g., `clooks config`). Commander.js parses arguments and runs the command's action handler.

### Dispatch logic

The dispatch reads `process.argv.slice(2)` and applies these rules in order:

1. **Version check** — If args include `--version` or `-v`, print `clooks <VERSION>` and exit 0. This fires before any other logic, so `clooks -v config` prints the version (not the config). Version is handled here, not in Commander, to avoid ambiguity with subcommand flags.
2. **First positional scan** — Find the first arg that does not start with `-`. This handles global flags before the subcommand (e.g., `clooks --json config` finds `config`, not `--json`).
3. **Known subcommand** — If the first positional is in `KNOWN_COMMANDS`, set `currentMode = 'cli'`, dynamic-import `router.ts`, and call `runCLI(args)`.
4. **Has args but no known subcommand** — Same as above. Covers `--help`, misspelled subcommands, and unknown flags. Commander handles the error/help display.
5. **No args, piped stdin** (`!process.stdin.isTTY`) — Engine mode. Call `runEngine()`.
6. **No args, TTY stdin** — CLI mode. Call `runCLI(args)` with empty args, which triggers Commander's help output.

### KNOWN_COMMANDS

`src/known-commands.ts` exports a `Set<string>` of recognized subcommand names. This set exists so `cli.ts` can detect subcommands without importing Commander.js (keeping engine mode fast — no Commander overhead).

The set must stay in sync with the commands registered in `router.ts`. This is enforced by a test in `cli.test.ts` that imports both and asserts equality.

## Mode-Aware Signal Handlers

`cli.ts` installs global handlers for `SIGINT`, `SIGTERM`, `uncaughtException`, and `unhandledRejection` before any dispatch logic runs. The signal handlers branch on `currentMode`:

- **Engine mode** (`currentMode === 'engine'`) — Write a diagnostic to stderr and exit with code 2 (`EXIT_STDERR`). This is fail-closed: a killed hook process blocks the action rather than silently passing.
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

The router registers commands via `program.addCommand(createConfigCommand())`. Stub commands (not yet implemented) use a shared `createStub(name, description)` factory in `src/commands/stubs.ts` that prints a "not yet implemented" message and exits 1.

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

### `clooks init` / `clooks init --global`

Project setup command. Creates `.clooks/` directory, writes default `clooks.yml`, generates the bash entrypoint, and registers it in `.claude/settings.json`.

With `--global`, operates on `~/.clooks/` instead: creates the home directory structure, writes a global `clooks.yml`, generates a global entrypoint, registers it in `~/.claude/settings.json`, and creates the `.global-entrypoint-active` flag file for entrypoint dedup.

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

Exits with code 1 when all hooks fail (errors only, no successes). Supports `--json` for structured output.

See `docs/domain/vendoring/plugin-vendoring.md` for the full update algorithm.

### `clooks uninstall`

Removes Clooks from a project or global scope. With `--project`, removes Clooks hooks from `.claude/settings.json` and optionally deletes `.clooks/`. With `--global`, does the same for `~/.claude/settings.json` and `~/.clooks/`. Without a flag, presents an interactive scope picker (project, global, or both). `--force` skips all confirmation prompts and requires explicit scope (`--project`/`--global`) and action (`--unhook`/`--full`) flags. `--json` outputs a structured result envelope. Never loads or validates `clooks.yml` — works even when config is broken.

## Key Files

- `src/cli.ts` — Dual-mode dispatch, signal handlers, version check.
- `src/known-commands.ts` — `KNOWN_COMMANDS` set.
- `src/router.ts` — Commander program, `runCLI()`, global flags.
- `src/commands/config.ts` — `createConfigCommand()` — config display and `--resolved` provenance.
- `src/commands/init.ts` — `createInitCommand()` — project and global setup (`clooks init`, `clooks init --global`).
- `src/settings.ts` — Settings.json management utility (register/unregister Clooks in `.claude/settings.json`).
- `src/commands/types.ts` — `createTypesCommand()` — extracts embedded .d.ts type declarations (`clooks types`, `clooks types --global`).
- `src/commands/new-hook.ts` — `createNewHookCommand()` — interactive hook scaffolding (`clooks new-hook`).
- `src/commands/add.ts` — `createAddCommand()` — GitHub URL download and registration (`clooks add`), both blob URL and repo URL flows.
- `src/commands/uninstall.ts` — `createUninstallCommand()` — project and global uninstall (`clooks uninstall`).
- `src/commands/update.ts` — `createUpdateCommand()` — re-vendor plugin hooks (`clooks update plugin:<pack>`).
- `src/manifest.ts` — `validateManifest()`, `ClooksPackManifest` type — pack manifest validation.
- `src/platform.ts` — platform/scope helpers used by `clooks add` (`--global`/`--project`).
- `src/commands/stubs.ts` — `registerStubs()` — placeholder commands for register, test.
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
- `docs/planned/FEAT-0026-interactive-tui-framework.md` — Feature specification with all design decisions (D1-D14)
