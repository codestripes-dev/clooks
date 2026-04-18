# Domain Knowledge — Master Index

This is the catalog of all agent-facing knowledge in the Clooks repository. Start here to find what you need, then drill into specific docs.

## How This Knowledge Base Works

- **CLAUDE.md** (root) — universal entry point. Contains project overview and workflow instructions.
- **This index** (`docs/domain/index.md`) — master catalog of all domain knowledge docs. Read this to find what you need.
- **Domain docs** (this directory) — focused documents on domains, patterns, conventions, testing, and tools. Written for agent consumption.

All domain docs live under `docs/domain/`. Subdirectories are used for categories with multiple related docs (e.g., `docs/domain/patterns/backend.md`).

## Writing and Maintaining Domain Docs

### When to create a domain doc

Create a new domain doc when:
- A new concept, subsystem, or integration is introduced that other work will depend on.
- An ExecPlan's `Related Domain Knowledge Documents` section notes that a new doc is needed.
- Existing knowledge is scattered across plans and should be consolidated.

### Naming conventions

- Use lowercase kebab-case filenames: `hook-lifecycle.md`, `plugin-architecture.md`.
- For categories with multiple docs, use subdirectories: `docs/domain/patterns/backend.md`.

### Size limit

Domain docs must not exceed **300 lines**. When a doc approaches this limit, split it into focused sub-docs in a subdirectory and update this index. For example, a growing `hooks.md` becomes `hooks/lifecycle.md`, `hooks/registration.md`, etc.

### Template

Every domain doc should follow this structure:

```markdown
# <Topic>

Brief description of what this covers and why it matters.

## Overview

What this is, how it fits into the system, and the key concepts.

## Key Files

List the most important files by full repository-relative path.

## Patterns

How things are done in this area — conventions, naming, structure.

## Gotchas

Non-obvious behavior, common mistakes, things that have bitten people before.

## Related

Links to related domain docs, features, or plans.
```

Not every section is required — omit sections that don't apply. But `Overview` and `Key Files` should always be present.

### Updating the index

When creating or removing a domain doc, update the relevant table in this index. Keep entries sorted alphabetically within each section.

## Domain Knowledge

| Document | Path | Description |
|----------|------|-------------|
| Bash Entrypoint | `bash-entrypoint.md` | Entrypoint script behavior, binary location, fail-closed semantics, bypass, hook registration |
| Bun Runtime | `bun-runtime.md` | Compile targets, startup performance, binary sizes, platform gotchas |
| CLI Architecture | `cli-architecture.md` | Dual-mode dispatch, Commander.js setup, TUI wrappers, JSON output, command patterns |
| Config System | `config.md` | Config format, parsing, validation, merging, resolution rules |
| Claude Code Hooks — Overview | `claude-code-hooks/overview.md` | Configuration schema, 4 handler types, hook locations, environment variables |
| Claude Code Hooks — Events | `claude-code-hooks/events.md` | All 20 lifecycle events: matchers, input fields, decision control |
| Claude Code Hooks — I/O Contract | `claude-code-hooks/io-contract.md` | Exit codes, JSON output, decision patterns, tool_input schemas |
| Claude Code Hooks — Behavior & Gotchas | `claude-code-hooks/behavior-and-gotchas.md` | Execution model, async, session snapshot, known issues |
| Cross-Agent Hooks | `cross-agent-hooks.md` | Hook systems across Claude Code, Cursor, Windsurf, VS Code Copilot with event mapping |
| Global Hooks | `global-hooks.md` | User-wide hooks architecture: directory structure, config scoping, merge semantics, failure state, shadow warnings |
| Hook Type System | `hook-type-system.md` | ClooksHook contract, per-event context/result types, branded strings, file organization |
| Vendoring — Overview | `vendoring/overview.md` | Core vendoring concepts, vendor directory layout, formats, registration, V0 limitations |
| Vendoring — clooks add | `vendoring/clooks-add.md` | `clooks add` workflow (blob URL + repo URL), multi-hook packs, manifest format |
| Vendoring — Plugin Vendoring | `vendoring/plugin-vendoring.md` | Plugin cache discovery, plugin hook vendoring, scope-based routing |

## Patterns & Conventions

| Document | Path | Description |
|----------|------|-------------|

## Testing

| Document | Path | Description |
|----------|------|-------------|
| E2E Testing Architecture | `testing.md` | Three-layer strategy, hermetic E2E via `bun run test:e2e`, sandbox pattern, fail-closed invariant, gotchas |

## Tools & Recipes

| Document | Path | Description |
|----------|------|-------------|
| Tools | `tools.md` | Mise tool management, install vs use gotcha, shell activation |
