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
| CLI Architecture — Engine Mode & Dispatch | `cli-architecture/dispatch.md` | Empty stdin handling, three-way mode dispatch, engine-mode run path, mode-aware signal handlers, MCP command |
| CLI Architecture — Command Framework | `cli-architecture/command-framework.md` | Commander.js setup, `runCLI` error handling, `OutputContext`/JSON-mode pattern, command factory pattern, TUI wrapper guards, JSON output envelope |
| CLI Architecture — Setup Commands | `cli-architecture/commands-setup.md` | Plugin installer, `clooks init` / `clooks init --global`, `clooks config`, `clooks types` |
| CLI Architecture — Hook & Lifecycle Commands | `cli-architecture/commands-hooks.md` | `clooks add`, `clooks new-hook`, `clooks update plugin:<pack>`, `clooks test`, `clooks uninstall` |
| Config System | `config.md` | Config format, parsing, validation, merging, resolution rules |
| Config — Discovery | `config/discovery.md` | Walk-up algorithm, precedence order, boundary rules, `$CLAUDE_PROJECT_DIR` anchor, observability |
| Config — Execution & Circuit Breaker | `config/execution.md` | Execution group partitioning, ordering, group execution semantics, circuit breaker state |
| Config — Handoff | `config/handoff.md` | Long-message delivery: value shape, three-level precedence, eligibility, file protocol, cleanup |
| Config — Agents | `config/agents.md` | `agents` allowlist cascade (yaml + `meta.agents`), precedence, unknown ids, validation, layering |
| Claude Code Hooks — Overview | `claude-code-hooks/overview.md` | Configuration schema, 4 handler types, hook locations, environment variables |
| Claude Code Hooks — Events | `claude-code-hooks/events.md` | All 22 lifecycle events: matchers, input fields, decision control |
| Claude Code Hooks — I/O Contract | `claude-code-hooks/io-contract.md` | Exit codes, JSON output, decision patterns, tool_input schemas |
| Claude Code Hooks — Behavior & Gotchas | `claude-code-hooks/behavior-and-gotchas.md` | Execution model, async, session snapshot, known issues |
| Cross-Agent Hooks | `cross-agent-hooks.md` | Hook systems across Claude Code, Cursor, Windsurf, VS Code Copilot with event mapping |
| Cross-Agent Hooks — Codex | `cross-agent-hooks/codex.md` | Codex target events, config/trust/handler/coverage notes, event mapping table, pinned release source corrections |
| Cross-Agent Hooks — Codex Runtime Capabilities | `cross-agent-hooks/codex-capabilities.md` | Current per-event result surface, live-checkpoint approvals, diagnostics, turn policy, hook-pack discovery, global init/uninstall/registration |
| Cross-Agent Hooks — Codex Plugin Onboarding | `cross-agent-hooks/codex-onboarding.md` | `$clooks:setup` flow, installer selection, native onboarding evidence |
| Cross-Agent Hooks — Scoping Hooks to Agents | `cross-agent-hooks/agent-scoping.md` | `meta.agents` vs `clooks.yml` `agents`, precedence, debug output, reserved `agent` context key |
| Codex Interrupt | [codex-interrupt.md](codex-interrupt.md) | Root-turn observer contract, three-second budget, and native probe requirements |
| Global Hooks | `global-hooks.md` | User-wide hooks architecture: directory structure, config scoping, merge semantics, failure state, shadow warnings |
| Hook Type System — Index | `hook-type-system.md` | Index pointing to focused sub-docs: patterns, decision methods, lifecycle, .d.ts bundle |
| Hook Type System — Patterns | `hook-type-system/patterns.md` | Event categories, ResultTag/ExitCode, BaseContext, tool-event pipeline, branded strings, normalization, runtime validation |
| Hook Type System — Decision Methods | `hook-type-system/decision-methods.md` | Per-event decision methods, runtime attachment, type-composition primitive vocabulary, worked composition example |
| Hook Type System — Lifecycle Types | `hook-type-system/lifecycle-types.md` | `beforeHook` / `afterHook`, `BeforeHookEvent` / `AfterHookEvent`, `HookEventMeta` |
| Hook Type System — `.d.ts` Bundle | `hook-type-system/dts-bundle.md` | Bundle generation, binary embedding, hook-author imports |
| Shared Interactive Approval Transport | `interactive-approvals.md` | Index pointing to focused sub-docs: internal command API, engine checkpoints, generated registration/identity, MCP server, storage & validation |
| Shared Interactive Approval Transport — Internal Command API | `interactive-approvals/command-api.md` | `createApprovalInteraction`, `ApprovalInteraction` shape, question/reply semantics, closure/failure latching |
| Shared Interactive Approval Transport — Engine Checkpoints | `interactive-approvals/engine-checkpoints.md` | `executeHooks` interaction/signal arguments, lifetime boundary, sequential/parallel ask handling, reconfirmation |
| Shared Interactive Approval Transport — Generated Registration & Identity | `interactive-approvals/registration-and-identity.md` | Registration command/companion/server preparation, suppression, uninstall; `CheckInput` identity/wire-key schema, mailbox rendezvous |
| Shared Interactive Approval Transport — MCP Server | `interactive-approvals/mcp-server.md` | `handleApprovalCheck`, per-agent message layout, elicitation schema/response validation, `createApprovalServer`, stream/signal handling |
| Shared Interactive Approval Transport — Storage & Validation | `interactive-approvals/storage-and-validation.md` | Storage layout and limits, cleanup/retention, compiled validation-boundary test inventory |
| Turn State | `turn-state.md` | `ctx.turn`, once-per-turn pattern, intervention predicate, scopes, boundaries, storage/lock protocol, fail-safe directions |
| Vendoring — Overview | `vendoring/overview.md` | Core vendoring concepts, vendor directory layout, formats, registration, V0 limitations |
| Vendoring — clooks add | `vendoring/clooks-add.md` | `clooks add` workflow (blob URL + repo URL), multi-hook packs, manifest format |
| Vendoring — Plugin Vendoring | `vendoring/plugin-vendoring.md` | Plugin cache discovery, plugin hook vendoring, scope-based routing |

