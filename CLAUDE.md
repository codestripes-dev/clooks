# Clooks

A Claude Code plugin that takes ownership of Claude Code hooks entirely.

## Project Navigation

- `docs/plans/PLANS.md` — how to write and manage execution plans (ExecPlans)
- `docs/planned/FEATURES.md` — how to write and manage features
- `docs/planned/index.md` — feature index with status tracking
- `docs/domain/` — domain knowledge documents
- `docs/findings/` — problems, gaps, and friction encountered during development
- `PRODUCT_EXPLORATION.md` — product vision and exploration (read this for context on what Clooks is becoming)

## Workflow

This project uses agentic-driven development with a clear separation between features and plans.

1. **Features** are high-level business requirements captured in `docs/planned/`. They describe *what* and *why*, not *how*. Read `docs/planned/FEATURES.md` for procedures on creating, refining, and completing features.

2. **Plans** are detailed execution plans (ExecPlans) that break a feature into implementable work. They live in `docs/plans/<branch-name>/PLAN.md`. Read `docs/plans/PLANS.md` for requirements, skeleton, and procedures.

3. **Domain knowledge** lives in `docs/domain/`. Plans must consult and update domain docs as part of implementation. The ordering is strict: **plan → implement → update knowledge**.

4. **Findings** are logged in real-time to `docs/findings/` whenever you hit snags: knowledge gaps, code quality issues, test gaps, stale docs, or tooling friction. Read `docs/findings/index.md` for format and severity levels. Remove findings once the underlying issue is resolved. **CRITICAL: Read `docs/findings/index.md` at the start of every session.**
