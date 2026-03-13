import type { ResultTag } from '../types/results.js'
import type { loadConfig } from '../config/index.js'
import type { loadAllHooks } from '../loader.js'

/** Typed result object used within the engine after the hook return boundary. */
export interface EngineResult {
  result: ResultTag
  reason?: string
  path?: string
  feedback?: string
  injectContext?: string
  debugMessage?: string
  updatedInput?: Record<string, unknown>
  updatedPermissions?: unknown[]
  interrupt?: boolean
  updatedMCPToolOutput?: unknown
}

/** Exit 0: success. Stdout may contain JSON output. */
export const EXIT_OK = 0 as const
/** Exit 1: hook-level failure (e.g., WorktreeCreate failure). */
export const EXIT_HOOK_FAILURE = 1 as const
/**
 * Exit 2: non-zero stderr channel.
 * Used for two distinct purposes in Claude Code's hook contract:
 *   - Fail-closed errors (bad config, unknown event, fatal exception)
 *   - Continuation event "continue" results (feedback delivered via stderr)
 * Both use exit 2 because Claude Code treats any non-zero exit as "hook
 * produced stderr output to process." The semantic difference is in the
 * context (continuation event vs. error), not the exit code itself.
 */
export const EXIT_STDERR = 2 as const

export type ExitCode = typeof EXIT_OK | typeof EXIT_HOOK_FAILURE | typeof EXIT_STDERR

/**
 * Injectable dependencies for runEngine.
 * Why DI instead of mock.module?  Bun's mock.module is process-wide and
 * leaks across test files in the same run.  Mocking ./config/index.js and
 * ./loader.js here broke every loadConfig and loader test (16+ failures).
 */
export interface RunEngineDeps {
  loadConfig: typeof loadConfig
  loadAllHooks: typeof loadAllHooks
  readStdin: () => Promise<unknown>
}
