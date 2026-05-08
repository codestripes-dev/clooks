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

### Ordering

Hook execution order is determined by `orderHooksForEvent()` in `src/ordering.ts`. There are two modes:

1. **No order list** — Parallel hooks are hoisted to the front, sequential hooks follow. Declaration order is preserved within each group.
2. **Order list exists** (`EventEntry.order`) — The ordered hooks go in the positions specified by the list. Unordered parallel hooks go at the beginning, unordered sequential hooks go at the end. Original matched order is preserved within unordered groups.

### Order list validation

The order list (`EventEntry.order`) is validated at two levels:

- **Config-time** — Names in the order list must be defined hooks in the config (validated by `validateConfig()`).
- **Runtime** — Names in the order list must appear in the matched hook set for the current event. If an order list references a hook that does not handle the event (i.e., it was filtered out by `matchHooksForEvent()`), `orderHooksForEvent()` throws with a descriptive error. This is a structural/config error — the engine cannot proceed with an invalid order list. **Exception:** hooks disabled via `enabled: false` are silently skipped in the order list (not an error).

### Partitioning

After ordering, `partitionIntoGroups()` walks the ordered list and starts a new group whenever the `parallel` flag changes. The result is a sequence of `ExecutionGroup` objects, each with a `type` ("parallel" or "sequential") and a list of hooks.

Example: given hooks `[par-A, par-B, seq-C, seq-D, par-E]`, the groups would be:
1. `parallel: [par-A, par-B]`
2. `sequential: [seq-C, seq-D]`
3. `parallel: [par-E]`

A diagnostic warning is emitted when a single parallel hook is sandwiched between sequential groups (functionally equivalent to sequential).

### Group execution

- **Sequential groups** — Hooks run one at a time. Each hook receives `toolInput` as the merge-so-far: the original tool input with every prior sequential hook's `updatedInput` patch shallow-merged on top in execution order. `updatedInput` is a **partial patch**, not a full replacement — keys whose patch value was literal `null` are stripped at each merge step (the explicit-unset sentinel), so a prior-hook unset surfaces as an **absent** key in downstream `ctx.toolInput`, not as the literal `null`. A block result stops the group and the pipeline. **Exception (PreToolUse only):** `block` is a structured deny vote, not a pipeline stop — execution continues so every hook contributes to the `deny > defer > ask > allow` reduction. Crashed hooks under `onError: "block"` still short-circuit.
- **Parallel groups** — All hooks in the group start concurrently. They all see the same `toolInput` snapshot. A short-circuit mechanism aborts remaining hooks when a block or contract violation (`updatedInput` in parallel mode) is detected. Results are merged after all hooks settle (or short-circuit). **Exception (PreToolUse only):** structured `block` results do not trigger the short-circuit abort — they are pushed to the vote accumulator. Contract violations and crashed hooks under `onError: "block"` still short-circuit.

## Circuit Breaker

A hook+event pair that fails N consecutive times (default 3) enters "degraded mode." In degraded mode the hook is skipped instead of blocking, but it is still retried on every invocation inside a safe try/catch. Lifecycle method failures (`beforeHook` and `afterHook` throws) share the hook's `(hookName, eventName)` failure counter — they are not tracked separately from handler failures. If it succeeds, the failure counter resets and the hook resumes normal operation automatically.

**State storage:** Failure state is persisted in `.clooks/.failures` (JSON, gitignored). The file is managed entirely by the engine. It is created on first failure, updated on subsequent failures, and deleted when all hooks are healthy. The in-memory type is `FailureState = Record<HookName, Partial<Record<EventName, HookEventFailure>>>` — both dimensions are branded, preventing key confusion between hook names and event names.

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
- `src/engine/run.ts` — `runEngine()`, group execution logic.
- `src/loader.ts` — `loadAllHooks()`, dangling detection, load error routing.

## Related

- `docs/domain/config.md` — Config format, validation, merge rules, cascade rules.
- `docs/domain/global-hooks.md` — Home-only circuit breaker and hash-based failure paths.
