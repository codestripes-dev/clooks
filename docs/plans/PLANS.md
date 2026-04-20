# Execution Plans (ExecPlans):

This document describes the requirements for an execution plan ("ExecPlan"), a design document that a coding agent can follow to deliver a working feature or system change. Treat the reader as a complete beginner to this repository: they have only the current working tree and the single ExecPlan file you provide. There is no memory of prior plans and no external context.

## How to use ExecPlans and PLANS.mdthat's.

When authoring an executable specification (ExecPlan), follow these instructions _to the letter_. If these instructions are not in your context, refresh your memory by reading them (`docs/plans/PLANS.md`) in full. Be thorough in reading (and re-reading) source material to produce an accurate specification. When creating a spec, start from the skeleton and flesh it out as you do your research.

When implementing an executable specification (ExecPlan), do not prompt the user for "next steps"; simply proceed to the next milestone. Keep all sections up to date, add or split entries in the list at every stopping point to affirmatively state the progress made and next steps. Resolve ambiguities autonomously, and commit frequently.

When discussing an executable specification (ExecPlan), record decisions in a log in the spec for posterity; it should be unambiguously clear why any change to the specification was made. ExecPlans are living documents, and it should always be possible to restart from _only_ the ExecPlan and no other work.

When researching a design with challenging requirements or significant unknowns, use milestones to implement proof of concepts, "toy implementations", etc., that allow validating whether the user's proposal is feasible. Read the source code of libraries by finding or acquiring them, research deeply, and include prototypes to guide a fuller implementation.

## Requirements

NON-NEGOTIABLE REQUIREMENTS:

* Every ExecPlan must be fully self-contained. Self-contained means that in its current form it contains all knowledge and instructions needed for a novice to succeed.
* Every ExecPlan is a living document. Contributors are required to revise it as progress is made, as discoveries occur, and as design decisions are finalized. Each revision must remain fully self-contained.
* Every ExecPlan must enable a complete novice to implement the feature end-to-end without prior knowledge of this repo.
* Every ExecPlan must produce a demonstrably working behavior, not merely code changes to "meet a definition".
* Every ExecPlan must define every term of art in plain language or do not use it.
* Every ExecPlan must identify related domain knowledge documents (`docs/domain/`) and include updating them when the implementation changes what they describe. The ordering is strict: **plan → implement → update knowledge**. A task is not done until affected domain docs are updated.
* Every ExecPlan must cross-reference the originating feature (if one exists) and verify that the plan's goals remain aligned with the feature's stated use cases and intent. If there is drift, record it in the Decision Log and resolve it with the user before proceeding.

Purpose and intent come first. Begin by explaining, in a few sentences, why the work matters from a user's perspective: what someone can do after this change that they could not do before, and how to see it working. Then guide the reader through the exact steps to achieve that outcome, including what to edit, what to run, and what they should observe.

The agent executing your plan can list files, read files, search, run the project, and run tests. It does not know any prior context and cannot infer what you meant from earlier milestones. Repeat any assumption you rely on. Do not point to external blogs or docs; if knowledge is required, embed it in the plan itself in your own words. If an ExecPlan builds upon a prior ExecPlan and that file is checked in, incorporate it by reference. If it is not, you must include all relevant context from that plan.

## Formatting

Format and envelope are simple and strict. Each ExecPlan must be one single fenced code block labeled as `md` that begins and ends with triple backticks. Do not nest additional triple-backtick code fences inside; when you need to show commands, transcripts, diffs, or code, present them as indented blocks within that single fence. Use indentation for clarity rather than code fences inside an ExecPlan to avoid prematurely closing the ExecPlan's code fence. Use two newlines after every heading, use # and ## and so on, and correct syntax for ordered and unordered lists.

When writing an ExecPlan to a Markdown (.md) file where the content of the file *is only* the single ExecPlan, you should omit the triple backticks.

Write in plain prose. Prefer sentences over lists. Avoid checklists, tables, and long enumerations unless brevity would obscure meaning. Checklists are permitted only in the `Progress` section, where they are mandatory. Narrative sections must remain prose-first.

