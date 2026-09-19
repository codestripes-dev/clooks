# CLI Architecture — Command Framework

Commander.js setup and error handling, the `OutputContext`/JSON-mode pattern, the command factory-function contract, the TUI wrapper guards, and the JSON output envelope. Part of [CLI Architecture](../cli-architecture.md).

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
- **Version not registered** — Commander does not register `.version()`. Version is handled in `cli.ts` fast path to avoid ambiguity (see Mode Dispatch above).

### runCLI error handling

`runCLI(args)` wraps `parseAsync` in a try/catch. The ordinary CLI rules below
are unchanged. In MCP mode, Commander errors set
the exit code and return; other failures propagate to MCP-aware entrypoint
cleanup rather than using the interactive cancellation path.

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

## Related

- [CLI Architecture](../cli-architecture.md) — parent overview and key files
- [Engine Mode & Dispatch](./dispatch.md)
- [Setup Commands](./commands-setup.md) — `init`, `config`, `types`, plugin installer
- [Hook & Lifecycle Commands](./commands-hooks.md) — `add`, `new-hook`, `update`, `test`, `uninstall`
