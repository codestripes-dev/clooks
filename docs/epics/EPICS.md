# Epics

Epics are coordination documents for large initiatives that span multiple features, plans, and research efforts. They sit above features and plans in the document hierarchy and provide the map that connects them.

## When to Create an Epic

Create an epic when an initiative meets ANY of:

- It involves 3 or more plans with dependencies between them.
- It spawns multiple features beyond the primary one.
- It has 5 or more research documents feeding into it.
- Design decisions span multiple plans and need a single authoritative source.

Do NOT create an epic for a feature with a single plan and no cross-cutting decisions. Most features do not need an epic.

## What Belongs in an Epic

An epic contains:
- The narrative summary (what, why, approach)
- Feature references (not user journeys -- those live in the feature file)
- Research index organized by relevance to plans
- Plan summaries (goal, scope, dependencies -- not milestones or code changes)
- Dependency graph between plans
- Cross-plan design decisions
- Open questions assigned to specific plans
- Plan-level progress tracking
- User journey narrative (the end-to-end story that ties plans together)
- Implementer gotchas (non-obvious constraints discovered during research)

An epic does NOT contain:
- User journeys or acceptance criteria (those are in features)
- Implementation steps, milestones, or code changes (those are in plans)
- Research findings (those are in research docs)
- Task-level progress (that is in plan Progress sections)

## Epic File Template

Each epic is a file at `docs/epics/EPIC-XXXX-<slug>.md`. The ID uses the same sequence as the primary feature it coordinates (e.g., EPIC-0041 coordinates FEAT-0041). This makes it trivial to find the epic for a feature and vice versa.

```markdown
# EPIC-XXXX: <Title>

**Status:** draft | active | done | abandoned

## Summary

One paragraph explaining the initiative: what it achieves, why it matters, and the high-level approach.

## Features

- [`FEAT-XXXX-slug.md`](../planned/FEAT-XXXX-slug.md) -- primary feature. Brief description.

### Spawned Features

- [`FEAT-YYYY-slug.md`](../planned/FEAT-YYYY-slug.md) -- what and why it was split out.

### External Dependencies

- **FEAT-ZZZZ** (Title) -- what this epic needs from it.

## Research

Organize by tier. Each entry: link, status, one-line description.

### Strategic Research

| Doc | Status | What it covers |
|-----|--------|---------------|

### Implementation Research

| Doc | Status | What it covers |
|-----|--------|---------------|

### Empirical Spikes

| Doc | Status | What it verified |
|-----|--------|-----------------|

## User Journey

The end-to-end narrative from the user's perspective. Traces every phase from first contact to steady state. Marks when the user gains knowledge and what happens automatically. Surfaces friction points.

## Implementer Gotchas

Non-obvious constraints discovered during research that could trip up an implementer. Table format: gotcha, why it matters, source.

## Plans

### Dependency Graph

ASCII art or bullet list showing plan ordering and parallelism.

### Plan A: <Name>

**Status:** not started | planning | in progress | blocked | done
**Plan file:** `docs/plans/PLAN-XXXX-slug.md` (or "not yet written")
**Depends on:** Nothing | Plan X | FEAT-YYYY

**Goal:** One sentence.

**Scope:**
- Bullet points (4-6) describing what this plan covers.

**Key files:** Primary source files affected.

**Relevant research:** Research doc names from the Research section.

---

(Repeat for each plan.)

## Design Decisions

Cross-plan decisions only. Single-plan decisions belong in that plan's Decision Log.

| Decision | Resolution | Source |
|----------|-----------|--------|

## Open Questions

| Question | Relevant Plan | Notes |
|----------|--------------|-------|

## Revision Log

- YYYY-MM-DD: Created. Initial plans outlined.

## Instruction Prompts

When creating, refining, or implementing this epic, immediately record the prompt you were given below. This is not optional — paste the user's instruction verbatim before doing any other work. Future agents use these prompts to understand the intent behind the epic and to resume work without context loss.
```

## Lifecycle

| Status | Meaning |
|--------|---------|
| `draft` | Epic is being shaped. Plans may not exist yet. |
| `active` | At least one plan is in progress. |
| `done` | All plans complete. Move to `docs/epics/done/`. |
| `abandoned` | Initiative cancelled. Add explanation. Keep in place. |

## Maintenance Rules

1. **When a plan is created:** Add its file path to the epic's plan entry. Update status from "not yet written" to "planning".
2. **When a plan starts execution:** Update the plan's status to "in progress".
3. **When a plan completes:** Update the plan's status to "done". Update dependency graph if downstream plans are now unblocked.
4. **When a cross-plan decision is made or revised during plan execution:** Update the epic's Design Decisions table. This is mandatory.
5. **When an open question is resolved:** Remove it from Open Questions or move it to Design Decisions.
6. **When a new feature is spawned:** Add it to the Spawned Features section.
7. **When all plans are done:** Set epic status to `done` and move to `docs/epics/done/`.

The ordering is: **update epic -> update plan -> implement -> update domain knowledge**.

## Relationship to Other Document Types

| Document | Defines | Epic's relationship |
|----------|---------|-------------------|
| Feature (FEAT) | What and why | Epic references features. Does not duplicate user journeys. |
| Plan (ExecPlan) | How | Epic summarizes plan scope and tracks plan-level status. Does not duplicate milestones. |
| Research | Investigation | Epic indexes research docs and maps them to relevant plans. |
| Domain knowledge | Living reference | Epic does not reference domain docs directly. Plans do. |
| Findings | Problems and gaps | Epic does not reference findings directly. Plans do. |
