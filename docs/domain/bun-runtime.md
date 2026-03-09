# Bun Runtime

Reference document for Bun as Clooks' runtime, covering compile targets, performance characteristics, and known gotchas. Verified March 2026.

## Overview

Clooks uses Bun as its runtime — both for the compiled CLI binary and for executing TypeScript hook scripts. Bun was chosen for its fast startup, native TypeScript support, and npm compatibility. Anthropic acquired Bun in December 2025.

## Key Files

- `src/cli.ts` — Build entrypoint for the compiled binary. This is the file passed to `bun build --compile`. Implements dual-mode dispatch: if a recognized subcommand is present in argv, delegates to the CLI router (`src/router.ts`) for interactive commands; if stdin is piped with no subcommand, delegates to the hook execution engine (`src/engine.ts`); if stdin is a TTY with no subcommand, shows help. See `docs/domain/cli-architecture.md` for the full dispatch logic.
- `src/router.ts` — Commander.js program setup, global flags, subcommand registration. Loaded via dynamic import only in CLI mode.
- `src/engine.ts` — Hook execution engine. Reads stdin JSON, loads hooks from config, matches events against handlers, executes matching hooks with circuit breaker logic, and writes the response to stdout. Uses fail-closed error handling (exit code 2 on any failure), with circuit breaker degradation for repeatedly failing hooks (see `docs/domain/config.md` § Circuit Breaker).
- `src/index.ts` — Module root. Exports the `VERSION` constant.
- `dist/clooks` — Compiled binary output (gitignored). Produced by `bun run build`.
- `package.json` — Build script: `mkdir -p dist && bun build --compile --outfile dist/clooks src/cli.ts`.

## Compile Targets

Bun supports cross-compilation from any host via `bun build --compile --target <target>`.

### Clooks v1 Targets

| Target | Platform | Notes |
|--------|----------|-------|
| `bun-darwin-arm64` | macOS Apple Silicon | Primary Mac target |
| `bun-darwin-x64` | macOS Intel | Secondary Mac target |
| `bun-linux-x64` | Linux Intel/AMD (modern) | Alias for `bun-linux-x64-modern`. Requires AVX2 (Haswell 2013+). |
| `bun-linux-x64-baseline` | Linux Intel/AMD (older) | Only requires SSE4.2 (Nehalem 2008+). Ship this for broader compatibility. |
| `bun-linux-arm64` | Linux ARM64 | For ARM servers (AWS Graviton, etc.) |

### Deferred Targets

| Target | Platform | Why deferred |
|--------|----------|-------------|
| `bun-windows-x64` | Windows Intel/AMD | Known stability issues: DLL initialization failures, subprocess spawning problems, Windows Server incompatibility. |
| `bun-windows-arm64` | Windows ARM64 | Same Windows issues. |
| `bun-linux-x64-musl` | Alpine Linux x64 | Musl variant for Alpine/NixOS. Lower priority but may be needed. |
| `bun-linux-arm64-musl` | Alpine Linux ARM64 | Same. |

## Performance

### Startup Time

Measured on Bun 1.3.10, Linux x86_64 (WSL2), 20 runs each:

| Mode | Time | Notes |
|------|------|-------|
| `bun run script.ts` (interpreted) | **7ms median** | No meaningful difference from compiled |
| `bun build --compile` binary (hello world) | **7ms median** (min 6, max 9) | Compiled benefit is portability, not speed |
| `bun build --compile` binary (stdin JSON parse + output) | **8ms median** (min 7, max 9) | Real work adds ~1ms |
| Cold start (first invocation after boot) | 100-300ms (estimated) | OS must page in 59-100MB binary. Not measured directly. |

For Clooks, the realistic expectation:
- **First hook invocation of a session:** 100-300ms (cold start, estimated)
- **Subsequent invocations:** ~8ms (binary already in page cache)
- **No hooks match this event (fast exit):** ~8ms (read config, no matches, exit)

### Compilation Speed

| Scenario | Time | Notes |
|----------|------|-------|
| First compile (downloads target baseline) | ~1s | One-time per target |
| Subsequent compile (1 module) | ~52ms | 1ms bundle + 51ms compile |
| Subsequent compile (2 modules) | ~155ms | 25ms bundle + 130ms compile |

### Binary Size

Each compiled Bun executable embeds the entire Bun runtime. User code adds negligible overhead. Measured on Bun 1.3.10:

| Target | Binary Size |
|--------|-------------|
| `bun-darwin-arm64` | 59MB |
| `bun-darwin-x64` | 63MB |
| `bun-linux-arm64` | 97MB |
| `bun-linux-x64` | 100MB |

macOS binaries are significantly smaller (~60MB vs ~100MB). Linux binaries include more bundled dependencies.

