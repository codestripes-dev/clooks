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

// run
export { runEngine, defaultDeps } from './run.js'
