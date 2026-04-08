# Findings

This directory tracks problems, gaps, and friction encountered during development. Its purpose is to surface recurring issues so they can be addressed systematically rather than worked around repeatedly.

## How This Works

### When to log a finding

Log a finding **in real-time** whenever you:
- Try running a command that doesn't exist or doesn't work as expected
- Loop on a problem because you misunderstood how an API or library works
- Struggle with code that is unwieldy, unclear, or poorly structured
- Discover tests that should exist but don't, or tests that pass for the wrong reasons
- Find documentation that is wrong, outdated, or missing when you need it
- Hit build, lint, CI, or tooling issues that block or slow progress
- Find that a process instruction (PLANS.md, FEATURES.md, etc.) is unclear, overly rigid, missing a step, or counterproductive

Do not wait until the end of a task — but only log a finding once the problem has either been **resolved** (you found a workaround or fix and can continue) or **abandoned** (you gave up because no good solution exists). The point is to capture the full picture: what went wrong and how it ended.

### How to log a finding

**Do not log findings yourself.** Dispatch a background subagent to handle it so your main work is not interrupted or blocked. Provide the subagent with:
- A clear description of the problem you encountered
- What you were doing when it happened
- How it was resolved, or that it was abandoned and why
- Any relevant error messages, file paths, or commands

The subagent is responsible for:
- Reading these instructions and the category files
- Determining which category file the finding belongs in
- Checking whether a similar finding already exists (merge if so, create new if not)
- Writing the finding in the correct format

### End-of-task retrospective

When you have completed your task, ask the user whether they want to run a retrospective. The retrospective is performed by the main agent itself — not a subagent — because only the main agent has full context of what happened during the session.

In a retrospective, review all findings logged during the session and your own memory of the work. Cover the following:

**What went wrong**, organized by impact:
- Blockers that stopped progress and what could prevent them in the future
- Friction points that slowed work and whether they are systemic or one-off
- Patterns across findings — e.g., "three separate issues all trace back to missing type definitions"
- For each finding: was the resolution adequate, or is it a band-aid? Is there a deeper root cause?

**What could be better** — things that weren't problems per se, but where you noticed room for improvement:
- Code that works but is harder to understand or modify than it needs to be
- Abstractions that are slightly off — not wrong, but not quite right either
- Conventions that are inconsistent or undocumented
- Tests that exist but don't cover the important paths
- Documentation that exists but could be clearer or more complete
- Workflows or processes that felt heavier than necessary

**Concrete recommendations**, such as:
- New domain docs to write (with suggested path and scope)
- Feature proposals to create for systemic improvements
- Refactoring targets with a brief rationale
- Documentation updates needed
- Findings that can now be removed because the underlying issue was resolved during the session

Present the retrospective to the user as a structured summary. The user decides which recommendations to act on. Once they have chosen, offer to spawn a subagent to process the selected recommendations (e.g., creating feature proposals, writing domain docs, updating findings).

### Finding format

Each finding is a small section in the appropriate category file. Use this format:

```markdown
### <Short descriptive title>

**Severity:** blocker | friction | note
**Date:** YYYY-MM-DD
**Context:** What you were doing when you hit this

What happened, why it was a problem, and what you did (or couldn't do) to work around it. Include error messages, file paths, or commands where relevant.
```

Severity levels:
- **blocker** — stopped work entirely, required human intervention or a significant detour
- **friction** — slowed work noticeably, required multiple attempts or workarounds
- **note** — worth knowing for future reference, didn't significantly impede progress

### Consuming findings

Findings are not write-only — they are inputs to plans and research.

**Plans:** Before writing an ExecPlan, scan the category files for findings relevant to the area of work. Known issues should inform the plan's approach. List relevant findings in the plan's `Related Findings` section (see `docs/plans/PLANS.md`). On plan completion, review findings logged during execution and remove any that the plan resolved.

**Research:** Recurring or unresolved findings can prompt dedicated research. If a finding keeps appearing or its recommendation requires deeper investigation, create a research doc in `docs/research/` and link it back to the originating finding.

**Features:** When a finding reveals a systemic issue that requires its own feature proposal, create the feature and note it in the finding's resolution. The finding can then be removed once the feature is planned.

### Maintenance

Findings are not permanent. Remove entries when:
- The underlying issue has been fixed
- The finding is no longer relevant (e.g., a library was replaced)
- The finding has been extracted into a domain doc or feature

## Category Files

| File | What to log |
|------|-------------|
| `knowledge-gaps.md` | Missing knowledge — commands that don't exist, APIs misunderstood, undocumented behavior |
| `code-quality.md` | Unwieldy code, smelly patterns, confusing architecture, excessive complexity |
| `test-gaps.md` | Missing tests, tests that pass for wrong reasons, untestable code |
| `stale-docs.md` | Documentation that was wrong, outdated, or missing when needed |
| `tooling-friction.md` | Build issues, slow commands, flaky CI, broken toolchain steps |
| `process-feedback.md` | Issues with process docs themselves — unclear instructions, rigid templates, missing procedures, counterproductive steps |

## Standalone Findings

Findings that span multiple categories or represent compound bugs with broad impact get their own file rather than being split across category files.

| File | Severity | Summary |
|------|----------|---------|
| `config-validation-deadlock.md` | blocker | Config validation errors cause unrecoverable agent deadlock — two bugs combine to brick the session with no in-session recovery |
