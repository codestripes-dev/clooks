# Hook Type System — Decision Methods

Per-event decision methods on context objects (`ctx.allow`, `ctx.block`, `ctx.skip`, etc.), the runtime that attaches them, and the type-composition primitive vocabulary they're built from.

## Decision methods

Every context object carries per-event **decision methods** — `ctx.allow(...)`, `ctx.block(...)`, `ctx.skip(...)`, etc. — that construct the correct `*Result` shape without a hand-rolled object literal. This is the canonical idiom for returning from a handler (FEAT-0063).

**Motivation.** TypeScript cannot narrow a handler's *return type* by a discriminant check inside the handler body. `return { result: 'allow', updatedInput: {...} }` on a narrowed `ctx.toolName === 'Bash'` branch was structurally accepted even when `updatedInput` carried a `filePath` key (wrong tool). Attaching methods to the *context* variant sidesteps the limitation: each narrowed variant carries its own per-tool-typed `allow` / `ask` / `block` / `defer` / `skip` signature, so `ctx.allow({ updatedInput: { filePath: '/tmp' } })` inside a `Bash` arm is now a compile-time error.

**Per-event method set.** Each of the 22 events gets a method set matching its result category (guard / observe / implementation / continuation / notify-only). The per-event tables live in `docs/domain/claude-code-hooks/events.md`; `docs/domain/claude-code-hooks/io-contract.md` lists the legal verbs per event. **Composition pattern (post-PLAN-FEAT-0064):** the 20 non-generic per-event method-set types in `src/types/decision-methods.ts` and the two generic tool-keyed types in `src/types/contexts.ts` (`PreToolUseDecisionMethods<Input>`, `PermissionRequestDecisionMethods<Input>`) are all intersections over named primitives. The two generics ride `Patch<Input>` inline through their per-method opts shapes — e.g. `Allow<{ updatedInput?: Patch<Input>; reason?: string } & DebugMessage & Inject, PreToolUseResult>`. The canonical design vocabulary lives in `src/types/method-primitives.ts` — field-bag primitives (`DebugMessage`, `Inject`, `Reason`, `Feedback`, `Path`, `SessionTitle`, `UpdatedPermissions`, `UpdatedMcpToolOutput`, `Interrupt`) and method-shape primitives (`Allow`, `Block`, `Skip`, `Ask`, `Defer`, `Continue`, `Stop`, `Retry`, `Success`, `Failure`). A representative composition reads `StopDecisionMethods = Allow<DebugMessage, StopEventResult> & Block<Reason, StopEventResult> & Skip<DebugMessage, StopEventResult>`. See `### Type-composition primitives` below for the full vocabulary.

**`Patch<T>` utility.** The tool-keyed events (`PreToolUse`, `PermissionRequest`) type `updatedInput` as `Patch<ToolInput>`. `Patch<T>` (in `src/types/patch.ts`) is a partial-merge type that permits `null` only on **optional** keys (via an `OptionalKeys<T>` helper). `null` is the engine's explicit-unset sentinel (FEAT-0061) — the engine's `omitBy(..., isNull)` strips `null`-valued keys post-merge. Permitting `null` on a required key (e.g. `{ command: null }` on `Patch<BashToolInput>`) would strip `command` and send Bash upstream with no command; `OptionalKeys<T>` makes that a TypeScript error. See the JSDoc on `src/types/patch.ts` for the `undefined` / absent vs `null` semantics — the wire-level absence of an `undefined`-valued key comes from `JSON.stringify` dropping undefined keys, not from any engine stripping.

**`createContext` test helper.** `createContext(event, payload)` in `src/testing/create-context.ts` builds a fully-attached context object for tests. It lives in the `@clooks/testing` surface (`src/testing/`), **not** `@clooks/types` — re-exporting from `src/types/index.ts` would pull engine-runtime imports through the type-only package barrel. Test fixtures replace hand-rolled object-literals with `createContext('PreToolUse', { toolName: 'Bash', toolInput: { command: 'ls' } })` so the ctx they build is indistinguishable from the one the engine hands to a real hook.