- **5 platform targets:** ~420MB total release artifacts
- **Per-user disk usage:** One version = 59-100MB depending on platform. Multiple versions in `~/.clooks/versions/` accumulate. Need a garbage collection strategy (deferred: Q10).

### Portability

Compiled binaries are fully self-contained. No Bun installation required on the target machine. Dynamic dependencies are minimal and standard:

- `libc`, `libpthread`, `libdl`, `libm` (Linux)
- Binary runs with an empty PATH — only the system linker and libc are needed

### Comparison to Other Runtimes

| Runtime | Startup | Native TS | Ecosystem | Why not chosen |
|---------|---------|-----------|-----------|---------------|
| **Bun** | ~8ms (warm, measured) | Yes | npm-compatible | **Chosen** |
| **Deno** | ~100ms | Yes | Own + npm compat | Slower startup |
| **Node.js** | ~150-200ms | No (needs build) | Massive | Too slow, no native TS |
| **QuickJS** | <1ms | No | Minimal | No TS, tiny ecosystem, "too obscure" |

## Gotchas

### Linux glibc Requirement

Bun requires glibc >= 2.29. Older distros fail with `GLIBC_2.29 not found`:

- **Affected:** RHEL 7, CentOS 7, Amazon Linux 2
- **Not affected:** Ubuntu 20.04+, Debian 11+, Fedora 30+, Amazon Linux 2023
- **Workaround:** The musl targets exist for Alpine but do NOT help with old-glibc distros

### Linux AVX2 Requirement

The default `bun-linux-x64-modern` requires AVX2 CPU instructions (Intel Haswell 2013+). Older CPUs or some VMs/cloud instances without AVX2 crash with `Illegal Instruction`.

**Mitigation:** Ship the `-baseline` variant alongside the modern variant. The install script should detect CPU capabilities or default to baseline.

### glibc 2.41 (Debian 13 Trixie)

A reported issue with glibc 2.41 causing module resolution failures in compiled Bun binaries. Observed with Claude Code's own Bun binary (issue #27243). Bleeding-edge distros may break things.

### WSL musl/glibc Confusion

`bunx` has a bug where it selects the wrong musl binary in glibc-based WSL environments. Relevant if Clooks ever uses `bunx` internally. Not a direct concern for compiled binaries.

### Compiled Binary Virtual Filesystem (`/$bunfs/root/`)

Compiled Bun binaries run from a virtual filesystem path (`/$bunfs/root/<entrypoint>`), not from their actual location on disk. This affects two things:

**1. npm module resolution breaks** for dynamically imported files. When a dynamically imported `.ts` hook does `import { parse } from "yaml"`, Bun's resolver walks up from `/$bunfs/root/` looking for `node_modules` — never reaching the real filesystem. This affects all bare specifiers (npm packages). It does NOT affect:
- Absolute filesystem path imports (`import("/abs/path/to/file.ts")`)
- Relative imports between hook files
- Modules bundled into the compiled binary at compile time

**Workaround:** Pre-bundle hooks with `bun build` at install time. See "Dynamic Import from Compiled Binary" under Patterns.

**2. Path identity APIs return virtual/compile-time paths.** The virtual filesystem causes several Node.js path identity APIs to return useless values:

| API | Returns | Usable? |
|-----|---------|---------|
| `process.cwd()` | Real working directory | **Yes** |
| `process.execPath` | Real binary path (resolves symlinks) | **Yes** |
| `process.argv[0]` | `"bun"` (always) | No |
| `process.argv[1]` | `/$bunfs/root/<entrypoint>` | No |
| `import.meta.dir` | `/$bunfs/root` | No |
| `import.meta.path` | `/$bunfs/root/<entrypoint>` | No |
| `__dirname` | **Compile-time** source directory | **Caution** — not runtime |
| `__filename` | **Compile-time** source file path | **Caution** — not runtime |
| `Bun.main` | `/$bunfs/root/<entrypoint>` | No |

**Standard filesystem I/O is unaffected.** `readFileSync`, `existsSync`, `readdirSync`, `statSync`, `Bun.file()`, and all `path` module functions (`resolve`, `join`, `relative`) operate on the real filesystem using the real CWD. Only `import.meta.*` and module resolution are virtualized.

### Windows Stability

Multiple reported issues:
- DLL initialization failures
- "Bun in bun" not working (subprocess spawning from compiled binary)
- Windows Server compatibility problems (works on Windows 11 but not Server)

This is why Windows is deferred for v1.

## Type Checking in Build

`bun build --compile` does not run TypeScript type checking — it bundles and compiles without verifying types. This means undeclared variables, type mismatches, and other TypeScript errors compile successfully but crash at runtime.

The project build script (`package.json` `build` command) runs `tsc --noEmit` before `bun build` to catch these errors:

    "build": "tsc --noEmit && mkdir -p dist && bun build --compile --outfile dist/clooks src/cli.ts"