## Guidelines

Self-containment and plain language are paramount. If you introduce a phrase that is not ordinary English ("daemon", "middleware", "RPC gateway", "filter graph"), define it immediately and remind the reader how it manifests in this repository (for example, by naming the files or commands where it appears). Do not say "as defined previously" or "according to the architecture doc." Include the needed explanation here, even if you repeat yourself.

Avoid common failure modes. Do not rely on undefined jargon. Do not describe "the letter of a feature" so narrowly that the resulting code compiles but does nothing meaningful. Do not outsource key decisions to the reader. When ambiguity exists, resolve it in the plan itself and explain why you chose that path. Err on the side of over-explaining user-visible effects and under-specifying incidental implementation details.

Anchor the plan with observable outcomes. State what the user can do after implementation, the commands to run, and the outputs they should see. Acceptance should be phrased as behavior a human can verify ("after starting the server, navigating to http://localhost:8080/health returns HTTP 200 with body OK") rather than internal attributes ("added a HealthCheck struct"). If a change is internal, explain how its impact can still be demonstrated (for example, by running tests that fail before and pass after, and by showing a scenario that uses the new behavior).

Specify repository context explicitly. Name files with full repository-relative paths, name functions and modules precisely, and describe where new files should be created. If touching multiple areas, include a short orientation paragraph that explains how those parts fit together so a novice can navigate confidently. When running commands, show the working directory and exact command line. When outcomes depend on environment, state the assumptions and provide alternatives when reasonable.

Trace downstream effects of shared abstractions. When a plan touches a shared function, base class, or core abstraction, do not stop at identifying its callsites. Trace what happens to its return values and side effects through the full pipeline — loading, validation, execution, error reporting. A resolver that changes how a path is computed may also require changes in the loader that validates the resolved artifact, or in error formatting that displays the path. The plan must account for all consumers of the changed behavior, not just the direct callers of the changed function.

Be idempotent and safe. Write the steps so they can be run multiple times without causing damage or drift. If a step can fail halfway, include how to retry or adapt. If a migration or destructive operation is necessary, spell out backups or safe fallbacks. Prefer additive, testable changes that can be validated as you go.

Validation is not optional. Include instructions to run tests, to start the system if applicable, and to observe it doing something useful. Describe comprehensive testing for any new features or capabilities. Include expected outputs and error messages so a novice can tell success from failure. Where possible, show how to prove that the change is effective beyond compilation (for example, through a small end-to-end scenario, a CLI invocation, or an HTTP request/response transcript). State the exact test commands appropriate to the project's toolchain and how to interpret their results.

Every plan that changes production code must include both unit tests and E2E tests. Unit tests validate individual modules in isolation. E2E tests invoke the compiled binary as a subprocess and verify the full pipeline: binary startup → config loading → hook execution → JSON output. E2E tests run via `bun run test:e2e`, which automatically builds and runs a hermetic Docker container. See `docs/domain/testing.md` for the sandbox pattern, fixture conventions, and test organization. A milestone is not complete until its E2E tests pass via `bun run test:e2e`.

Capture evidence. When your steps produce terminal output, short diffs, or logs, include them inside the single fenced block as indented examples. Keep them concise and focused on what proves success. If you need to include a patch, prefer file-scoped diffs or small excerpts that a reader can recreate by following your instructions rather than pasting large blobs.

## Domain Knowledge Integration

This repository maintains structured domain knowledge in `docs/domain/`. Every ExecPlan must integrate with it. This is not optional.

### Product context

Every plan must have a `Product Context` section (see skeleton below) that states what problem the work solves and what it may affect. Fill this in from the originating feature file, the task description, or your own understanding of the codebase. The section grounds the work in product impact and ensures reviewers understand the "why" beyond implementation.

If this plan originates from a feature in `docs/planned/`, verify the plan's goals align with the feature's stated use cases and summary. If there is drift, record it in the Decision Log and resolve it with the user before proceeding.

### Before writing a plan

