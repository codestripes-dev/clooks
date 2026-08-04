// Barrel re-export — preserves the original ./engine.js import path for all consumers.

// types
export type { EngineResult, ExitCode, RunEngineDeps } from './types.js'
export { EXIT_OK, EXIT_HOOK_FAILURE, EXIT_STDERR } from './types.js'

// events
export { assertCategoryCompleteness } from './events.js'

// translate
export { translateResult } from './translate.js'

// match
export type { MatchResult } from './match.js'
export { matchHooksForEvent, buildShadowWarnings } from './match.js'

// execute
export {
  resolveOnError,
  interpolateMessage,
  formatDiagnostic,
  formatTraceMessage,
  executeHooks,
  rankPreToolUseResult,
  reducePreToolUseVotes,
} from './execute.js'

// handoff
export {
  resolveHandoff,
  shouldHandoff,
  writeHandoffFile,
  buildPointer,
  applyHandoff,
  pruneHandoffFiles,
  HANDOFF_MAX_FILES,
  HANDOFF_TTL_MS,
} from './handoff.js'

// turn state
export type { PendingTurnRecord, TurnStamp, TurnState, TurnTracker } from './turn-state.js'
export {
  emptyTurn,
  emptyTurnState,
  turnScopeKey,
  isTurnIntervention,
  decisionForResult,
  materializeTurn,
  appendTurnRecord,
  clearTurnScopes,
  advanceTurnGeneration,
  isTurnStateShape,
  turnStatePath,
  readTurnState,
  acquireTurnLock,
  verifyTurnLock,
  releaseTurnLock,
  commitTurnRecords,
  applyTurnBoundary,
  pruneTurnState,
  createTurnTracker,
  turnStampOf,
  turnStampsEqual,
  TURN_STATE_VERSION,
  TURN_STATE_MAX_BYTES,
  TURN_STATE_MAX_RECORDS_PER_HOOK,
  TURN_STATE_TTL_MS,
  TURN_STATE_MAX_FILES,
  TURN_STATE_LOCK_STALE_MS,
  TURN_STATE_LOCK_TTL_MS,
  TURN_STATE_LOCK_MAX_WAIT_MS,
} from './turn-state.js'

// run
export { runEngine, defaultDeps } from './run.js'