**JSDoc convention for confusion-prone methods.** Methods whose names collide with a nearby concept carry inline JSDoc spelling the distinction out:
- `StopContext.block` (the `Stop` guard event's block) vs continuation events' `stop` result — different verbs, similar English.
- Three different `continue` semantics: continuation events (`TeammateIdle` / `TaskCreated` / `TaskCompleted`) return `ctx.continue()` as a first-class result; `onError: 'continue'` is an engine-config mode that proceeds past a crashed hook; the `continue` field on upstream Claude Code hook JSON is a distinct wire concept.
- `StopFailure.skip()` carries a "wasted work" caveat — `StopFailure` is notify-only, so upstream drops the output; the method exists for API symmetry so authors don't have to remember which events are notify-only, but any side-effectful work done to build the result is discarded.
- `PostToolUse.block` accepts `updatedMCPToolOutput?: unknown` typed loosely because `PostToolUseContext` is flat (not DU-promoted) and `toolName: string` doesn't narrow — the field is MCP-only at the upstream contract level; non-MCP tools silently ignore it. The MCP-only caveat lives on the `UpdatedMcpToolOutput` primitive declaration in `src/types/method-primitives.ts`.
- `PreToolUseDecisionMethods<Input>.defer` is honored only in `claude -p` mode AND only when the turn contains a single tool call; requires Claude Code v2.1.89+.
- `UserPromptSubmit.allow.sessionTitle` (and the other `sessionTitle`-bearing arms) is equivalent to running `/rename`; whether upstream honors it on a `block` arm is unverified — caveat lives on the `SessionTitle` primitive declaration.

## Decision method runtime

`attachDecisionMethods(eventName, ctx)` in `src/engine/context-methods.ts` is the runtime half of the decision-method system:

- **Mutates in place** via `Object.assign(ctx, METHOD_SETS[eventName])` — no new object, no proxy. Callers pass the engine's constructed context and get the same reference back, enriched.
- **Called once per `runHookLifecycle` invocation**, immediately before `beforeHook` and the main handler run. Both lifecycle phases observe the same enriched ctx. The attach site is the single funnel for both `executeSequentialGroup` and `executeParallelGroup`.
- **Idempotent.** Re-calling `attachDecisionMethods` on an already-attached ctx is a no-op — `Object.assign` overwrites with the same method references.
- **Throws on unknown event.** The per-event method-set table is exhaustive; the `Record<EventName, ...>` compile-time guard catches drift, and the runtime throw catches `as` escape-hatch misuse (casting an arbitrary string to `EventName` at the boundary).
- **Methods are pure value constructors.** No closures over `ctx`, no engine side effects. `ctx.allow(opts)` returns `{ result: 'allow', ...opts }` and nothing else. This keeps `JSON.stringify(ctx)` losing the methods functionally harmless — the methods carry no state to serialize. The constructors are also exported standalone so non-ctx call sites (helper functions, standalone tests) can build results without a context object.

## Type-composition primitives

The decision-method types are composed from a small primitive vocabulary in `src/types/method-primitives.ts`. Two flavors: **field-bag primitives** (small object types that compose into per-event opts shapes) and **method-shape primitives** (single-property object types intersected to build a method record).

**Field-bag primitives (re-exported from the barrel — authors composing custom event handlers may import them):**

| Primitive | Shape | Purpose |
|-----------|-------|---------|
| `DebugMessage` | `{ debugMessage?: string }` | Optional debug info, only visible in debug mode. Intersected on every method-opts bag. |
| `Inject` | `{ injectContext?: string }` | Text injected into the agent's conversation; maps to upstream `additionalContext`. Only on events whose contract supports it. |
| `Reason` | `{ reason: string } & DebugMessage` | Required reason. Shown to the agent (guard events) or user (continuation events). |
| `Feedback` | `{ feedback: string } & DebugMessage` | Required next-turn instruction for a teammate (continuation events). |
| `Path` | `{ path: string } & DebugMessage` | Required absolute path (e.g. created worktree). |
| `SessionTitle` | `{ sessionTitle?: string }` | Equivalent to running `/rename`. Whether upstream honors it on a `block` arm is unverified; the result type matches the upstream output schema. |
| `UpdatedPermissions` | `{ updatedPermissions?: PermissionUpdateEntry[] }` | Permission update entries returned from a `PermissionRequest` allow arm. |
| `UpdatedMcpToolOutput` | `{ updatedMCPToolOutput?: unknown }` | MCP tools only. Built-in tools (Bash, Edit, Write, …) silently ignore this field. |
| `Interrupt` | `{ interrupt?: boolean }` | When true on a `PermissionRequest` block, Claude Code stops entirely. |

**Method-shape primitives (NOT re-exported from the barrel — internal design vocabulary):** `Allow<O, R>`, `Block<O, R>`, `Skip<O, R>`, `Ask<O, R>`, `Defer<O, R>`, `Continue<O, R>`, `Stop<O, R>`, `Retry<O, R>`, `Success<O, R>`, `Failure<O, R>`. Each is a single-property object type — e.g. `type Allow<O, R> = { allow: (opts?: O) => R }`. Intersect them to compose a method record. The `export` keyword is omitted at `src/types/index.ts` so authors don't import them directly; the declarations still survive in the generated `.d.ts` bundle for internal reference (declaration-preservation behavior of `dts-bundle-generator --export-referenced-types=false`). `Continue` collides with the JS keyword in some IDE refactors and `Stop` collides with the `Stop` event name; both stay internal regardless.

Opts-required vs opts-optional distinction: `Allow`, `Skip`, `Defer`, `Retry` accept optional opts (the call-site form `ctx.allow()` is legal); `Block`, `Ask`, `Continue`, `Stop`, `Success`, `Failure` require opts because their bag carries a required field.

**Worked composition example.** A hypothetical new guard event `FooEvent` with allow / block result arms but no inject support:

```ts
// In src/types/decision-methods.ts:
export type FooEventDecisionMethods =
  Allow<DebugMessage, FooEventResult> &
  Block<Reason, FooEventResult>
```

Adding a new event becomes a composition exercise rather than a copy-paste exercise. JSDoc reattaches to property declarations on the consumer type (the composed shape is structurally `{ allow: ...; block: ... }`), so per-property JSDoc renders at hover. Where a JSDoc caveat must live on a sub-field of an opts bag (for example, an MCP-only field caveat on `updatedMCPToolOutput`), the JSDoc lives on the field-bag primitive's declaration (`UpdatedMcpToolOutput` in `method-primitives.ts`) — primitive-level JSDoc still surfaces at hover.

**IDE tooltip note.** Some IDE configurations may render the named primitive form (e.g. `Skip<DebugMessage, R>`) at hover instead of the structurally-expanded opts shape; both are equivalent and assignment-compatible. The acceptance gate test in `test/types/feat-0064-tooltip-assignability.types.ts` enforces the structural shape; what an IDE chooses to display on top of that is a presentation detail.

### Runtime-side composition

The runtime side of the decision-method system — the 10 `*Opts` interfaces in `src/engine/context-methods.ts` (`AllowOpts`, `AskOpts`, `BlockOpts`, `DeferOpts`, `SkipOpts`, `SuccessOpts`, `FailureOpts`, `ContinueOpts`, `StopOpts`, `RetryOpts`) — composes from the same field-bag primitives. Each `*Opts` interface `extends` the optional field-bag primitives it carries (e.g. `BlockOpts extends DebugMessage, Inject, Interrupt, UpdatedMcpToolOutput, SessionTitle`) and inlines required fields (`reason`, `feedback`, `path`). The runtime is structurally lenient via spread; the per-event TS-side method types in `decision-methods.ts` and `contexts.ts` narrow what callers can legally pass.

**Inline-vs-extends choice for required fields.** The required-field primitives `Reason`, `Feedback`, and `Path` are kept as inline `reason: string` / `feedback: string` / `path: string` declarations on the runtime opts interfaces rather than `extends Reason` etc. The bundled-with-DebugMessage form (`Reason = { reason: string } & DebugMessage`) plus an explicit `extends DebugMessage` clause silently merges identical inheritance — TypeScript handles this without error, but the inheritance chain reads as redundant. Inline reads cleaner. Source-of-truth `*DecisionMethods` types in `decision-methods.ts` continue to compose from the bundled `Reason` / `Feedback` / `Path` for one-line intersections; the asymmetry is intentional and ergonomic (see PLAN-FEAT-0064B Decision Log entry "Runtime-parity audit conclusion (Open Question 8 resolution)" 2026-04-25).

## Related

- `docs/domain/hook-type-system/patterns.md` — broader type-system patterns (events, results, branding, normalization)
- `docs/domain/claude-code-hooks/events.md` — Claude Code event reference
- `docs/domain/claude-code-hooks/io-contract.md` — Claude Code I/O contract
- `docs/plans/feat-0064-type-composition/PLAN-FEAT-0064-primitives-and-decision-methods.md` — ExecPlan that introduced the composition vocabulary