Consult `docs/domain/` to identify which domain knowledge documents are relevant to your work. Read each relevant document so you understand the current documented state of the areas you are about to change. List every relevant domain knowledge document in the plan's `Related Domain Knowledge Documents` section (see skeleton below).

Consult `docs/findings/` to identify existing findings relevant to your work. Scan the category files (knowledge-gaps, code-quality, test-gaps, stale-docs, tooling-friction, process-feedback) for entries that relate to the area you are about to change. Known friction, knowledge gaps, or code quality issues should inform the plan's approach — a plan that ignores a documented finding risks repeating the same mistake. List any relevant findings in the plan's `Related Findings` section (see skeleton below).

### During implementation

If your implementation changes behavior, patterns, conventions, file locations, or architecture described in any domain knowledge document, you MUST update that document as part of your work. The ordering is strict: **plan first → implement → update knowledge**. Do not treat knowledge updates as optional follow-up work; they are part of completing the task.

Log findings as they occur during implementation. Follow the procedures in `docs/findings/index.md` — dispatch a background subagent so your main work is not interrupted. Do not wait until the end of the task.

Specifically, update domain docs when:
- You add, rename, move, or delete files or modules that are referenced in a domain doc.
- You change a pattern or convention that a domain doc describes (e.g., a new service pattern, a changed API workflow).
- You add a new domain concept, model, service, or subsystem that belongs in an existing domain doc or warrants a new one.
- You deprecate or replace something that a domain doc currently recommends.

### In the plan itself

The `Related Domain Knowledge Documents` section must list:
1. Every domain doc you consulted while writing the plan (with its path).
2. For each doc, whether it needs updating and what specifically will change.
3. If your work introduces something entirely new that doesn't fit existing docs, note that a new domain doc may be needed and where it should live.

This ensures that domain knowledge stays accurate as the codebase evolves. A plan is not complete if it changes documented behavior without updating the documentation.

### On plan completion

Review any findings logged during execution of the plan. If the plan's work resolved the underlying issue behind a finding, remove that finding. If the plan created new friction or gaps that weren't logged during implementation, log them now. A plan is not complete if it leaves stale findings behind.

## Milestones

Milestones are narrative, not bureaucracy. If you break the work into milestones, introduce each with a brief paragraph that describes the scope, what will exist at the end of the milestone that did not exist before, the commands to run, and the acceptance you expect to observe. Keep it readable as a story: goal, work, result, proof. Progress and milestones are distinct: milestones tell the story, progress tracks granular work. Both must exist. Never abbreviate a milestone merely for the sake of brevity, do not leave out details that could be crucial to a future implementation.

Each milestone must be independently verifiable and incrementally implement the overall goal of the execution plan.

## Living plans and design decisions

* ExecPlans are living documents. As you make key design decisions, update the plan to record both the decision and the thinking behind it. Record all decisions in the `Decision Log` section.
* ExecPlans must contain and maintain a `Product Context` section, a `Progress` section, a `Surprises & Discoveries` section, a `Decision Log`, an `Outcomes & Retrospective` section, and a `Related Domain Knowledge Documents` section. These are not optional.
* When you discover optimizer behavior, performance tradeoffs, unexpected bugs, or inverse/unapply semantics that shaped your approach, capture those observations in the `Surprises & Discoveries` section with short evidence snippets (test output is ideal).
* If you change course mid-implementation, document why in the `Decision Log` and reflect the implications in `Progress`. Plans are guides for the next contributor as much as checklists for you.
* Before reporting a milestone complete, run a deviation check against the plan's `Interfaces and Dependencies` section (if it exists) and any pseudo-code the plan committed to. If you changed an API shape or default from what the plan specified, OR if you restructured a code path the plan described in pseudo-code form (engine flows, signatures, precedence orders), log the deviation to `Surprises & Discoveries` with a short rationale. A mention in the subagent's final report is not sufficient — the plan file itself must record it, so the next contributor reading only the plan sees what actually shipped. A milestone is not complete until structural deviations are written into the plan.
* At completion of a major task or the full plan, write an `Outcomes & Retrospective` entry summarizing what was achieved, what remains, and lessons learned.

