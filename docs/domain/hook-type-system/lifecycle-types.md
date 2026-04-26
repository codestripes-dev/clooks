# Hook Type System — Lifecycle Types

`beforeHook` and `afterHook` lifecycle methods on `ClooksHook` objects, and the type machinery that supports them.

## Overview

Hook authors can define optional `beforeHook` and `afterHook` methods on their `ClooksHook` objects. These lifecycle methods run before and after the matched event handler, enabling cross-cutting concerns like environment gating, timing, and observation.

`beforeHook` returns one of three universal verbs (`event.block`, `event.skip`, `event.passthrough`) or `void`. `afterHook` is a pure observer with one verb (`event.passthrough`) — it can read `event.handlerResult` typed once narrowed on `event.type`, but it cannot mutate the result.

## Why afterHook is observer-only

There are no clearly-reasonable use cases for afterHook override. Lifecycle methods are per-hook self-only (the contract explicitly excludes meta-hook wrapping), so compliance/audit/cross-cutting overrides are architecturally out of scope; dry-run / config-flag rewrites are cleaner expressed in the per-event handler with `if (config.dryRun) return ctx.allow(...)`; quota / rate-limit patterns require external state regardless of where the check lives.

Keeping afterHook observer-only avoids the per-event method universe, the `MethodsForEvent<K>` derivation gap, and the passthrough-vs-tag-matching footgun. If override demand emerges later, it can be added as a non-breaking type-union widening on `ClooksHook['afterHook']`.

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

**`BeforeHookEvent`** — Discriminated union for `beforeHook`. Narrows `event.input` by `event.type`. Carries three universal constructor methods (same shape regardless of `type`):

| Method | Signature | Returns |
|--------|-----------|---------|
| `event.block(opts)` | `(opts: BlockOpts) => BlockResult` | Short-circuits the hook with a block decision |
| `event.skip(opts?)` | `(opts?: SkipOpts) => SkipResult` | Makes the hook invisible — handler and afterHook do NOT run |
| `event.passthrough(opts?)` | `(opts?: { debugMessage? }) => LifecyclePassthroughResult` | No-op with optional breadcrumb; handler runs |

Returning `void` is equivalent to `event.passthrough()` with no breadcrumb.

```typescript
// Example: tmux-notifications style centralized environment gate
beforeHook(event) {
  if (!process.env.TMUX) {
    return event.skip({ debugMessage: 'not in a tmux session' })
  }
  if (event.type === 'PreToolUse' && event.input.toolName === 'Bash') {
    return event.block({ reason: 'Bash gated by lifecycle' })
  }
  return event.passthrough({ debugMessage: 'gate passed' })
}
```

**`AfterHookEvent`** — Discriminated union for `afterHook`. Observer-only — narrows `event.input` and `event.handlerResult` by `event.type`, exposes only `event.passthrough()`:

```typescript
afterHook(event) {
  if (event.type === 'PreToolUse') {
    // event.handlerResult is typed as PreToolUseResult after narrowing
    if (event.handlerResult.result === 'allow') {
      console.log('PreToolUse allowed:', event.handlerResult.updatedInput)
    }
  }
  return event.passthrough({ debugMessage: 'observed' })
}
```

`afterHook` cannot return `event.block(...)` / `event.skip(...)` / etc. — those methods do not exist on `AfterHookEvent`, and the return-type signature does not accept those discriminants. Authors who want to drive the handler's result should put the logic in the per-event handler (which can return any result it wants).

**`LifecyclePassthroughResult`** — Lifecycle-internal sentinel returned by `event.passthrough()` on both slots. `@internal`-tagged — appears in the bundled `.d.ts` because both lifecycle method signatures reference it, but authors should not construct it directly. Not added to `ResultTag`; consumed inside `runHookLifecycle` and never reaches the per-event pipeline.

## ClooksHook extension

`ClooksHook<C>` has two optional methods:

```typescript
beforeHook?: (
  event: BeforeHookEvent,
  config: C,
) => MaybeAsync<BlockResult | SkipResult | LifecyclePassthroughResult | void>

afterHook?: (
  event: AfterHookEvent,
  config: C,
) => MaybeAsync<LifecyclePassthroughResult | void>
```

Both communicate results through the return value. Returning `void` is the no-op path on either slot; the engine treats it as `passthrough()` with no breadcrumb.

## Runtime validation

`validateHookExport()` in `src/loader.ts` enumerates allowed property keys on hook objects: `meta`, `beforeHook`, `afterHook`, plus all 22 event names. Unknown keys (e.g., typos like `beforHook`) produce a descriptive error listing the allowed names.

If a lifecycle method returns an object with an unrecognized `result` discriminant (most commonly: an `as any` cast slipping a wrong-slot result through), `runHookLifecycle` writes a stderr warning naming the hook, the slot, and the unexpected tag, then treats the return as a no-op.
