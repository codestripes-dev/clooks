import type { EventName } from '../types/branded.js'
import type {
  ClaudeCodeOutput,
  PreToolUseOutput,
  HookSpecificOutputBase,
} from '../types/claude-code.js'
import { INJECTABLE_EVENTS } from '../config/constants.js'
import type { EngineResult, ExitCode } from './types.js'
import { EXIT_OK, EXIT_HOOK_FAILURE, EXIT_STDERR } from './types.js'
import { GUARD_EVENTS, OBSERVE_EVENTS, CONTINUATION_EVENTS } from './events.js'

/**
 * Translates a hook result into engine output (stdout string, exit code, stderr).
 *
 * The translation is event-aware: different event categories use different
 * Claude Code output formats.
 *
 * Exported for unit testing.
 */
export function translateResult(
  eventName: EventName,
  result: EngineResult,
): { output?: string; exitCode: ExitCode; stderr?: string } {
  const resultType = result.result

  // --- PreToolUse: uses hookSpecificOutput ---
  if (eventName === 'PreToolUse') {
    if (resultType === 'block') {
      const reason = result.reason ?? 'clooks: action blocked by hook'
      const hookOutput: PreToolUseOutput = {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      }
      const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput }
      return { output: JSON.stringify(output), exitCode: EXIT_OK }
    }
    if (resultType === 'skip') {
      return { exitCode: EXIT_OK }
    }
    if (resultType === 'allow') {
      const hookOutput: PreToolUseOutput = {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      }
      if (result.injectContext) {
        hookOutput.additionalContext = result.injectContext
      }
      if (result.updatedInput) {
        hookOutput.updatedInput = result.updatedInput as Record<string, unknown>
      }
      const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput }
      return { output: JSON.stringify(output), exitCode: EXIT_OK }
    }
  }

  // --- PermissionRequest: uses hookSpecificOutput.decision ---
  if (eventName === 'PermissionRequest') {
    if (resultType === 'block') {
      const decision: Record<string, unknown> = {
        behavior: 'deny',
        message: result.reason ?? 'clooks: action blocked by hook',
      }
      if (result.interrupt) decision.interrupt = true
      const hookOutput = { hookEventName: 'PermissionRequest', decision }
      return { output: JSON.stringify({ hookSpecificOutput: hookOutput }), exitCode: EXIT_OK }
    }
    if (resultType === 'skip') {
      return { exitCode: EXIT_OK }
    }
    if (resultType === 'allow') {
      const decision: Record<string, unknown> = { behavior: 'allow' }
      if (result.updatedInput) decision.updatedInput = result.updatedInput
      if (result.updatedPermissions) decision.updatedPermissions = result.updatedPermissions
      if (Object.keys(decision).length > 1) {
        const hookOutput = { hookEventName: 'PermissionRequest', decision }
        return { output: JSON.stringify({ hookSpecificOutput: hookOutput }), exitCode: EXIT_OK }
      }
      return { exitCode: EXIT_OK }
    }
  }

  // --- Other guard events: block → exit 0 + JSON, allow/skip → exit 0 ---
  if (GUARD_EVENTS.has(eventName)) {
    if (resultType === 'block') {
      const reason = result.reason ?? 'clooks: action blocked by hook'
      const output: ClaudeCodeOutput = { decision: 'block', reason }
      return { output: JSON.stringify(output), exitCode: EXIT_OK }
    }
    if (resultType === 'allow' || resultType === 'skip') {
      if (result.injectContext && INJECTABLE_EVENTS.has(eventName)) {
        const hookOutput: HookSpecificOutputBase = {
          hookEventName: eventName,
          additionalContext: result.injectContext,
        }
        const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput }
        return { output: JSON.stringify(output), exitCode: EXIT_OK }
      }
      return { exitCode: EXIT_OK }
    }
  }

  // --- Observe events ---
  if (OBSERVE_EVENTS.has(eventName)) {
    // Handle block results from onError: "block" hook errors.
    // Observe events can't actually block (action already completed),
    // so surface the error via additionalContext or systemMessage instead.
    if (resultType === 'block') {
      const reason = result.reason ?? 'clooks: hook error on observe event'
      if (INJECTABLE_EVENTS.has(eventName)) {
        const hookOutput: HookSpecificOutputBase = {
          hookEventName: eventName,
          additionalContext: reason,
        }
        const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput }
        return { output: JSON.stringify(output), exitCode: EXIT_OK }
      }
      const output: ClaudeCodeOutput = { systemMessage: reason }
      return { output: JSON.stringify(output), exitCode: EXIT_OK }
    }
    // PostToolUse with updatedMCPToolOutput — top-level field, not inside hookSpecificOutput
    if (eventName === 'PostToolUse' && result.updatedMCPToolOutput !== undefined) {
      const outputObj: Record<string, unknown> = {
        updatedMCPToolOutput: result.updatedMCPToolOutput,
      }
      if (result.injectContext) {
        outputObj.hookSpecificOutput = {
          hookEventName: eventName,
          additionalContext: result.injectContext,
        }
      }
      return { output: JSON.stringify(outputObj), exitCode: EXIT_OK }
    }

    if (result.injectContext && INJECTABLE_EVENTS.has(eventName)) {
      const hookOutput: HookSpecificOutputBase = {
        hookEventName: eventName,
        additionalContext: result.injectContext,
      }
      const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput }
      return { output: JSON.stringify(output), exitCode: EXIT_OK }
    }
    return { exitCode: EXIT_OK }
  }

  // --- WorktreeCreate: success → stdout path, failure → exit 1, block → exit 1 ---
  if (eventName === 'WorktreeCreate') {
    if (resultType === 'block') {
      return {
        exitCode: EXIT_HOOK_FAILURE,
        stderr: result.reason ?? 'clooks: hook error during worktree creation',
      }
    }
    if (resultType === 'success') {
      if (typeof result.path !== 'string' || result.path === '') {
        return {
          exitCode: EXIT_HOOK_FAILURE,
          stderr: 'clooks: WorktreeCreate hook returned success but path is missing or empty',
        }
      }
      return { output: result.path, exitCode: EXIT_OK }
    }
    if (resultType === 'failure') {
      return {
        exitCode: EXIT_HOOK_FAILURE,
        stderr: result.reason ?? 'clooks: worktree creation failed',
      }
    }
  }

  // --- Continuation events ---
  if (CONTINUATION_EVENTS.has(eventName)) {
    // Handle block results from onError: "block" hook errors.
    // Fail-closed for continuation events = stop the agent/teammate.
    if (resultType === 'block') {
      const reason = result.reason ?? 'clooks: hook error on continuation event'
      const output: ClaudeCodeOutput = {
        continue: false,
        stopReason: reason,
      }
      return { output: JSON.stringify(output), exitCode: EXIT_OK }
    }
    if (resultType === 'continue') {
      return {
        exitCode: EXIT_STDERR,
        stderr: result.feedback ?? '',
      }
    }
    if (resultType === 'stop') {
      const output: ClaudeCodeOutput = {
        continue: false,
        stopReason: result.reason,
      }
      return { output: JSON.stringify(output), exitCode: EXIT_OK }
    }
    if (resultType === 'skip') {
      return { exitCode: EXIT_OK }
    }
  }

  // Unknown result — fail-closed
  return {
    exitCode: EXIT_STDERR,
    stderr: `clooks: hook returned unknown result type: ${String(resultType)}`,
  }
}