# Prototyping milestones and parallel implementations

It is acceptable—-and often encouraged—-to include explicit prototyping milestones when they de-risk a larger change. Examples: adding a low-level operator to a dependency to validate feasibility, or exploring two composition orders while measuring optimizer effects. Keep prototypes additive and testable. Clearly label the scope as "prototyping"; describe how to run and observe results; and state the criteria for promoting or discarding the prototype.

Prefer additive code changes followed by subtractions that keep tests passing. Parallel implementations (e.g., keeping an adapter alongside an older path during migration) are fine when they reduce risk or enable tests to continue passing during a large migration. Describe how to validate both paths and how to retire one safely with tests. When working with multiple new libraries or feature areas, consider creating spikes that evaluate the feasibility of these features _independently_ of one another, proving that the external library performs as expected and implements the features we need in isolation.

## Skeleton of a Good ExecPlan

    # <Short, action-oriented description>

    This ExecPlan is a living document. The sections `Product Context`, `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Related Domain Knowledge Documents` must be kept up to date as work proceeds.

    If PLANS.md file is checked into the repo, reference the path to that file here from the repository root and note that this document must be maintained in accordance with PLANS.md.

    **Originating Feature:** <FEAT-XXXX link, or "None — standalone task">

    ## Purpose / Big Picture

    Explain in a few sentences what someone gains after this change and how they can see it working. State the user-visible behavior you will enable.

    ## Product Context

    **Problem we are solving:** <What user pain, business need, or technical debt motivates this work?>

    **Metrics this may affect:** <Qualitative or quantitative metrics — e.g., "reduces onboarding confusion", "improves 7-day retention", "no direct metric impact, pure tech debt".>

    **Feature alignment:** <If originating from a feature, confirm the plan's goals match the feature's use cases. Note any drift and how it was resolved.>

    ## Progress

    Use a list with checkboxes to summarize granular steps. Every stopping point must be documented here, even if it requires splitting a partially completed task into two ("done" vs. "remaining"). This section must always reflect the actual current state of the work.

    - [x] (2025-10-01 13:00Z) Example completed step.
    - [ ] Example incomplete step.
    - [ ] Example partially completed step (completed: X; remaining: Y).

    Use timestamps to measure rates of progress.

    ## Surprises & Discoveries

    Document unexpected behaviors, bugs, optimizations, or insights discovered during implementation. Provide concise evidence.

    - Observation: …
      Evidence: …

    ## Decision Log

    Record every decision made while working on the plan in the format:

    - Decision: …
      Rationale: …
      Date/Author: …

    ## Outcomes & Retrospective

    Summarize outcomes, gaps, and lessons learned at major milestones or at completion. Compare the result against the original purpose.

    ## Context and Orientation

    Describe the current state relevant to this task as if the reader knows nothing. Name the key files and modules by full path. Define any non-obvious term you will use. Do not refer to prior plans.

    ## Related Domain Knowledge Documents

    List every domain knowledge doc from `docs/domain/` that is relevant to this work. For each, state whether it needs updating as a result of this plan.

    - `docs/domain/example-concept.md` — consulted for context on X. Will need updating: new service must be added.
    - `docs/domain/patterns.md` — consulted for service patterns. No update needed.
    - `docs/domain/NEW_CONCEPT.md` — does not exist yet. Will create: this plan introduces a new subsystem that warrants its own domain doc.

    ## Related Findings

    List any findings from `docs/findings/` that are relevant to this work. For each, state how the plan addresses it (or note if it does not).

    - `docs/findings/knowledge-gaps.md` → "No documented pattern for global hook type imports" — this plan addresses the gap by publishing a types package.
    - `docs/findings/code-quality.md` → "Per-event circuit breaker causes total agent lockout" — not addressed by this plan, but noted as context for error handling decisions.

    ## Plan of Work

    Describe, in prose, the sequence of edits and additions. For each edit, name the file and location (function, module) and what to insert or change. Keep it concrete and minimal.

    ## Concrete Steps

    State the exact commands to run and where to run them (working directory). When a command generates output, show a short expected transcript so the reader can compare. This section must be updated as work proceeds.

    ## Validation and Acceptance

    Describe how to start or exercise the system and what to observe. Phrase acceptance as behavior, with specific inputs and outputs. If tests are involved, say "run <project's test command> and expect <N> passed; the new test <name> fails before the change and passes after>".

    ## Idempotence and Recovery

    If steps can be repeated safely, say so. If a step is risky, provide a safe retry or rollback path. Keep the environment clean after completion.

    ## Artifacts and Notes

    Include the most important transcripts, diffs, or snippets as indented examples. Keep them concise and focused on what proves success.

    ## Interfaces and Dependencies

    Be prescriptive. Name the libraries, modules, and services to use and why. Specify the types, traits/interfaces, and function signatures that must exist at the end of the milestone. Prefer stable names and paths such as `crate::module::function` or `package.submodule.Interface`. E.g.:

    In crates/foo/planner.rs, define:

        pub trait Planner {
            fn plan(&self, observed: &Observed) -> Vec<Action>;
        }

    ## Instruction Prompts

    When creating, refining, or implementing this plan, immediately record the prompt you were given below. This is not optional — paste the user's instruction verbatim before doing any other work. Future agents use these prompts to understand the intent behind the plan and to resume work without context loss.

