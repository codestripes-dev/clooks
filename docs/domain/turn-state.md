# Turn State (`ctx.turn`)

Per-hook memory of what a hook already did during the current turn. This is what makes "remind exactly once per turn" a one-line expression instead of a transcript-parsing subsystem each hook author has to build.

## Overview

A **turn** is one user prompt and everything the agent does in response to it, up to the next prompt. Every hook context carries a `turn` field describing *that hook's own* prior runs during *this* turn:

```ts
turn: {
  prior: TurnRecord[]        // completed prior runs of this hook this turn, oldest first
  priorRuns: number          // how many of those were on the current event
  priorInterventions: number // how many of those actually intervened, on the current event
}
```

The once-per-turn pattern:

```ts
export default {
  Stop(ctx) {
    if (ctx.turn.priorInterventions > 0) return ctx.skip()
    return ctx.block({ reason: 'Remember to lint the files you changed.' })
  },
}
```

Scoping of the three fields is deliberately asymmetric. `prior` spans **every event** this hook ran on during the turn, oldest first. `priorRuns` and `priorInterventions` count **only** the entries whose `event` equals the current event. A hook registered on both `PostToolUse` and `Stop` therefore sees all of its runs in `prior`, but while running on `Stop` its counters describe prior `Stop` runs only.

A hook sees only its own history. There is no cross-hook visibility, now or planned.

## Key Files

| Path | Purpose |
|------|---------|
| `src/types/turn.ts` | `TurnDecision`, `TurnRecord`, `TurnContext` — the hook-author-facing types |
| `src/types/contexts.ts` | `BaseContext.turn`, required on all 22 event contexts |
| `src/engine/turn-state.ts` | The whole subsystem: pure rules, storage, lock, prune, tracker |
| `src/engine/run.ts` | Turn boundary, prune, snapshot, tracker construction |
| `src/engine/execute.ts` | `ctx.turn` injection and the seven recording points |
| `src/testing/create-context.ts` | Supplies an empty `turn` to the `clooks test` harness |
| `test/e2e/turn-state.e2e.test.ts` | Behavior through the compiled binary |

## Patterns

### What counts as an intervention

The predicate reads the raw decision the hook returned, not what was ultimately delivered:

- `block` on any event.
- `continue` on `TeammateIdle`, `TaskCreated`, or `TaskCompleted`.
- `retry` on `PermissionDenied`.

Nothing else. A `UserPromptSubmit` block counts even though its reason goes to the human rather than the model — the hook intervened, which is the question being asked.

### Scope keys

Records are partitioned so a subagent's runs never appear in the main agent's `ctx.turn`. The key is derived from the normalized context:

- `JSON.stringify(['team', teamName ?? null, teammateName ?? null])` for `TeammateIdle`, `TaskCreated`, `TaskCompleted`. These payloads carry no agent identifier, so the pair of names is the only identity available. JSON encoding rather than a joined string because names are free-form and may contain any delimiter, and because an absent name must not collide with a teammate literally named `unknown`.
- `agent:<agentId>` for any other event whose normalized context carries an `agentId`.
- `main` otherwise.

`SubagentStart` and `SubagentStop` carry the referenced subagent's `agent_id`, so the general rule already files those records under the subagent with no special case.

### Turn boundary

| Event | Effect |
|-------|--------|
| `UserPromptSubmit` | Advance: clear all scopes, increment the generation |
| `SessionStart` source `startup` | Reset: clear all scopes, increment the generation |
| `SessionStart` source `clear` | Reset |
| `SessionStart` source `resume` | Preserve |
| `SessionStart` source `compact` | Preserve |
| `SessionStart`, unrecognized source | Preserve |
| Everything else | No boundary — records land in whatever turn is current |

Unrecognized sources take the non-destructive branch so a future upstream source value cannot start clearing turns by accident.

**Every destructive boundary increments the generation monotonically.** A reset never returns the counter to zero or to a default: an in-flight invocation holding the pre-boundary stamp must be able to detect that its turn ended, and an equal counter would let it write pre-boundary records straight back into the freshly cleared document.

A boundary occurs on **every** `UserPromptSubmit`, which is what makes a turn a turn. What is singular is the *emitter*: subagents never receive `UserPromptSubmit`, so the main agent's prompt is the only thing that can advance the turn, and when it does it clears every scope — subagents included.

