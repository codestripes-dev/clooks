# Config — Execution Group Model & Circuit Breaker

Hook execution pipeline details: group partitioning, ordering, and the circuit breaker.

## Execution Group Model

When the engine executes hooks for an event, it partitions them into **execution groups** — contiguous runs of hooks that share the same execution mode (parallel or sequential). The pipeline processes groups in order, and a block result from any group stops the entire pipeline.

### Lifecycle Methods

When a hook defines `beforeHook` and/or `afterHook`, the lifecycle is an atomic unit within the hook's execution. In sequential groups, the lifecycle (beforeHook → handler → afterHook) runs as part of the sequential flow. In parallel groups, the lifecycle is atomic within the hook's promise chain — each hook's lifecycle runs independently of other hooks in the batch.

The `LoadedHook` interface carries fields used by the lifecycle system and alias tracking:
- `hookPath: string` — Absolute path to the hook's `.ts` file. Populated by `loadHook()`.
- `configPath: string` — Absolute path to the `clooks.yml` that registered the hook. Derived from the hook's origin (home or project).
- `usesTarget?: string` — Raw `uses` value from YAML config, present only for alias hooks. Used by error formatting to include provenance in diagnostic messages.

### Invocation Result Policy

`executeHooks` accepts an optional tenth argument, an invocation-bound `InvocationResultPolicy`. Omitting it uses the same permissive result policy as the Claude adapter. The first nine arguments retain their existing meanings. These contracts are private engine types, not hook-author API additions. Codex supplies event-bound policies for all ten target events. The PreToolUse gate passed; expanded Docker validation has passed. Codex sets `deferRuntimeErrorAudit`: ordinary errors are captured and configured onError/counter accounting runs first; only a selected blocking error is then audited. Sequential failure writes precede this audit; parallel captured counters are persisted before deferred blocking audits. Continue/trace and threshold degradation do not become premature capability refusals. Author-capability failures and parallel-contract violations remain immediate. This correction is implemented and has passed full Docker validation.

Every completed lifecycle value is audited before handoff, input merging, vote reduction or the parallel short-circuit decision. `LifecycleResult.origin` distinguishes a beforeHook block/skip from a handler result. The handler value is checked after afterHook completes because the observer receives that object by reference and can mutate it. An attempted afterHook override remains ignored, and malformed beforeHook returns retain Claude's warning/no-op behavior.

The policy sees the raw value, hook identity, origin, execution mode and current tool input. Accepted results and optional full `nextToolInput` candidates are deeply detached before consumption, preserving opaque JSON keys. A supplied candidate replaces pipeline input without a second patch merge. Without a candidate, Claude keeps its existing shallow patch/null behavior and mutable hook-visible input; an injected policy gets detached tool-input views. Generated load failures, engine errors and parallel contract violations have distinct origins. Parallel updatedInput requests, including empty objects and malformed skip-plus-update returns, are checked before any handoff.

The optional `validateRawResult()` preflight runs inside protected policy evaluation **before** deep cloning. Codex uses descriptor-based shape checks to reject accessors, symbol/non-enumerable properties, cycles, sparse or extended arrays, non-finite numbers and other values that cloning/JSON would lose; undefined object fields remain no-ops. Its concrete policy permits PreToolUse allow/block/skip and handler-only ask, supported string context/debug fields and sequential allow/ask rewrites through an approved codec. Ask accepts any string reason, including empty, plus an optional verbatim nonblank question of at most 512 JavaScript UTF-16 code units. Invalid questions reject the whole ask before interaction or effects on both agents. Other-event handler asks, defer, unsupported fields and blank block reasons are refused. A dynamically returned beforeHook ask instead receives the shared lifecycle's warning/no-op treatment and the handler continues, with no confirmation or independent denial. Policy rejection of a supplied before-hook-origin ask is defensive; production lifecycle handling does not forward it. Allow reasons become human system-message annotations; they are removed from the accepted control result. These rules do not tighten Claude's otherwise permissive author surface.