If you follow the guidance above, a single, stateless agent -- or a human novice -- can read your ExecPlan from top to bottom and produce a working, observable result. That is the bar: SELF-CONTAINED, SELF-SUFFICIENT, NOVICE-GUIDING, OUTCOME-FOCUSED.

When you revise a plan, you must ensure your changes are comprehensively reflected across all sections, including the living document sections, and you must write a note at the bottom of the plan describing the change and the reason why. ExecPlans must describe not just the what but the why for almost everything.

## Plan File Organization

Note: `docs/plans/PLANS.md` (this file) is the permanent process document. Individual plans are files in `docs/plans/`.

The default form of a plan is a single file named `docs/plans/PLAN-XXXX-<plan-name>.md`, where `XXXX` is a zero-padded sequence number. A plan may be promoted to a subfolder when it needs supporting materials or when an ATTENTION.md is required (see Danger Zones below). The subfolder is named after the feature: `docs/plans/<feature-name>/PLAN-XXXX-<plan-name>.md`.

### When to use a folder

A plan MUST be moved into a subfolder when any of the following apply:

- The plan needs an `ATTENTION.md` (see Danger Zones & Guardrails below). The ATTENTION.md lives alongside the plan in the folder.
- The plan is split into multiple files (e.g., separate milestone documents, phased plans).
- The plan accumulates supporting materials (research notes, spike results, diagrams, API response samples).

The subfolder name must match the feature name (e.g., `docs/plans/config-system/PLAN-0005-config-system.md`). When promoting a single-file plan to a folder, move the existing file into the new folder — do not leave a copy at the old location.

### Rules

1. **Plan naming.** The file name follows the pattern `PLAN-XXXX-<plan-name>.md`. Number plans sequentially. A plan can be a single file or split across multiple files in a feature subfolder.
2. **Always update the plan first.** Before writing or modifying production code, tests, documentation, domain knowledge docs, or configuration — update the relevant plan. If the plan doesn't exist yet, create it with at least the skeleton from this document. If the plan exists but your current task isn't described in it, add the task to the Progress section BEFORE implementing it. The ordering is strict: **plan → implement → update knowledge**. Even small changes benefit from a brief plan entry — it can be lightweight, but it must exist before the work begins.
3. **Identify the author.** Run `gh api user --jq '.login'` to get the GitHub username. Use this handle in the `Decision Log` entries and `Progress` timestamps so it is clear who made each decision. If `gh` is unavailable or the command fails, ask the user for their developer handle.
4. **Plan files are committed with the code.** Plans travel with the code so reviewers and future contributors can understand why changes were made. They should be included in commits.
5. **Clean up on completion.** When a plan is complete, move it (file or folder) to `docs/plans/done/` for historical reference.

## Danger Zones & Guardrails