Boundary maintenance and the `SessionStart` prune sit **before** the engine's early exits, so a project that registers no `UserPromptSubmit` hook still gets its turn boundary.

### What is and is not recorded

Every hook whose *lifecycle started* is recorded — that is, every hook `runHookLifecycle` was called for:

- Lifecycle returned a result → its tag. A `beforeHook`-produced `block` records as `block`; from the outside, the hook blocked.
- Lifecycle returned nothing → `skip`.
- Lifecycle threw, rejected, or timed out → `error`.
- Lifecycle abandoned by a parallel short circuit → `error`. The hook was started; its outcome is unknown.
- A result object carrying a tag outside the union → `error`. "Returned nothing" and "returned something unintelligible" are different events.

Degraded-mode hooks still record. Degraded mode suppresses the *block* a crash would cause; it does not stop the hook from executing, so a degraded hook that crashes again records `error` and one that recovers records its actual tag. There is no execution quarantine to exclude.

Exactly one class is never recorded: hooks whose module failed to import. They are handled before any runner is entered, so no lifecycle ever started.

Hooks in the same invocation do not appear in each other's `prior`. The snapshot is read once per invocation, before any hook runs, and every hook sees the same one — otherwise two hooks in a parallel batch would see different histories depending on scheduling.

## Storage

One JSON document per session at `<homeRoot>/.clooks/turn-state/<hash>.json`, where `hash` is the first 16 hex characters of `sha256(sessionId)`. The directory is 0700, files 0600. The raw session id is never written into a path or into the file.

```json
{
  "version": 1,
  "epoch": "9f3c1a77b2e40d51",
  "generation": 3,
  "updatedAt": "2026-08-04T10:12:33.041Z",
  "scopes": {
    "main": {
      "lint-reminder": [{ "event": "Stop", "decision": "block", "at": "2026-08-04T10:12:30.000Z" }]
    }
  }
}
```

`epoch` is random and reminted whenever a fresh document is created. The generation alone cannot identify a turn across a document being *replaced*: an unreadable, oversized, or unknown-version file collapses to generation 0, the next boundary writes generation 1, and an old tracker also holding generation 1 would compare equal. A snapshot therefore captures a **stamp** — epoch plus generation — and a commit proceeds only when both halves still match; otherwise the pending records are discarded wholesale, because they belong to a turn that has ended.

**Reads** go through a single no-follow descriptor: `open(O_RDONLY | O_NOFOLLOW)`, `fstat` that descriptor for the size bound, read the body through the same handle. Never a path-based stat-then-read, which follows symlinks and measures a different thing than it reads.

**Writes** happen once per invocation, at the end of `executeHooks`, under one lock acquisition: acquire, read, stamp check, bounded append, staging file with exclusive create, ownership re-check, atomic rename, release. Records are buffered in memory until then, so a hard crash before the commit loses that invocation's records. A crash *after* the lock was acquired costs more than that: the lockfile survives the process, and every subsequent invocation skips its write until the lock ages past the 60-second staleness threshold and someone takes it over. That is a benign degrade — records skipped, no decision overridden — but it is not confined to the crashed invocation.

**The lock** (`<hash>.json.lock`) is *owned*, not boolean. Each acquisition writes a fresh random token; the holder re-reads the lockfile through a no-follow descriptor and compares tokens immediately before the commit rename and again before the release unlink, abandoning on a mismatch. Takeover of a stale lock is a `rename` of the lockfile aside — atomic for exactly one caller — never unlink-then-create, which would let two contenders both believe they hold it. The 60-second staleness threshold buys *rarity*, not safety: no fixed timeout can guarantee a suspended-but-live owner is never taken over. Acquisition waits at most 200 ms and then skips the write.

What the protocol actually guarantees is the integrity of the document that is already on disk: staging plus atomic rename means a reader sees the old document or the new one and never a mixture, and the ownership check means an owner that was taken over while paused abandons instead of clobbering the new holder's file. It does **not** guarantee that every record lands. The verify-then-rename and verify-then-unlink windows are narrowed but cannot be closed — POSIX has no compare-and-rename and no compare-and-unlink — and a leaked lockfile wedges writes for up to a minute. Reaching the residual takes a pause of over a minute inside a millisecond-scale critical section, and its worst outcome is one clobbered write or one prematurely unlinked lockfile: lost turn records, never corruption beyond turn state.

