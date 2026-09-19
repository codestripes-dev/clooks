import type { EventName } from './branded.js'
import type { ResultTag } from './results.js'

/**
 * What a hook decided on one prior run. Every result tag a hook can return,
 * plus `'error'` for a run that threw, rejected, timed out, or was abandoned
 * when a parallel batch short-circuited.
 */
export type TurnDecision = ResultTag | 'error'

/** One completed prior run of this hook during the current turn. */
export interface TurnRecord {
  /** The event that run fired on. */
  event: EventName
  /** What the run decided. */
  decision: TurnDecision
  /** When the run completed, ISO 8601. */
  at: string
}

/**
 * This hook's own history for the current turn — one user prompt and
 * everything the agent does in response to it. Always present on `ctx`;
 * empty when the engine could not read stored state.
 *
 * A hook only ever sees its own runs. There is no cross-hook visibility.
 *
 * @example
 * // Remind exactly once per turn instead of looping.
 * export const hook: ClooksHook = {
 *   meta: { name: 'lint-reminder' },
 *   Stop(ctx) {
 *     if (ctx.turn.priorInterventions > 0) return ctx.skip()
 *     return ctx.block({ reason: 'Remember to lint the files you changed.' })
 *   },
 * }
 */
export interface TurnContext {
  /** Every prior run of this hook this turn, across all events, oldest first. */
  prior: TurnRecord[]
  /** Prior runs of this hook on the *current* event only. */
  priorRuns: number
  /**
   * Prior runs on the current event that actually intervened: a `block` on any
   * event, a `continue` on `TeammateIdle` / `TaskCreated` / `TaskCompleted`, or
   * a `retry` on `PermissionDenied`.
   */
  priorInterventions: number
}