The current live-checkpoint integration collects private `ExecutionResult.preToolUse`
metadata for both agents: accepted votes, raw accepted results and input
snapshots, approved questions, final materialized input and completion status.
Collection applies to every PreToolUse, not an optional policy flag.
Optional executor arguments 11/12 carry `ApprovalInteraction` and invocation
`AbortSignal`; the existing tenth policy argument is unchanged. Compiled engine
validation does not establish native generated-registration conformance.

`InvocationResultPolicy.mutableToolInput` preserves the legacy Claude shared
input view through policy wrapping; policies without that flag receive detached
views. Ordinary Claude allow-patch merging retains its legacy semantics, while
ask patches are strictly validated before presenting an operation for consent.

Sequential asks wait after lifecycle/policy audit and before committing their
candidate input or starting the next hook. Parallel hooks retain concurrent
startup; their asks follow whole-batch audit in configured order. A known denial
suppresses questions, but defer does not. Failures of consent or transport latch
outside `onError`/`maxFailures`; user decline is not a hook crash. Approved asks
carry private `resolvedAsk` bookkeeping and contribute as allows to reduction,
without rewriting raw history. `ctx.turn` stays at the invocation-start snapshot:
the committed raw ask is visible to the next invocation, not the next hook in
this pipeline, subject to [turn-state persistence limits](../turn-state.md).
After final serialization, changed operations
are reconfirmed in checkpoint order without rerunning hooks. See
[Shared Interactive Approval Transport](../interactive-approvals/engine-checkpoints.md#engine-checkpoints).
The former token-retry reducer/consumption path and its native receipts are
[historical](../codex-approvals.md), not evidence for this new execution flow.

A rejection is retained as `policyFailure` outside ordinary reduction and error degradation. It stops later execution and result effects, so a losing vote, subsequent allow, trace or maxFailures setting cannot erase it. Exceptions in policy evaluation become a policy failure rather than a configurable hook crash. Raw-history classification is also protected: a throwing result getter records one raw error and latches a policy failure. Settlement-processing exceptions close and resolve the parallel batch instead of leaving its promise pending. Agent-owned diagnostic composition remains separate from author-result checking.

Parallel batches check their closed state before storing any settlement. Capture precedes ordinary crash/block abort consumption, preserving accounting for already-captured outcomes. Author-capability and parallel-contract audits remain immediate; with Codex's deferred runtime-error audit, ordinary error accounting precedes auditing the selected blocking error. Each started lifecycle records its raw decision once; at abort, each still-pending lifecycle records one abandoned error. Later fulfillment or rejection cannot amend the batch, add diagnostics, create handoff files, vote or append history. A lifecycle timeout likewise records one raw error and discards its eventual completion. Each executor invocation owns its policy failure, input candidates and history bookkeeping, including when invocations overlap. History describes raw returns rather than accepted or delivered decisions; a rejected valid raw tag remains that tag. Unintelligible handler values record an error. Hook code remains trusted code: neither result policy nor JavaScript abort signals can undo its own arbitrary I/O.

Accepted PreToolUse skip contexts accumulate in configured vote order, not parallel completion order, alongside eligible winning-decision contexts. Skip remains abstention with the lowest rank; ties still select the last vote. Allow collects allow/skip context; ask collects its own plus allow/skip context; block collects its own plus allow/ask/skip context. Losing ask context is excluded when ask wins, and losing block context is always excluded. All-skip reductions retain every nonempty skip context, even when the last skip is empty. Defer still drops all context and warns for discarded loser context.

In the live-checkpoint path, these rules operate after approved asks are treated
as allow votes. Thus approved ask context is eligible alongside other allows;
the raw-ask reducer arm is not a substitute for obtaining consent.

### Ordering

Hook execution order is determined by `orderHooksForEvent()` in `src/ordering.ts`. There are two modes:

1. **No order list** — Parallel hooks are hoisted to the front, sequential hooks follow. Declaration order is preserved within each group.
2. **Order list exists** (`EventEntry.order`) — The ordered hooks go in the positions specified by the list. Unordered parallel hooks go at the beginning, unordered sequential hooks go at the end. Original matched order is preserved within unordered groups.

### Order list validation

The order list (`EventEntry.order`) is validated at two levels:

- **Config-time** — Names in the order list must be defined hooks in the config (validated by `validateConfig()`).
- **Runtime** — Names in the order list must appear in the matched hook set for the current event. If an order list references a hook that does not handle the event (i.e., it was filtered out by `matchHooksForEvent()`), `orderHooksForEvent()` throws with a descriptive error. This is a structural/config error — the engine cannot proceed with an invalid order list. **Exception:** hooks skipped by the engine — `enabled: false`, or an `agents` list that does not contain the invoking agent — are silently skipped in the order list (not an error), so one `order:` list stays valid under every agent. See `docs/domain/config/agents.md` for the allowlist cascade.

### Partitioning

After ordering, `partitionIntoGroups()` walks the ordered list and starts a new group whenever the `parallel` flag changes. The result is a sequence of `ExecutionGroup` objects, each with a `type` ("parallel" or "sequential") and a list of hooks.

Example: given hooks `[par-A, par-B, seq-C, seq-D, par-E]`, the groups would be:
1. `parallel: [par-A, par-B]`
2. `sequential: [seq-C, seq-D]`
3. `parallel: [par-E]`

A diagnostic warning is emitted when a single parallel hook is sandwiched between sequential groups (functionally equivalent to sequential).

### Group execution

- **Sequential groups** — Hooks run one at a time. Each hook receives `toolInput` as the merge-so-far: the original tool input with every prior sequential hook's `updatedInput` patch shallow-merged on top in execution order. `updatedInput` is a **partial patch**, not a full replacement — keys whose patch value was literal `null` are stripped at each merge step (the explicit-unset sentinel), so a prior-hook unset surfaces as an **absent** key in downstream `ctx.toolInput`, not as the literal `null`. A block result stops the group and the pipeline. **Exception (PreToolUse only):** `block` is a structured deny vote, not a pipeline stop — later hooks can still contribute unless an approval refusal or execution failure stops the pipeline. Crashed hooks under `onError: "block"` still short-circuit.
- **Parallel groups** — All hooks in the group start concurrently. They all see the same `toolInput` snapshot. A short-circuit mechanism aborts remaining hooks when a block or contract violation (`updatedInput` in parallel mode) is detected. Results are merged after all hooks settle (or short-circuit). **Exception (PreToolUse only):** structured `block` results do not trigger the short-circuit abort — they are pushed to the vote accumulator. Contract violations and crashed hooks under `onError: "block"` still short-circuit.

With `CLOOKS_DEBUG=true`, Claude emits debug lines to stderr and also appends them to context on injectable events. PreToolUse skip therefore emits debug `additionalContext` without a permission decision; a failed debug-log file write does not change this routing. Codex keeps debug lines on stderr only. Explicitly returned `injectContext` remains separate from debug routing.

## Circuit Breaker

A hook+event pair that fails N consecutive times (default 3) enters "degraded mode." In degraded mode the hook's *block* is suppressed — the hook itself still executes on every single invocation, inside a safe try/catch. There is no execution quarantine: every matched hook is passed to the runner unconditionally, and the failure count is consulted only *after* a hook has thrown, to decide whether that crash blocks or merely degrades. (Consequently a degraded hook still appears in its own `ctx.turn` history; see [Turn State](../turn-state.md).) Lifecycle method failures (`beforeHook` and `afterHook` throws) share the hook's `(hookName, eventName)` failure counter — they are not tracked separately from handler failures. If it succeeds, the failure counter resets and the hook resumes normal operation automatically.

**State storage:** Failure state is persisted in `.clooks/.failures` (JSON, gitignored). The file is managed entirely by the engine. It is created on first failure, updated on subsequent failures, and deleted when all hooks are healthy. The in-memory type is `FailureState = Record<HookName, Partial<Record<EventName, HookEventFailure>>>` — both dimensions are branded, preventing key confusion between hook names and event names.

**Agent-aware paths:** The engine calls `getFailureLocation()` with `adapter.id`. Its `FailureLocation` result is a legacy path string for Claude or `{ path, root }` for Codex, carried through the existing executor failure argument into reads, writes and recovery clearing. `getFailurePath()` still computes Codex `<projectRoot>/.clooks/.cache/agents/codex/failures.json` with project config or `<homeRoot>/.clooks/failures/codex/<hash>.json` without it (first 12 hex characters of `SHA-256(projectRoot)`). The managed root is respectively projectRoot or homeRoot. Claude retains its existing project/home paths, string-path I/O and counter schema.

**Codex managed failure I/O:** Every managed parent component beneath the selected root must be a real directory, starting at `.clooks`; relative escapes and resolved directories outside that root are rejected. Missing directories are created with mode 0700 only for nonempty writes. Reads open with `O_NOFOLLOW | O_NONBLOCK` and require a single-link regular file on the opened descriptor. Writes and clearing reject existing symlinks, nonregular files and multiply linked files. Nonempty writes use an exclusive same-directory 0600 staging file, recheck parents and destination, then rename atomically and clean up staging. Empty state unlinks only a validated destination and does not create directories. Missing state reads as empty; invalid managed locations reject rather than reading another agent's counters. These checks address accidental state aliasing, not hostile concurrent filesystem mutation or a new repository trust model. Corrected-source Docker validation has passed.

`getConfigFailurePath()` preserves Claude's historical project `.clooks/.failures` path and routes Codex config errors through its agent-aware path. The engine detects whether a distinct project config file exists before loading, so a home-only Codex config failure does not create project-local failure storage. Codex config failures identify/normalize the input before recording counters: below the default failure threshold, a supported event receives a translated refusal; at threshold, final translation carries a human degradation notice without importing hooks. Malformed or unsupported input remains an invocation failure rather than a fabricated config event. These paths are implemented and Docker-validated, not evidence of native refusal.

**File format:**

```json
{
  "hook-name": {
    "PreToolUse": {
      "consecutiveFailures": 3,
      "lastError": "Cannot find module '@clooks/utils'",
      "lastFailedAt": "2026-03-09T10:15:00Z"
    }
  }
}
```

**Reminder delivery:** When a degraded hook is skipped, a reminder message is injected into the agent's context via `injectContext` / `additionalContext` for injectable events (PreToolUse, UserPromptSubmit, SessionStart, PostToolUse, PostToolUseFailure, Notification, SubagentStart). For non-injectable events, the message is written to stderr.

**Disabling:** Set `maxFailures: 0` on a hook entry to disable the circuit breaker for that hook. It will always fail-closed regardless of how many times it fails.

**Load errors:** Hooks that fail to import (file exists but has syntax errors, missing dependencies, etc.) are routed through the circuit breaker. `loadAllHooks` is fault-tolerant — it uses `Promise.allSettled` and returns load errors alongside successfully loaded hooks. The engine processes load errors through the same threshold logic as execution errors. Note: "load error" specifically means the source file exists but could not be imported. A missing source file for a plugin-vendored hook is a "dangling hook" — see below.

**Dangling hooks:** Plugin-vendored hooks whose source file does not exist on disk (detected by `existsSync()` before import) are classified as "dangling" and bypass the circuit breaker entirely. They produce a `systemMessage` warning on every invocation but never block the action. Dangling registrations are an expected lifecycle state (e.g., plugin uninstall deletes the vendor file), not a runtime error. Dangling detection applies only to plugin-vendored hooks (paths containing `vendor/plugin/`); non-plugin hooks with missing files still go through the normal load error → circuit breaker path. The loader returns dangling hooks as a separate `DanglingHook[]` array in `LoadAllHooksResult`, distinct from `loadErrors`. The engine clears any stale circuit breaker state for newly-dangling hooks.

## Key Files

- `src/ordering.ts` — `orderHooksForEvent()`, `partitionIntoGroups()`.
- `src/failures.ts` — `getFailurePath()`, `readFailures()`, `writeFailures()`, `recordFailure()`, `clearFailure()`.
- `src/engine/run.ts` — `runEngine()`, invocation and final-output orchestration.
- `src/engine/execute.ts` — group execution, result audit, reduction and raw-history recording.
- `src/engine/result-policy.ts` — legacy policy and detached policy evaluation.
- `src/loader.ts` — `loadAllHooks()`, dangling detection, load error routing.

## Related

- `docs/domain/config.md` — Config format, validation, merge rules, cascade rules.
- `docs/domain/global-hooks.md` — Home-only circuit breaker and hash-based failure paths.