**Two ceilings**, both dropping the *new* record and never an existing one:

- Per (scope, hook): at most 200 records.
- Whole document: 1 MiB, measured on the serialized bytes before staging.

Newest-dropped is not a preference, it is a requirement: truncating the oldest could erase the single earlier intervention a dedup hook branches on. The byte ceiling is separate from the record ceiling because hook names come from user configuration and scope keys from agent payloads — both unbounded strings — so a document can exceed the read bound long before any hook reaches 200 records, and a document over the read bound would be rejected on the next read and silently reset the turn. The per-hook ceiling is per-hook rather than global so one hammering hook cannot starve an unrelated hook's first intervention.

**Pruning** runs at `SessionStart`, after a `realpath` containment check and per-component symlink refusal, over regular files only: session files older than 24 hours, lockfiles and `.stale-*` takeover leftovers older than 60 seconds, leaked `*.tmp` staging files older than 24 hours, then a 200-file cap enforced oldest-first.

## Gotchas

### `ctx.turn` is an optimization signal, not a guarantee

State the guarantee precisely, because the loose version of it is wrong. Turn-state I/O never throws into the runner, never triggers a hook's `onError` path, never blocks, and never *directly* overrides the result a hook returned. At most one warning line reaches standard error per invocation. What it does not promise is that the hook decides the same thing it would have decided with healthy storage — a hook that reads `ctx.turn` is *supposed* to branch on it, so a wrong history produces a different decision by design, and the two failure directions are opposites:

- **A snapshot failure** (the read, or the whole subsystem) yields an empty history. A dedup hook sees no prior intervention and intervenes one extra time. Noisy, harmless.
- **A boundary failure** (the `UserPromptSubmit` or `SessionStart` write) preserves stale history into a turn that should have started clean. A dedup hook that already intervened last turn stays silent — a *missed* intervention. This is the more consequential direction: the hook does nothing when it should have acted.

Both are indirect: the engine delivered the hook's own decision faithfully, on the basis of a history that was wrong.

A hook cannot distinguish "no history" from "storage broke". There is deliberately no `available` flag. Do not build a safety-critical guarantee on `ctx.turn`.

### Turn state is not the circuit breaker

`.failures` counts *consecutive failures per hook per event* to decide whether a crash should block, and it clears on success. Turn state records *every* started lifecycle regardless of outcome, scoped to a turn, and clears at turn boundaries. They answer different questions and neither is derivable from the other.

### A cold-start concurrent batch keeps one writer's records

Every process that finds no document mints its own random epoch. If several invocations race with no file on disk, the first to commit creates the document and the rest fail their stamp check and are discarded — by design, since a differing epoch is exactly the signal "this is not the document I read". Once a document exists, concurrent writers share its stamp and the lock serializes them normally. The consequence is bounded: at most one turn's worth of very-early records, and only in the fail-safe's benign direction.

### No configuration surface

`ctx.turn` is unconditional engine behavior, like `ctx.parallel` or `ctx.signal`. Nothing in `clooks.yml` turns it on or off, and `bun run generate:schema` must stay a no-op for it.

### Records are sorted on read, not on append

Concurrent invocations can commit out of chronological order, so the on-disk array is not guaranteed sorted. `materializeTurn` sorts by timestamp ascending. Do not assume append order is time order.

### `clooks test` does no turn-state I/O

The harness synthesizes an empty `ctx.turn` and accepts a `turn` object in its input JSON as an override. It never reads or writes the real store, so a debugging tool cannot depend on invisible global state or pollute a user's home directory with fake sessions.

## Related

- [Hook Type System — Patterns](hook-type-system/patterns.md) — `BaseContext`, including `turn`
- [Claude Code Hooks — Behavior & Gotchas](claude-code-hooks/behavior-and-gotchas.md) — `stop_hook_active` versus `ctx.turn`
- [Config — Execution & Circuit Breaker](config/execution.md) — `.failures` semantics
- [Config — Handoff](config/handoff.md) — the housekeeping precedent this subsystem's hardening is copied from
