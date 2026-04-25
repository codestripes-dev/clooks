// Patch<T> utility type.
// Cross-reference: docs/domain/hook-type-system.md, FEAT-0061 (engine patch-merge semantics).
//
// Encodes the engine's FEAT-0061 patch-merge runtime behavior at the type level.
// The engine receives a partial `updatedInput` patch from a hook, shallow-merges
// it onto the running tool input via spread, and then strips keys whose value is
// the literal `null` via `omitBy(..., isNull)` (`src/engine/execute.ts`).

/**
 * Keys of `T` whose values are optional (i.e. the property itself may be absent).
 * Used by `Patch<T>` to permit `null` only on optional keys.
 */
export type OptionalKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? K : never
}[keyof T]

/**
 * Patch shape for FEAT-0061 patch-merge.
 *
 * Semantics:
 * - `null` = explicit unset. The engine's `omitBy(..., isNull)` strips the key
 *   from the merged tool input before translation, so the upstream tool sees the
 *   key as absent.
 * - `null` is forbidden on required keys of `T` — required keys accept `T[K]`
 *   only, not `T[K] | null`. Stripping a required key would send the upstream
 *   tool a call missing that field (e.g. `Bash` without `command`), failing at
 *   the tool layer with no clooks-side guard. This is enforced at compile time
 *   by `OptionalKeys<T>` — assigning `null` to a required key (e.g.
 *   `{ command: null }` on `Patch<BashToolInput>`) is a TypeScript error.
 * - `undefined` / absent = no engine change. After spread, `{ key: undefined }`
 *   is **present on the merged object** with value `undefined` — the engine does
 *   NOT strip it. Wire-level absence happens because `JSON.stringify` drops
 *   `undefined`-valued keys during serialization, not because of any engine
 *   logic. Authors debugging "where did my undefined go?" should look at the
 *   serializer, not at the merge step.
 *
 * See `docs/domain/hook-type-system.md` for the broader hook type-system context
 * and FEAT-0061 for the originating engine semantics.
 */
export type Patch<T> = {
  [K in keyof T]?: K extends OptionalKeys<T> ? T[K] | null : T[K]
}
