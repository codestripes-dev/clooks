# Bun Runtime

Reference document for Bun as Clooks' runtime, covering compile targets, performance characteristics, and known gotchas. Verified March 2026.

## Overview

Clooks uses Bun as its runtime — both for the compiled CLI binary and for executing TypeScript hook scripts. Bun was chosen for its fast startup, native TypeScript support, and npm compatibility. Anthropic acquired Bun in December 2025.

## Key Files

Once Clooks is built, the main binary is a compiled Bun executable at `~/.clooks/versions/{version}/clooks`.

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

| Mode | Time | Notes |
|------|------|-------|
| `bun run script.ts` | ~33ms | Parses file each invocation |
| `bun build --compile` binary | ~15ms | Pre-compiled, no parse overhead. **This is warm cache only.** |
| Cold start (first invocation after boot) | 100-300ms | OS must page in 50-90MB binary. Subsequent invocations are warm. |

For Clooks, the realistic expectation:
- **First hook invocation of a session:** 100-300ms (cold start)
- **Subsequent invocations:** ~15ms (binary already in page cache)
- **No hooks match this event (fast exit):** ~15ms (read config, no matches, exit)

### Binary Size

Each compiled Bun executable embeds the entire Bun runtime:

- **Per-platform binary:** ~50-90MB
- **5 platform targets:** ~250-450MB total release artifacts
- **Per-user disk usage:** One version = 50-90MB. Multiple versions in `~/.clooks/versions/` accumulate. Need a garbage collection strategy (deferred: Q10).

### Comparison to Other Runtimes

| Runtime | Startup | Native TS | Ecosystem | Why not chosen |
|---------|---------|-----------|-----------|---------------|
| **Bun** | ~15ms (warm) | Yes | npm-compatible | **Chosen** |
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

### Windows Stability

Multiple reported issues:
- DLL initialization failures
- "Bun in bun" not working (subprocess spawning from compiled binary)
- Windows Server compatibility problems (works on Windows 11 but not Server)

This is why Windows is deferred for v1.

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
- Hook scripts (`.ts` files) can be loaded and executed directly by the compiled Clooks binary
- No `tsc` or `ts-node` dependency
- Import resolution works as expected (ESM imports, npm packages)

### Hook Testing with Bun

Bun includes a built-in test runner (`bun test`). Hook test files (`.test.ts`) can use it directly:
```typescript
import { test, expect } from "bun:test"
```

This aligns with Clooks' first-class testing requirement (D9).

## Related

- [PRODUCT_EXPLORATION.md](../../PRODUCT_EXPLORATION.md) — Architecture decisions (D1: Bun as runtime)
- [claude-code-hooks.md](./claude-code-hooks.md) — The hook system Clooks builds on