This is a hard requirement. Never bypass `tsc --noEmit` in the build pipeline.

## Patterns

### Cross-Compilation in CI

Use `bun build --compile --target <target>` to cross-compile from any host. GoReleaser has native Bun builder support (`builder: bun` in `.goreleaser.yaml`).

Example build matrix:
```bash
bun build --compile --target bun-darwin-arm64 --outfile dist/clooks-darwin-arm64 src/cli.ts
bun build --compile --target bun-darwin-x64 --outfile dist/clooks-darwin-x64 src/cli.ts
bun build --compile --target bun-linux-x64-modern --outfile dist/clooks-linux-x64 src/cli.ts
bun build --compile --target bun-linux-x64-baseline --outfile dist/clooks-linux-x64-baseline src/cli.ts
bun build --compile --target bun-linux-arm64 --outfile dist/clooks-linux-arm64 src/cli.ts
```

### TypeScript Execution

Bun runs TypeScript natively — no transpile step needed. This means:
- Hook scripts (`.ts` files) can be loaded and executed directly by the compiled Clooks binary via dynamic `import()`
- No `tsc` or `ts-node` dependency
- No performance benefit to pre-compiling `.ts` to `.js` — Bun's transpiler adds zero measurable overhead

### Dynamic Import from Compiled Binary

The compiled Clooks binary dynamically imports user-authored `.ts` hook files at runtime. Key characteristics (verified on Bun 1.3.10):

**Performance:**
- Single hook import adds ~2ms over binary startup (~9ms total)
- Multiple hooks imported in parallel (`Promise.all`) cost the same as one (~9ms total)
- No `.ts` vs `.js` performance difference

**npm Dependency Resolution:**
- Bare specifiers (`import { parse } from "yaml"`) **do not work** from dynamically imported files. The compiled binary runs from a virtual filesystem (`/$bunfs/root/`), breaking Node-style `node_modules` resolution.
- `NODE_PATH` is ignored by the compiled binary's resolver.
- **Workaround:** Pre-bundle hooks with dependencies using `bun build hook.ts --outfile hook.bundled.js`. This resolves all deps at bundle time. Bundling is fast (~8ms per hook) and the output is self-contained.
- Bundled hooks with deps are slower to import (~18ms total for a 190KB bundle vs ~9ms for a simple hook) due to parsing more code.

**Export Validation:**
- TypeScript type assertions (`as ClooksHook`) provide zero runtime validation — types are erased.
- Runtime validation of the named `hook` export shape (`hook.meta.name` exists, non-`meta` properties are functions) is required in the loader (`src/loader.ts` → `validateHookExport()`).

### Config File Parsing

Bun provides built-in parsers for YAML, TOML, and JSONC — no external dependencies needed:

```typescript
// YAML — chosen for Clooks config (Bun.YAML.parse available since Bun v1.2.21)
const config = Bun.YAML.parse(await Bun.file("clooks.yml").text())

// TOML
const config = Bun.TOML.parse(readFileSync("clooks.toml", "utf-8"))

// JSONC — JSON with comments and trailing commas (since Bun v1.3.6)
const config = Bun.JSONC.parse(readFileSync("clooks.jsonc", "utf-8"))
```

**Clooks uses `Bun.YAML.parse`** — a native Zig parser built into the Bun runtime. Zero external dependencies, no caching needed.

**Performance for a realistic 10-hook config (cold start, compiled binary):**

| Parser | First Parse | End-to-End Binary | Dependencies |
|--------|-----------|------------------|-------------|
| JSON.parse | 0.023ms | 14ms | Built-in |
| Bun.TOML.parse | 0.068ms | 13ms | Built-in |
| Bun.JSONC.parse | 0.076ms | 15ms | Built-in |
| **Bun.YAML.parse** | **0.17ms** | **15ms** | **Built-in** |
| js-yaml | 2.4ms | 18ms | 2 bundled modules |
| yaml (npm) | 13ms | 30ms | 73 bundled modules |

`Bun.YAML.parse` is ~15x faster than js-yaml for cold-start parse and eliminates the only production dependency. No caching strategy is needed — the native parser matches TOML/JSONC performance. See `docs/research/yaml-parser-comparison.md` for the full comparison.

### Hook Testing with Bun

Bun includes a built-in test runner (`bun test`). Hook test files (`.test.ts`) can use it directly:
```typescript
import { test, expect } from "bun:test"
```

This aligns with Clooks' first-class testing requirement (D9).

## Related

- [PRODUCT_EXPLORATION.md](../../PRODUCT_EXPLORATION.md) — Architecture decisions (D1: Bun as runtime)
- [claude-code-hooks/overview.md](./claude-code-hooks/overview.md) — The hook system Clooks builds on