Some areas of a codebase have outsized blast radius. A small mistake in these zones can break the entire application, corrupt data, or silently degrade performance for every user. Actively watch for changes in these areas and flag them for human review.

### The ATTENTION.md file — THIS IS NOT OPTIONAL

**No plan that touches a danger zone is complete without an ATTENTION.md.** This is a hard requirement, not a suggestion. If your work touches one or more danger zones listed below, you MUST:

1. **Promote the plan to a subfolder** if it is not already in one. Move `docs/plans/PLAN-XXXX-<name>.md` to `docs/plans/<feature-name>/PLAN-XXXX-<name>.md`. Do this immediately — before continuing implementation.
2. **Create `ATTENTION.md`** in the same folder as the plan (e.g., `docs/plans/<feature-name>/ATTENTION.md`).

The ATTENTION.md is a short, focused document that lists every dangerous change, explains why it was made, and explains why a human reviewer should look at it carefully. It is not a replacement for the ExecPlan — it is a companion that acts as a spotlight on the riskiest parts of the diff.

Format of `ATTENTION.md`:

    # Attention Required

    Brief one-line summary of the branch purpose.

    ## Danger Zone Changes

    ### <Zone name> — <file or area touched>

    **What changed:** One or two sentences describing the change.
    **Why it changed:** One or two sentences explaining the motivation.
    **Why it matters:** One or two sentences on what could go wrong or what the reviewer should verify.

    (Repeat for each dangerous change.)

### Danger zone catalog

The following areas are considered danger zones. This list is not exhaustive — use judgment. If something feels like it could have cascading effects, treat it as a danger zone and document it.

1. **Application root and layout components.** Top-level layout components, entry points, and the main application shell affect every page and every user. Changes here can break routing, authentication flow, global state, or rendering for the entire application. Always flag.

2. **Database schema and migrations.** Any change to schema definitions or migration files touches the entire database. Column additions, index changes, constraint modifications, and table alterations can cause downtime, lock tables, or introduce subtle data integrity issues. Always flag — even if the migration looks trivial.

3. **Base classes and shared abstractions.** Changes to base classes, shared traits, mixins, or core abstractions propagate to every subclass or consumer. A small behavioral change in a base class can silently alter the behavior of dozens or hundreds of downstream components. Always flag.

4. **High-volume or partitioned data models.** Queries that touch large, partitioned, or sharded tables carry serious performance risk. Queries without proper scoping can scan entire tables instead of targeted partitions. Any new or modified query involving high-volume data must be reviewed for partition safety, index usage, and N+1 risks. Always flag.

5. **Permissions and authorization.** Permissions affect every user action across the entire application. Changes to permission logic, role definitions, or authorization guards can silently grant or revoke access, break workflows, or cause significant performance degradation. Always flag.

6. **Authentication and session handling.** Changes to login flows, token generation/validation, session management, or OAuth integrations affect every user's ability to access the application. Bugs here can lock users out or, worse, grant unauthorized access. Always flag.

7. **API schema (root-level changes).** Changes to top-level API schema definitions, context construction, or error handling affect every API operation. Distinguish between adding a new field (usually safe) and modifying schema-wide behavior like authentication middleware, error formatting, or context injection (always dangerous). Flag the latter.

8. **Background job and task infrastructure.** Changes to job base classes, queue configuration, retry logic, or task processing middleware affect every background job in the system. A mistake can cause jobs to silently fail, retry infinitely, or process in the wrong order. Always flag.

### When to create ATTENTION.md

Create or update `ATTENTION.md` at the moment you realize a change touches a danger zone — do not wait until the end. The sequence is: (1) recognize the danger zone, (2) promote the plan to a subfolder if needed, (3) create or update ATTENTION.md, (4) continue implementation. If you are unsure whether something qualifies, err on the side of documenting it. A false positive in `ATTENTION.md` costs the reviewer thirty seconds; a missed danger zone change can cost hours of debugging in production.

**To date, no ATTENTION.md has ever been created in this repository.** That does not mean none were needed — it means they were missed. Be the first to get this right.
