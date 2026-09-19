# CLI Architecture

How the clooks binary dispatches between hook engine, interactive CLI and MCP stdio modes, and the patterns used by commands, TUI wrappers, and JSON output.

This index points to focused sub-docs in `docs/domain/cli-architecture/`. The detailed material is split across files to stay under the 300-line per-file domain-doc cap.

## Sub-docs

| Document | Path | Topics |
|----------|------|--------|
| Engine Mode & Dispatch | `cli-architecture/dispatch.md` | Empty stdin handling, three-way mode dispatch, engine-mode run path, mode-aware signal handlers, MCP command |
| Command Framework | `cli-architecture/command-framework.md` | Commander.js setup, `runCLI` error handling, `OutputContext`/JSON-mode pattern, command factory pattern, TUI wrapper guards, JSON output envelope |
| Setup Commands | `cli-architecture/commands-setup.md` | Plugin installer, `clooks init` / `clooks init --global`, `clooks config`, `clooks types` |
| Hook & Lifecycle Commands | `cli-architecture/commands-hooks.md` | `clooks add`, `clooks new-hook`, `clooks update plugin:<pack>`, `clooks test`, `clooks uninstall` |

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
