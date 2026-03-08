# Clooks

A **hook runtime for AI coding agents**. Standalone CLI tool (not a plugin). Starting with Claude Code, with cross-agent support planned for Cursor, Windsurf, and VS Code Copilot.

## What Clooks Does

Clooks sits between the native hook system and user-defined hook scripts. It provides a TypeScript programming model, a package ecosystem, and zero-config bootstrapping. Users write hooks as TypeScript files with typed contracts — never raw bash in JSON config.

**Flow:** Bash entrypoint (in `.claude/settings.json`) → Compiled Bun binary (~15ms) → Reads `.clooks/clooks.yml` → Runs matching TypeScript hooks → Aggregates results back to agent.

**Why it exists:** Native hooks are raw and limited. Clooks adds:
- **Safety** — Fail-closed by default (crashed hook = blocked action, not silent pass-through)
- **Programmability** — TypeScript with typed contracts, not bash scripts
- **Composability** — Multiple hooks per event, parallel or sequential execution
- **Portability** — Vendored into repo. Clone and it works.
- **Testability** — Co-located `.test.ts` files + `clooks test` with synthetic events
- **Discoverability** — Interactive TUI for browsing/installing hooks from a marketplace

## Architecture

```
project/
├── .clooks/
│   ├── clooks.yml        # config + overrides (committed)
│   ├── hooks.lock        # pinned SHAs + content hashes (always committed)
│   ├── hooks/            # custom hooks (committed)
│   └── vendor/           # installed marketplace hooks (committed by default)
└── .claude/
    └── settings.json     # bash entrypoint registered here
```

**Hook contract:** One hook per `.ts` file. Exports `meta` (name, events, config schema with defaults) and a default handler function. `clooks.yml` overrides defaults — hooks are self-describing and batteries-included.

**Marketplace:** Separate GitHub repo acting as registry/index. Points to source repos. Hooks addressed as `githubuser/repo:Hook@sha`. Lockfile pins to concrete commit SHAs.

## Key Decisions

- Bun runtime, compiled binary, bash entrypoint kept for flexibility
- `.clooks/` directory in project root (not `.claude/`)
- Vendoring default (committed to git), lockfile always committed
- Fail-closed error handling (crashed hook = blocked action)
- All hooks must be registered in `clooks.yml` (no auto-discovery)
- First-class hook testing (co-located `.test.ts` + manual invocation)
- Interactive TUI CLI (not flags-and-args)
- Standalone CLI, not a Claude Code plugin (plugin system too limited)
- Cross-agent architecture from day one
- Bootstrap: block + inform, no auto-download (security)
- Mac + Linux only (Windows deferred)
- Domain: clooks.cc

## Project Navigation

- `PRODUCT_EXPLORATION.md` — full product vision, problem space, use cases, decisions, and research
- `docs/plans/PLANS.md` — how to write and manage execution plans (ExecPlans)
- `docs/planned/FEATURES.md` — how to write and manage features
- `docs/planned/index.md` — feature index with status tracking
- `docs/domain/` — domain knowledge documents
- `docs/findings/` — problems, gaps, and friction encountered during development
- `docs/research/` — standalone research into topics, libraries, and approaches

## Workflow

This project uses agentic-driven development with a clear separation between features and plans.

1. **Features** are high-level business requirements captured in `docs/planned/`. They describe *what* and *why*, not *how*. Read `docs/planned/FEATURES.md` for procedures on creating, refining, and completing features.

2. **Plans** are detailed execution plans (ExecPlans) that break a feature into implementable work. They live in `docs/plans/<branch-name>/PLAN.md`. Read `docs/plans/PLANS.md` for requirements, skeleton, and procedures.

3. **Domain knowledge** lives in `docs/domain/`. Plans must consult and update domain docs as part of implementation. The ordering is strict: **plan → implement → update knowledge**.

4. **Findings** are logged in real-time to `docs/findings/` whenever you hit snags: knowledge gaps, code quality issues, test gaps, stale docs, or tooling friction. Read `docs/findings/index.md` for format and severity levels. Remove findings once the underlying issue is resolved. **CRITICAL: Read `docs/findings/index.md` at the start of every session.**
