# Features

Features are high-level business requirements and ideas that haven't been broken down into implementation plans yet. They capture *what* we want and *why*, not *how*.

Each feature is a separate markdown file in `docs/planned/` and is tracked in `docs/planned/index.md`.

## Feature File Template

When creating a new feature, create a file at `docs/planned/FEAT-XXXX-<slug>.md`. The ID must be zero-padded to four digits (e.g., `FEAT-0001`, `FEAT-0042`, `FEAT-0100`). Use this structure:

```markdown
# FEAT-XXXX: <Title>

**Status:** draft | needs-research | ready-for-planning | planned

## Summary
1-2 sentences describing what this feature is and why it matters.

## Use Cases
- Concise use case 1
- Concise use case 2

## What Needs to Be Ready
What must exist, be decided, or be proven before this feature can be planned and implemented? This includes research that must conclude, other features that must ship first, product decisions that must be made, and infrastructure or tooling that must be in place. Link to research docs, other features, or domain docs where relevant.

## Open Questions
- Things that need to be figured out before this can be planned

## Notes
Freeform context, links, or ideas.

## Instruction Prompts

When creating or refining this feature, immediately record the prompt you were given below. This is not optional — paste the user's instruction verbatim before doing any other work. Future agents use these prompts to understand the intent behind the feature and to resume work without context loss.
```

The **Status** field in the file must match the section the feature is listed under in `index.md`:

| Status | index.md section |
|---|---|
| `draft` | Created |
| `needs-research` | Refined |
| `ready-for-planning` | Refined |
| `planned` | Planned |

## Procedures

### Creating a Feature

1. Read the `Next:` counter from `docs/planned/index.md`
2. Create `docs/planned/FEAT-XXXX-<slug>.md` using the template above
3. Add a one-liner under the **Created** section in `index.md`
4. Increment the `Next:` counter
5. Ask the user if they want to refine the feature now

### Refining a Feature

1. Answer open questions, sharpen use cases
2. Update the status in the feature file to `needs-research` or `ready-for-planning`
3. Move the one-liner to the matching section in `index.md`

### Completing a Feature

1. Move the feature file to `docs/planned/done/`
2. Move the one-liner to the **Done** section in `index.md`, updating the path to `docs/planned/done/`
