import type { EventName } from '../types/branded.js'
import type {
  ClaudeCodeOutput,
  PreToolUseOutput,
  HookSpecificOutputBase,
  UserPromptSubmitOutput,
} from '../types/claude-code.js'
import { INJECTABLE_EVENTS, NOTIFY_ONLY_EVENTS } from '../config/constants.js'
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

  // --- NOTIFY_ONLY_EVENTS: output and exit code are ignored upstream.
  // Short-circuit to EXIT_OK with no stdout, regardless of the hook's result.
  // The crashed-hook stderr passthrough lives in the engine's run/error path
  // (src/engine/run.ts), not here. See FEAT-0057 D1, D3.
  if (NOTIFY_ONLY_EVENTS.has(eventName)) {
    return { exitCode: EXIT_OK }
  }

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
      // UserPromptSubmit allows sessionTitle and/or additionalContext alongside
      // block — upstream's canonical example combines `decision: "block"` with
      // `hookSpecificOutput.sessionTitle` AND `hookSpecificOutput.additionalContext`
      // in a single response (docs/domain/raw-claude-ai/hook-docs/UserPromptSubmit.md:42-52).
      if (eventName === 'UserPromptSubmit' && (result.sessionTitle || result.injectContext)) {
        const hookOutput: UserPromptSubmitOutput = {
          hookEventName: 'UserPromptSubmit',
        }
        if (result.injectContext) {
          hookOutput.additionalContext = result.injectContext
        }
        if (result.sessionTitle) {
          hookOutput.sessionTitle = result.sessionTitle
        }
        output.hookSpecificOutput = hookOutput
      }
      return { output: JSON.stringify(output), exitCode: EXIT_OK }
    }
    if (resultType === 'allow' || resultType === 'skip') {
      // UserPromptSubmit: thread sessionTitle alongside additionalContext.
      // Emit hookSpecificOutput when EITHER injectContext OR sessionTitle is
      // present (sessionTitle-only still requires the hookSpecificOutput so
      // the title update fires upstream).
      if (eventName === 'UserPromptSubmit' && (result.injectContext || result.sessionTitle)) {
        const hookOutput: UserPromptSubmitOutput = {
          hookEventName: 'UserPromptSubmit',
        }
        if (result.injectContext) {
          hookOutput.additionalContext = result.injectContext
        }
        if (result.sessionTitle) {
          hookOutput.sessionTitle = result.sessionTitle
        }
        const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput }
        return { output: JSON.stringify(output), exitCode: EXIT_OK }
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
  }

  // PermissionDenied retry hint. Non-retry results fall through to
  // the generic OBSERVE_EVENTS block below.
  if (eventName === 'PermissionDenied' && resultType === 'retry') {
    const hookOutput = {
      hookEventName: 'PermissionDenied' as const,
      retry: true,
    }
    return {
      output: JSON.stringify({ hookSpecificOutput: hookOutput }),
      exitCode: EXIT_OK,
    }
  }

  // --- Observe events ---
  if (OBSERVE_EVENTS.has(eventName)) {
    // PostToolUse author-returnable block (and onError: "block" cascade):
    // unify both paths onto upstream's decision: "block" + reason shape.
    // Although PostToolUse runs after the tool has already executed (cannot be
    // undone), Claude Code surfaces `decision: "block"` + reason as post-hoc
    // feedback to the agent. Must precede the generic cascade handler below so
    // the cascade does not shadow this for PostToolUse.
    if (eventName === 'PostToolUse' && resultType === 'block') {
      const reason = result.reason ?? 'clooks: hook blocked tool output'
      const out: ClaudeCodeOutput = { decision: 'block', reason }
      if (result.injectContext) {
        out.hookSpecificOutput = {
          hookEventName: 'PostToolUse',
          additionalContext: result.injectContext,
        }
      }
      if (result.updatedMCPToolOutput !== undefined) {
        const merged: Record<string, unknown> = {
          ...out,
          updatedMCPToolOutput: result.updatedMCPToolOutput,
        }
        return { output: JSON.stringify(merged), exitCode: EXIT_OK }
      }
      return { output: JSON.stringify(out), exitCode: EXIT_OK }
    }
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
    // Fail-closed for continuation events = exit-2 + stderr (upstream's documented
    // retry/feedback semantic). The task/teammate is blocked from this transition but
    // not halted — stderr is fed back as feedback and the model retries.
    // Explicit `stop` result below is unchanged — that's the stop-teammate path.
    if (resultType === 'block') {
      const reason = result.reason ?? 'clooks: hook error on continuation event'
      return {
        exitCode: EXIT_STDERR,
        stderr: reason,
      }
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