## Patterns & Conventions

| Document | Path | Description |
|----------|------|-------------|

## Testing

| Document | Path | Description |
|----------|------|-------------|
| Codex Native Testing | `testing/codex-native.md` | Synthetic fixture provenance, isolated native smoke, historical retired-token evidence and [current shared approval coverage](testing/interactive-approvals.md) |
| Codex Native Testing — Fixtures & Evidence | `testing/codex-native/fixtures-and-evidence.md` | Synthetic fixture provenance, evidence-level taxonomy (`S`/`P`/`L`), authorized real-session probes, opt-in native CLI smoke |
| Codex Native Testing — Approval Case Evidence | `testing/codex-native/approval-cases.md` | Actual-pack native evidence, direct-rewrite native policy controls, historical hybrid (token-runtime) approval cases |
| Codex Native Testing — Native Scenarios | `testing/codex-native/scenarios.md` | Native SessionEnd shutdown, handoff/Interrupt/MCP observation, local function-tool rewrites |
| Codex Native Testing — Plugin Onboarding | `testing/codex-native/onboarding.md` | Native marketplace onboarding: `$clooks:setup`, installer dispatch, full case matrix |
| E2E Testing Architecture | `testing.md` | Three-layer strategy, hermetic E2E via `bun run test:e2e`, sandbox pattern, fail-closed invariant, gotchas |
| E2E Testing — Codex & Approval Coverage | `testing/codex-e2e-coverage.md` | Compiled build format, generated approval registration, build parity, per-capability Codex E2E coverage |
| E2E Testing — Conventions | `testing/e2e-conventions.md` | Sandbox pattern, Docker environment gate, non-root test user, domain-based test-file taxonomy, inline vs fixture hooks |
| E2E Testing — Validation History | `testing/validation-history.md` | Milestone validation evidence for agent-adapter/invocation-policy boundary, Codex registration/event/storage work, uninstall decisions, how to run |
| Hook Author Testing | `testing/hook-author-testing.md` | `clooks test` harness for hook authors: JSON shape, decision-result interpretation, exit codes, CI loop pattern, drift gate |
| Hook Author Testing — Invocation & JSON Shape | `testing/hook-author-testing/invocation-and-shape.md` | Two output contracts, invocation forms, synthetic Context JSON shape (required/defaulted fields, `hookConfig` overrides, lifecycle wrappers), decision-result interpretation |
| Hook Author Testing — Examples & Usage | `testing/hook-author-testing/examples-and-usage.md` | Worked PreToolUse/UserPromptSubmit/AskUserQuestion examples, CI loop pattern, known limitations, drift gate |
| Hook Config Overrides | `testing/hook-config-overrides.md` | Worked example showing `--config` and `--config-json` producing identical merged hookConfig |
| Native Interactive Approval Probes | `testing/interactive-approvals.md` | Index pointing to focused sub-docs: generated registration, protocol & timing, interactive config discriminators, scoped/bootstrap/boundaries, isolation & fixture lifetime |
| Native Interactive Approval Probes — Generated Registration | `testing/interactive-approvals/generated-registration.md` | `--generated` mode case naming/selection, native `init`, build snapshotting, production fixture execution, decline/cancellation evidence |
| Native Interactive Approval Probes — Generated Registration Protocol & Timing | `testing/interactive-approvals/generated-registration-protocol.md` | Elicitation/UI mailbox protocol, compiled-engine coverage, timing/deadline budgets, registration E2E, acceptance/cancellation verification |
| Native Interactive Approval Probes — Claude Interactive Config Discriminators | `testing/interactive-approvals/interactive-config.md` | `--interactive-config` modes (disk, cli-no-tools, cli-restart, cli-second-turn), readiness diagnostics |
| Native Interactive Approval Probes — Scoped Registration & External Boundaries | `testing/interactive-approvals/scoped-bootstrap-boundaries.md` | Scoped registration/bootstrap cases, overlap candidates, external native timeout/dual-exit boundaries |
| Native Interactive Approval Probes — Isolation & Fixture Lifetime | `testing/interactive-approvals/isolation-and-lifetime.md` | Illustrative-fixture isolation/evidence contracts, mailbox fixture lifetime and budgets |

## Tools & Recipes

| Document | Path | Description |
|----------|------|-------------|
| Tools | `tools.md` | Mise tool management, install vs use gotcha, shell activation |
