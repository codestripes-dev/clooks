# Hook Type System — Lifecycle Types

`beforeHook` and `afterHook` lifecycle methods on `ClooksHook` objects, and the type machinery that supports them.

## Overview

Hook authors can define optional `beforeHook` and `afterHook` methods on their `ClooksHook` objects. These lifecycle methods run before and after the matched event handler, enabling cross-cutting concerns like environment gating, timing, and result inspection/override.

## Type definitions

All lifecycle types live in `src/types/lifecycle.ts` and are re-exported from `src/types/index.ts`.

**`EventContextMap` and `EventResultMap`** — Mapped types that associate each `EventName` with its context and result type. Used internally to generate the discriminated union types. Also independently useful for generic hook utilities that need to map over all events.

**`HookEventMeta`** — Environment metadata carried by lifecycle events:

| Field | Type | Description |
|-------|------|-------------|
| `gitRoot` | `string \| null` | Repo root via `git rev-parse --show-toplevel` |
| `gitBranch` | `string \| null` | Current branch (null if detached HEAD) |
| `platform` | `"darwin" \| "linux"` | OS platform |
| `hookName` | `string` | This hook's name (same as `meta.name`) |
| `hookPath` | `string` | Absolute path to the hook's `.ts` file |
| `timestamp` | `string` | ISO 8601 timestamp of engine invocation start |
| `clooksVersion` | `string` | Runtime version string |
| `configPath` | `string` | Path to the `clooks.yml` that registered this hook |

**`BeforeHookEvent`** — Discriminated union for `beforeHook`. Narrows `event.input` by `event.type`. The `respond()` callback accepts `BlockResult | SkipResult` — `beforeHook` can block the action or skip the hook entirely. Not calling `respond()` proceeds to the handler.

```typescript
// After narrowing on event.type:
if (event.type === "PreToolUse") {
  event.input.toolName  // ✅ narrowed to PreToolUseContext
  event.respond({ result: "block", reason: "gated" })  // ✅ BlockResult
  event.respond({ result: "skip" })  // ✅ SkipResult — hook becomes invisible
}
```

**`AfterHookEvent`** — Discriminated union for `afterHook`. Both `handlerResult` and `respond()` narrow together with `type`. The `respond()` callback pattern provides compile-time type safety that return-based overrides cannot achieve (TypeScript does not narrow return types based on discriminant checks).

```typescript
if (event.type === "PreToolUse") {
  event.handlerResult  // narrowed to PreToolUseResult
  event.respond({ result: "allow" })  // ✅ accepts PreToolUseResult
}
```

## ClooksHook extension

`ClooksHook<C>` has two optional methods:

```typescript
beforeHook?: (event: BeforeHookEvent, config: C) => MaybeAsync<void>
afterHook?: (event: AfterHookEvent, config: C) => MaybeAsync<void>
```

Both communicate results through the `respond()` callback, not through return values. If `respond()` is not called, the lifecycle phase is a no-op.

## Runtime validation

`validateHookExport()` in `src/loader.ts` enumerates allowed property keys on hook objects: `meta`, `beforeHook`, `afterHook`, plus all 22 event names. Unknown keys (e.g., typos like `beforHook`) produce a descriptive error listing the allowed names.
