import { describe, expect, it, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  translateResult,
  matchHooksForEvent,
  executeHooks,
  interpolateMessage,
  resolveOnError,
  buildShadowWarnings,
  formatDiagnostic,
  formatTraceMessage,
  assertCategoryCompleteness,
  rankPreToolUseResult,
  reducePreToolUseVotes,
} from './engine/index.js'
import type { LoadedHook, HookLoadError } from './loader.js'
import type { ClooksHook } from './types/hook.js'
import type { ClooksConfig } from './config/schema.js'
import type { HookName, EventName } from './types/branded.js'
import type { PermissionUpdateEntry } from './types/permissions.js'
import { hn, ms } from './test-utils.js'
import { DEFAULT_MAX_FAILURES_MESSAGE } from './config/constants.js'
import { readFailures, getFailurePath, LOAD_ERROR_EVENT } from './failures.js'

describe('translateResult', () => {
  // --- PreToolUse ---

  it('PreToolUse allow → hookSpecificOutput with hookEventName and permissionDecision', () => {
    const out = translateResult('PreToolUse', { result: 'allow' })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    })
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse block → exit 0 + JSON with permissionDecision deny', () => {
    const out = translateResult('PreToolUse', {
      result: 'block',
      reason: 'dangerous command',
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe('dangerous command')
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse block with injectContext → additionalContext emitted alongside deny fields', () => {
    const out = translateResult('PreToolUse', {
      result: 'block',
      reason: 'policy',
      injectContext: 'extra-ctx',
    })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'policy',
        additionalContext: 'extra-ctx',
      },
    })
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse block with empty injectContext → no additionalContext on output', () => {
    const out = translateResult('PreToolUse', {
      result: 'block',
      reason: 'policy',
      injectContext: '',
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput).not.toHaveProperty('additionalContext')
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse skip → exit 0, no output', () => {
    const out = translateResult('PreToolUse', { result: 'skip' })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse allow with injectContext → additionalContext in hookSpecificOutput', () => {
    const out = translateResult('PreToolUse', {
      result: 'allow',
      injectContext: 'extra info for the agent',
    })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        additionalContext: 'extra info for the agent',
      },
    })
  })

  it('PreToolUse allow with reason → permissionDecision allow + permissionDecisionReason', () => {
    const out = translateResult('PreToolUse', {
      result: 'allow',
      reason: 'approved by policy',
    })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'approved by policy',
      },
    })
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse ask → permissionDecision ask + permissionDecisionReason', () => {
    const out = translateResult('PreToolUse', {
      result: 'ask',
      reason: 'please confirm this action',
    })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'please confirm this action',
      },
    })
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse ask with updatedInput + injectContext → all four fields present', () => {
    const out = translateResult('PreToolUse', {
      result: 'ask',
      reason: 'review required',
      injectContext: 'here is some context',
      updatedInput: { command: 'ls -la' },
    })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'review required',
        additionalContext: 'here is some context',
        updatedInput: { command: 'ls -la' },
      },
    })
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse defer → exactly {hookSpecificOutput: {hookEventName, permissionDecision: defer}}, no extra fields', () => {
    const out = translateResult('PreToolUse', { result: 'defer' })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'defer',
      },
    })
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse defer with reason (as any) → no permissionDecisionReason on output', () => {
    const out = translateResult('PreToolUse', { result: 'defer', reason: 'foo' } as any)
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('defer')
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse defer with updatedInput + injectContext (as any) → translator drops both', () => {
    const out = translateResult('PreToolUse', {
      result: 'defer',
      updatedInput: { command: 'rm -rf /' },
      injectContext: 'ctx',
    } as any)
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('defer')
    expect(parsed.hookSpecificOutput.updatedInput).toBeUndefined()
    expect(parsed.hookSpecificOutput.additionalContext).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse defer with updatedInput + injectContext (as any) → hookSpecificOutput is exactly the minimal shape', () => {
    const out = translateResult('PreToolUse', {
      result: 'defer',
      updatedInput: { command: 'rm -rf /' },
      injectContext: 'ctx',
    } as any)
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput).toEqual({
      hookEventName: 'PreToolUse',
      permissionDecision: 'defer',
    })
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse ask with empty reason string → falls back to default permissionDecisionReason', () => {
    const out = translateResult('PreToolUse', { result: 'ask', reason: '' } as any)
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('ask')
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe(
      'clooks: hook requested confirmation',
    )
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse ask with missing reason → falls back to default permissionDecisionReason', () => {
    const out = translateResult('PreToolUse', { result: 'ask' } as any)
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('ask')
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe(
      'clooks: hook requested confirmation',
    )
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse allow with empty reason → no permissionDecisionReason on output', () => {
    const out = translateResult('PreToolUse', { result: 'allow', reason: '' })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput).not.toHaveProperty('permissionDecisionReason')
    expect(out.stderr).toBeUndefined()
  })

  it('PreToolUse allow with empty injectContext → no additionalContext on output', () => {
    const out = translateResult('PreToolUse', { result: 'allow', injectContext: '' })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput).not.toHaveProperty('additionalContext')
    expect(out.stderr).toBeUndefined()
  })

  // --- Other guard events ---

  it('UserPromptSubmit block → exit 0 + JSON with decision block', () => {
    const out = translateResult('UserPromptSubmit', {
      result: 'block',
      reason: 'prompt blocked',
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.decision).toBe('block')
    expect(parsed.reason).toBe('prompt blocked')
    expect(out.stderr).toBeUndefined()
  })

  it('UserPromptSubmit allow → exit 0', () => {
    const out = translateResult('UserPromptSubmit', { result: 'allow' })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
  })

  it('UserPromptSubmit allow with injectContext → hookSpecificOutput with additionalContext', () => {
    const out = translateResult('UserPromptSubmit', {
      result: 'allow',
      injectContext: 'context for agent',
    })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'context for agent',
      },
    })
  })

  it('UserPromptSubmit allow with injectContext + sessionTitle → hookSpecificOutput with both fields', () => {
    const out = translateResult('UserPromptSubmit', {
      result: 'allow',
      injectContext: 'context for agent',
      sessionTitle: 'Refactoring auth',
    })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'context for agent',
        sessionTitle: 'Refactoring auth',
      },
    })
  })

  it('UserPromptSubmit allow with sessionTitle only → hookSpecificOutput with sessionTitle, no additionalContext', () => {
    const out = translateResult('UserPromptSubmit', {
      result: 'allow',
      sessionTitle: 'Refactoring auth',
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        sessionTitle: 'Refactoring auth',
      },
    })
    expect(parsed.hookSpecificOutput.additionalContext).toBeUndefined()
  })

  it('UserPromptSubmit block with reason + sessionTitle → top-level decision/reason AND hookSpecificOutput.sessionTitle', () => {
    const out = translateResult('UserPromptSubmit', {
      result: 'block',
      reason: 'prompt blocked',
      sessionTitle: 'Security review',
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.decision).toBe('block')
    expect(parsed.reason).toBe('prompt blocked')
    expect(parsed.hookSpecificOutput).toEqual({
      hookEventName: 'UserPromptSubmit',
      sessionTitle: 'Security review',
    })
  })

  it('UserPromptSubmit block + reason + sessionTitle + injectContext → hookSpecificOutput carries both additionalContext and sessionTitle', () => {
    const out = translateResult('UserPromptSubmit', {
      result: 'block',
      reason: 'prompt blocked',
      sessionTitle: 'Test',
      injectContext: 'context text',
    })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      decision: 'block',
      reason: 'prompt blocked',
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'context text',
        sessionTitle: 'Test',
      },
    })
  })

  it('UserPromptSubmit allow with sessionTitle "" → no hookSpecificOutput (empty-string treated as absent)', () => {
    const out = translateResult('UserPromptSubmit', { result: 'allow', sessionTitle: '' })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
  })

  it('UserPromptSubmit skip with sessionTitle → hookSpecificOutput with sessionTitle', () => {
    const out = translateResult('UserPromptSubmit', {
      result: 'skip',
      sessionTitle: 'Quick check',
    })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        sessionTitle: 'Quick check',
      },
    })
  })

  it('UserPromptSubmit block with reason only (no sessionTitle) → top-level decision/reason, no hookSpecificOutput (regression)', () => {
    const out = translateResult('UserPromptSubmit', {
      result: 'block',
      reason: 'prompt blocked',
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.decision).toBe('block')
    expect(parsed.reason).toBe('prompt blocked')
    expect(parsed.hookSpecificOutput).toBeUndefined()
  })

  it('Stop skip → exit 0', () => {
    const out = translateResult('Stop', { result: 'skip' })
    expect(out.exitCode).toBe(0)
  })

  // --- Observe events ---

  it('PostToolUse skip → exit 0, no output', () => {
    const out = translateResult('PostToolUse', { result: 'skip' })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
  })

  it('SessionStart skip with injectContext → hookSpecificOutput with additionalContext', () => {
    const out = translateResult('SessionStart', {
      result: 'skip',
      injectContext: 'welcome message',
    })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'welcome message',
      },
    })
  })

  // --- WorktreeCreate ---

  it('WorktreeCreate success → stdout path, exit 0', () => {
    const out = translateResult('WorktreeCreate', {
      result: 'success',
      path: '/tmp/worktree-123',
    })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBe('/tmp/worktree-123')
  })

  it('WorktreeCreate success with undefined path → exit 1 + stderr', () => {
    const out = translateResult('WorktreeCreate', {
      result: 'success',
      path: undefined as any,
    })
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toBe(
      'clooks: WorktreeCreate hook returned success but path is missing or empty',
    )
  })

  it('WorktreeCreate success with empty path → exit 1 + stderr', () => {
    const out = translateResult('WorktreeCreate', {
      result: 'success',
      path: '',
    })
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toBe(
      'clooks: WorktreeCreate hook returned success but path is missing or empty',
    )
  })

  it('WorktreeCreate failure → exit 1 + stderr', () => {
    const out = translateResult('WorktreeCreate', {
      result: 'failure',
      reason: 'disk full',
    })
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toBe('disk full')
  })

  // --- Continuation events ---

  it('TeammateIdle continue → exit 2 + stderr feedback', () => {
    const out = translateResult('TeammateIdle', {
      result: 'continue',
      feedback: 'keep working on task X',
    })
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe('keep working on task X')
  })

  it('TaskCompleted stop → JSON with continue:false + stopReason', () => {
    const out = translateResult('TaskCompleted', {
      result: 'stop',
      reason: 'all tasks done',
    })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      continue: false,
      stopReason: 'all tasks done',
    })
  })

  it('TaskCreated continue → exit 2 + stderr feedback', () => {
    const out = translateResult('TaskCreated', {
      result: 'continue',
      feedback: 'task subject must start with [TICKET-NNN]',
    })
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe('task subject must start with [TICKET-NNN]')
  })

  it('TaskCreated stop → JSON with continue:false + stopReason', () => {
    const out = translateResult('TaskCreated', {
      result: 'stop',
      reason: 'teammate halted by policy',
    })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      continue: false,
      stopReason: 'teammate halted by policy',
    })
  })

  it('TeammateIdle stop → JSON with continue:false + stopReason', () => {
    const out = translateResult('TeammateIdle', {
      result: 'stop',
      reason: 'idle timeout reached',
    })
    expect(out.exitCode).toBe(0)
    expect(JSON.parse(out.output!)).toEqual({
      continue: false,
      stopReason: 'idle timeout reached',
    })
  })

  it('TaskCreated skip → exit 0, no output', () => {
    const out = translateResult('TaskCreated', { result: 'skip' })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
  })

  it('TeammateIdle skip → exit 0, no output', () => {
    const out = translateResult('TeammateIdle', { result: 'skip' })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
  })

  // --- FEAT-0017: new translateResult tests ---

  it('PermissionRequest block → exit 0 + JSON with hookSpecificOutput.decision.behavior deny', () => {
    const out = translateResult('PermissionRequest', { result: 'block', reason: 'denied' })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(parsed.hookSpecificOutput.decision.behavior).toBe('deny')
  })

  it('PermissionRequest block → decision includes message field mapped from reason', () => {
    const out = translateResult('PermissionRequest', { result: 'block', reason: 'not allowed' })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.decision.message).toBe('not allowed')
  })

  it('PermissionRequest block with interrupt → decision includes interrupt: true', () => {
    const out = translateResult('PermissionRequest', {
      result: 'block',
      reason: 'stop now',
      interrupt: true,
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(parsed.hookSpecificOutput.decision.interrupt).toBe(true)
    expect(parsed.hookSpecificOutput.decision.message).toBe('stop now')
  })

  it('PermissionRequest allow with updatedPermissions addRules → hookSpecificOutput with decision containing the entry verbatim', () => {
    const perms: PermissionUpdateEntry[] = [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'npm test' }],
        behavior: 'allow',
        destination: 'session',
      },
    ]
    const out = translateResult('PermissionRequest', { result: 'allow', updatedPermissions: perms })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(parsed.hookSpecificOutput.decision.behavior).toBe('allow')
    expect(parsed.hookSpecificOutput.decision.updatedPermissions).toEqual(perms)
  })

  it('PermissionRequest allow with updatedPermissions replaceRules → entry serializes verbatim', () => {
    const perms: PermissionUpdateEntry[] = [
      {
        type: 'replaceRules',
        rules: [{ toolName: 'Bash' }],
        behavior: 'deny',
        destination: 'localSettings',
      },
    ]
    const out = translateResult('PermissionRequest', { result: 'allow', updatedPermissions: perms })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.decision.updatedPermissions).toEqual(perms)
  })

  it('PermissionRequest allow with updatedPermissions removeRules → entry serializes verbatim', () => {
    const perms: PermissionUpdateEntry[] = [
      {
        type: 'removeRules',
        rules: [{ toolName: 'Edit', ruleContent: '/tmp/**' }],
        behavior: 'ask',
        destination: 'projectSettings',
      },
    ]
    const out = translateResult('PermissionRequest', { result: 'allow', updatedPermissions: perms })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.decision.updatedPermissions).toEqual(perms)
  })

  it('PermissionRequest allow with updatedPermissions setMode → entry serializes verbatim', () => {
    const perms: PermissionUpdateEntry[] = [
      {
        type: 'setMode',
        mode: 'acceptEdits',
        destination: 'session',
      },
    ]
    const out = translateResult('PermissionRequest', { result: 'allow', updatedPermissions: perms })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.decision.updatedPermissions).toEqual(perms)
  })

  it('PermissionRequest allow with updatedPermissions addDirectories → entry serializes verbatim', () => {
    const perms: PermissionUpdateEntry[] = [
      {
        type: 'addDirectories',
        directories: ['/tmp/a', '/tmp/b'],
        destination: 'userSettings',
      },
    ]
    const out = translateResult('PermissionRequest', { result: 'allow', updatedPermissions: perms })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.decision.updatedPermissions).toEqual(perms)
  })

  it('PermissionRequest allow with updatedPermissions removeDirectories → entry serializes verbatim', () => {
    const perms: PermissionUpdateEntry[] = [
      {
        type: 'removeDirectories',
        directories: ['/tmp/c'],
        destination: 'session',
      },
    ]
    const out = translateResult('PermissionRequest', { result: 'allow', updatedPermissions: perms })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.decision.updatedPermissions).toEqual(perms)
  })

  it('PermissionRequest allow echoing a permission_suggestions entry → round-trips verbatim ("always allow" pattern)', () => {
    // Upstream "always allow" pattern: a hook receives an entry via
    // context.permissionSuggestions and echoes it back as updatedPermissions.
    // This test pins the round-trip at the translator layer.
    const suggestion: PermissionUpdateEntry = {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'rm -rf node_modules' }],
      behavior: 'allow',
      destination: 'localSettings',
    }
    const out = translateResult('PermissionRequest', {
      result: 'allow',
      updatedPermissions: [suggestion],
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.decision.updatedPermissions).toEqual([suggestion])
  })

  it('PermissionRequest allow with updatedInput only → hookSpecificOutput with decision containing updatedInput', () => {
    const input = { command: 'echo hello' }
    const out = translateResult('PermissionRequest', { result: 'allow', updatedInput: input })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(parsed.hookSpecificOutput.decision.behavior).toBe('allow')
    expect(parsed.hookSpecificOutput.decision.updatedInput).toEqual(input)
  })

  it('PermissionRequest allow with no extra fields → still returns plain exit 0', () => {
    const out = translateResult('PermissionRequest', { result: 'allow' })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
  })

  it('PermissionRequest skip → exit 0, no output', () => {
    const out = translateResult('PermissionRequest', { result: 'skip' })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
  })

  it('PostToolUse skip with updatedMCPToolOutput → top-level updatedMCPToolOutput in output', () => {
    const mcpOutput = { result: 'transformed' }
    const out = translateResult('PostToolUse', { result: 'skip', updatedMCPToolOutput: mcpOutput })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.updatedMCPToolOutput).toEqual(mcpOutput)
    expect(parsed.hookSpecificOutput).toBeUndefined()
  })

  it('PostToolUse skip with updatedMCPToolOutput AND injectContext → both in output', () => {
    const mcpOutput = { result: 'transformed' }
    const out = translateResult('PostToolUse', {
      result: 'skip',
      updatedMCPToolOutput: mcpOutput,
      injectContext: 'extra info',
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.updatedMCPToolOutput).toEqual(mcpOutput)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse')
    expect(parsed.hookSpecificOutput.additionalContext).toBe('extra info')
  })

  it('PostToolUse skip with injectContext only → hookSpecificOutput.additionalContext, no updatedMCPToolOutput', () => {
    const out = translateResult('PostToolUse', { result: 'skip', injectContext: 'extra note' })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse')
    expect(parsed.hookSpecificOutput.additionalContext).toBe('extra note')
    expect(parsed.updatedMCPToolOutput).toBeUndefined()
  })

  it('Stop block → exit 0 + JSON with decision block', () => {
    const out = translateResult('Stop', { result: 'block', reason: 'stop blocked' })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.decision).toBe('block')
    expect(parsed.reason).toBe('stop blocked')
  })

  it('PostToolUse block → exit 0 + JSON with decision: block + reason', () => {
    const out = translateResult('PostToolUse', {
      result: 'block',
      reason: 'tool output suspicious',
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.decision).toBe('block')
    expect(parsed.reason).toBe('tool output suspicious')
    // PostToolUse block no longer surfaces via hookSpecificOutput.additionalContext
    expect(parsed.hookSpecificOutput).toBeUndefined()
    expect(parsed.systemMessage).toBeUndefined()
  })

  it('PostToolUse block without reason → default reason used', () => {
    const out = translateResult('PostToolUse', { result: 'block' } as any)
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.decision).toBe('block')
    expect(parsed.reason).toBe('clooks: hook blocked tool output')
  })

  it('PostToolUse block with injectContext → decision: block + hookSpecificOutput.additionalContext', () => {
    const out = translateResult('PostToolUse', {
      result: 'block',
      reason: 'bad output',
      injectContext: 'see docs',
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.decision).toBe('block')
    expect(parsed.reason).toBe('bad output')
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse')
    expect(parsed.hookSpecificOutput.additionalContext).toBe('see docs')
  })

  it('PostToolUse block with injectContext AND updatedMCPToolOutput → all three fields merged', () => {
    const mcpOutput = { replaced: true }
    const out = translateResult('PostToolUse', {
      result: 'block',
      reason: 'tainted',
      injectContext: 'context',
      updatedMCPToolOutput: mcpOutput,
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.decision).toBe('block')
    expect(parsed.reason).toBe('tainted')
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PostToolUse')
    expect(parsed.hookSpecificOutput.additionalContext).toBe('context')
    expect(parsed.updatedMCPToolOutput).toEqual(mcpOutput)
  })

  it('PostToolUse block with updatedMCPToolOutput only → decision:block + top-level updatedMCPToolOutput, no hookSpecificOutput', () => {
    const mcpOutput = { replaced: true }
    const out = translateResult('PostToolUse', {
      result: 'block',
      reason: 'tainted',
      updatedMCPToolOutput: mcpOutput,
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.decision).toBe('block')
    expect(parsed.reason).toBe('tainted')
    expect(parsed.updatedMCPToolOutput).toEqual(mcpOutput)
    expect(parsed.hookSpecificOutput).toBeUndefined()
  })

  it('SessionEnd block → exit 0 + JSON with systemMessage (non-injectable observe)', () => {
    const out = translateResult('SessionEnd', { result: 'block', reason: 'session error' })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.systemMessage).toBe('session error')
  })

  // --- PreCompact (guard, non-injectable) ---

  it('PreCompact block → exit 0 + JSON with decision block and reason', () => {
    const out = translateResult('PreCompact', {
      result: 'block',
      reason: 'not yet',
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.decision).toBe('block')
    expect(parsed.reason).toBe('not yet')
    expect(out.stderr).toBeUndefined()
  })

  it('PreCompact allow → exit 0, no output (not in INJECTABLE_EVENTS)', () => {
    const out = translateResult('PreCompact', { result: 'allow' })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('PreCompact allow with injectContext → injectContext is ignored (not in INJECTABLE_EVENTS), exit 0 + no output', () => {
    const out = translateResult('PreCompact', {
      result: 'allow',
      injectContext: 'this should be dropped',
    })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
  })

  it('PreCompact skip → exit 0, no output', () => {
    const out = translateResult('PreCompact', { result: 'skip' })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('PreCompact block without explicit reason → falls back to default message', () => {
    const out = translateResult('PreCompact', {
      result: 'block',
    } as unknown as import('./engine/index.js').EngineResult)
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.decision).toBe('block')
    expect(typeof parsed.reason).toBe('string')
    expect(parsed.reason.length).toBeGreaterThan(0)
  })

  it('PreCompact block with empty reason string → empty reason passes through (?? does not coalesce "")', () => {
    const out = translateResult('PreCompact', { result: 'block', reason: '' })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.decision).toBe('block')
    expect(parsed.reason).toBe('')
  })

  it('PreCompact skip with injectContext → injectContext is ignored (not in INJECTABLE_EVENTS), exit 0 + no output', () => {
    const out = translateResult('PreCompact', {
      result: 'skip',
      injectContext: 'this should be dropped',
    })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
  })

  // --- PostCompact (observe, non-injectable) ---

  it('PostCompact skip → exit 0, no output', () => {
    const out = translateResult('PostCompact', { result: 'skip' })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('PostCompact skip with injectContext → injectContext is ignored (not in INJECTABLE_EVENTS), exit 0 + no output', () => {
    // PostCompact is in OBSERVE_EVENTS but NOT in INJECTABLE_EVENTS, so
    // authors returning injectContext alongside skip see it silently dropped —
    // the translate.ts OBSERVE branch falls through to the bare exit 0 path.
    const out = translateResult('PostCompact', {
      result: 'skip',
      injectContext: 'this should be dropped',
    })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('PostCompact block (from onError: block cascade) → exit 0 + JSON with systemMessage (non-injectable observe)', () => {
    // PostCompact is NOT in INJECTABLE_EVENTS so the cascade falls to the
    // systemMessage branch of translate.ts (not additionalContext).
    const out = translateResult('PostCompact', {
      result: 'block',
      reason: 'post-compact hook crashed',
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.systemMessage).toBe('post-compact hook crashed')
    expect(parsed.hookSpecificOutput).toBeUndefined()
  })

  it('TeammateIdle block → exit 2 + stderr (retry/feedback, not stop-teammate)', () => {
    const out = translateResult('TeammateIdle', { result: 'block', reason: 'hook crash' })
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe('hook crash')
    expect(out.output).toBeUndefined()
  })

  it('TaskCompleted block → exit 2 + stderr (retry/feedback semantic)', () => {
    const out = translateResult('TaskCompleted', { result: 'block', reason: 'tests failed' })
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe('tests failed')
    expect(out.output).toBeUndefined()
  })

  it('TaskCreated block → exit 2 + stderr (retry/feedback semantic)', () => {
    const out = translateResult('TaskCreated', { result: 'block', reason: 'bad task payload' })
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe('bad task payload')
    expect(out.output).toBeUndefined()
  })

  it('TeammateIdle block without reason → exit 2 + default stderr', () => {
    const out = translateResult('TeammateIdle', {
      result: 'block',
    } as unknown as import('./engine/index.js').EngineResult)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe('clooks: hook error on continuation event')
    expect(out.output).toBeUndefined()
  })

  it('TaskCompleted block without reason → exit 2 + default stderr', () => {
    const out = translateResult('TaskCompleted', {
      result: 'block',
    } as unknown as import('./engine/index.js').EngineResult)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe('clooks: hook error on continuation event')
    expect(out.output).toBeUndefined()
  })

  it('TaskCreated block without reason → exit 2 + default stderr', () => {
    const out = translateResult('TaskCreated', {
      result: 'block',
    } as unknown as import('./engine/index.js').EngineResult)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toBe('clooks: hook error on continuation event')
    expect(out.output).toBeUndefined()
  })

  it('WorktreeCreate block → exit 1 + stderr', () => {
    const out = translateResult('WorktreeCreate', {
      result: 'block',
      reason: 'worktree hook error',
    })
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toBe('worktree hook error')
  })

  // --- Unknown result ---

  it('unknown result type → exit 2 + stderr', () => {
    const out = translateResult('PreToolUse', {
      result: 'bogus',
    } as unknown as import('./engine/index.js').EngineResult)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('unknown result type')
  })

  // --- NOTIFY_ONLY_EVENTS (StopFailure): translator short-circuits every ResultTag ---

  it('StopFailure skip → exit 0, no output, no stderr', () => {
    const out = translateResult('StopFailure', { result: 'skip' })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('StopFailure block with reason → exit 0, no output, no stderr (shadows unknown-result fallthrough)', () => {
    const out = translateResult('StopFailure', {
      result: 'block',
      reason: 'author-returned block',
    })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('StopFailure allow → exit 0, no output, no stderr', () => {
    const out = translateResult('StopFailure', {
      result: 'allow',
    } as unknown as import('./engine/index.js').EngineResult)
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('StopFailure continue with feedback → exit 0, no output, no stderr', () => {
    const out = translateResult('StopFailure', {
      result: 'continue',
      feedback: 'retry me',
    } as unknown as import('./engine/index.js').EngineResult)
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('StopFailure success with path → exit 0, no output, no stderr', () => {
    const out = translateResult('StopFailure', {
      result: 'success',
      path: '/tmp/x',
    } as unknown as import('./engine/index.js').EngineResult)
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('StopFailure failure with reason → exit 0, no output, no stderr (shadows EXIT_HOOK_FAILURE fallthrough)', () => {
    const out = translateResult('StopFailure', {
      result: 'failure',
      reason: 'author-returned failure',
    } as unknown as import('./engine/index.js').EngineResult)
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('StopFailure stop with reason → exit 0, no output, no stderr', () => {
    const out = translateResult('StopFailure', {
      result: 'stop',
      reason: 'author-returned stop',
    } as unknown as import('./engine/index.js').EngineResult)
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('StopFailure unknown result tag → exit 0 (translator early-return shadows fail-closed fallthrough)', () => {
    const out = translateResult('StopFailure', {
      result: 'bogus',
    } as unknown as import('./engine/index.js').EngineResult)
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('NOTIFY_ONLY_EVENTS branch precedes PreToolUse literal check (source-order invariant)', () => {
    // If the NOTIFY_ONLY_EVENTS branch is moved below the PreToolUse check,
    // a future event that upstream adds to both categories could be shadowed.
    // This test proves the positional invariant.
    const src = translateResult.toString()
    const notifyIdx = src.indexOf('NOTIFY_ONLY_EVENTS')
    const preToolIdx = src.indexOf('PreToolUse')
    expect(notifyIdx).toBeGreaterThan(-1)
    expect(preToolIdx).toBeGreaterThan(-1)
    expect(notifyIdx).toBeLessThan(preToolIdx)
  })

  // --- PermissionDenied ---

  it('PermissionDenied retry → hookSpecificOutput with hookEventName and retry: true', () => {
    const out = translateResult('PermissionDenied', { result: 'retry' })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PermissionDenied')
    expect(parsed.hookSpecificOutput.retry).toBe(true)
    expect(out.stderr).toBeUndefined()
  })

  it('PermissionDenied retry with debugMessage: debugMessage is silently dropped from stdout', () => {
    const out = translateResult('PermissionDenied', { result: 'retry', debugMessage: 'hello' })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PermissionDenied')
    expect(parsed.hookSpecificOutput.retry).toBe(true)
    expect(out.stderr).toBeUndefined()
  })

  it('PermissionDenied retry with empty debugMessage: equivalent to absent (no extra fields)', () => {
    const out = translateResult('PermissionDenied', { result: 'retry', debugMessage: '' })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PermissionDenied')
    expect(parsed.hookSpecificOutput.retry).toBe(true)
    expect(Object.keys(parsed)).toEqual(['hookSpecificOutput'])
    expect(Object.keys(parsed.hookSpecificOutput)).toEqual(['hookEventName', 'retry'])
    expect(out.stderr).toBeUndefined()
  })

  it('PermissionDenied skip → exit 0, no output', () => {
    const out = translateResult('PermissionDenied', { result: 'skip' })
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
    expect(out.stderr).toBeUndefined()
  })

  it('PermissionDenied cascade-block (onError: block) → systemMessage on stdout, exit 0', () => {
    // This is the onError: "block" path — a crashed hook produces a block result with reason.
    // PermissionDenied is not injectable, so the OBSERVE branch emits systemMessage.
    const out = translateResult('PermissionDenied', { result: 'block', reason: 'cascade' })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.systemMessage).toBe('cascade')
  })

  it('PreToolUse with result: retry (as any) → fail-closed: exitCode 2, stderr mentions retry', () => {
    // Safety net: retry is not a valid PreToolUse result. The translator must not
    // silently produce an incorrect output. It should reach the "unknown result type"
    // fall-through and fail closed. Assert the outcome, not a specific line number.
    const out = translateResult('PreToolUse', { result: 'retry' } as any)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('retry')
  })

  // --- FEAT-0059 safety-net: ask/defer fall-through on non-PreToolUse events ---

  it('PostToolUse with result: ask (as any) → silently absorbed by OBSERVE_EVENTS catch-all, exitCode 0', () => {
    // Safety net: ask is not a valid PostToolUse result.
    // The OBSERVE_EVENTS branch has a catch-all return { exitCode: EXIT_OK } that
    // absorbs any unmatched result tag before the "unknown result type" fail-closed
    // handler. This is the actual behavior — the safety net for observe events is the
    // type system, not the translator. This test pins that behavior so M2's new
    // PreToolUse branches cannot accidentally shadow unrelated events.
    const out = translateResult('PostToolUse', { result: 'ask', reason: 'x' } as any)
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
  })

  it('PostToolUse with result: defer (as any) → silently absorbed by OBSERVE_EVENTS catch-all, exitCode 0', () => {
    const out = translateResult('PostToolUse', { result: 'defer' } as any)
    expect(out.exitCode).toBe(0)
    expect(out.output).toBeUndefined()
  })

  it('WorktreeCreate with result: ask (as any) → fail-closed: exitCode 2, stderr mentions ask', () => {
    // Safety net: ask is not a valid WorktreeCreate result (implementation event).
    // WorktreeCreate has no catch-all return before the unknown-result handler,
    // so unmatched tags correctly fall through to fail-closed.
    const out = translateResult('WorktreeCreate', { result: 'ask', reason: 'x' } as any)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('ask')
  })

  it('WorktreeCreate with result: defer (as any) → fail-closed: exitCode 2, stderr mentions defer', () => {
    const out = translateResult('WorktreeCreate', { result: 'defer' } as any)
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('defer')
  })
})

// --- matchHooksForEvent ---

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function makeLoadedHook(name: string, handlers: Record<string, Function>): LoadedHook {
  const hookName = hn(name)
  const hook = {
    meta: { name: hookName },
    ...handlers,
  } as unknown as ClooksHook
  return {
    name: hookName,
    hook,
    config: {},
    hookPath: `/test/hooks/${name}.ts`,
    configPath: '/test/.clooks/clooks.yml',
  }
}

describe('matchHooksForEvent', () => {
  /** Minimal config with hooks registered but no special overrides. */
  function configForHooks(...names: string[]): ClooksConfig {
    const hooks = {} as Record<HookName, import('./config/schema.js').HookEntry>
    for (const name of names) {
      hooks[hn(name)] = {
        resolvedPath: `.clooks/hooks/${name}.ts`,
        config: {},
        parallel: false,
        origin: 'project',
      }
    }
    return {
      version: '1.0.0',
      global: {
        timeout: ms(30000),
        onError: 'block',
        maxFailures: 3,
        maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
      },
      hooks,
      events: {},
    }
  }

  it('returns hooks that have a handler for the event', () => {
    const hookA = makeLoadedHook('a', {
      PreToolUse: () => ({ result: 'skip' }),
    })
    const hookB = makeLoadedHook('b', {
      PreToolUse: () => ({ result: 'allow' }),
    })
    const hookC = makeLoadedHook('c', {
      PostToolUse: () => ({ result: 'skip' }),
    })
    const config = configForHooks('a', 'b', 'c')
    const { matched, disabledSkips } = matchHooksForEvent(
      [hookA, hookB, hookC],
      'PreToolUse',
      config,
    )
    expect(matched).toHaveLength(2)
    expect(matched.map((h) => h.name)).toEqual([hn('a'), hn('b')])
    expect(disabledSkips).toEqual([])
  })

  it('returns empty array when no hooks match', () => {
    const hookA = makeLoadedHook('a', {
      PostToolUse: () => ({ result: 'skip' }),
    })
    const config = configForHooks('a')
    const { matched, disabledSkips } = matchHooksForEvent([hookA], 'PreToolUse', config)
    expect(matched).toEqual([])
    expect(disabledSkips).toEqual([])
  })

  it('returns empty array for empty hooks list', () => {
    const config = configForHooks()
    const { matched, disabledSkips } = matchHooksForEvent([], 'PreToolUse', config)
    expect(matched).toEqual([])
    expect(disabledSkips).toEqual([])
  })

  it('excludes hook with enabled: false at hook level, appears in disabledSkips', () => {
    const hookA = makeLoadedHook('a', {
      PreToolUse: () => ({ result: 'skip' }),
    })
    const config = configForHooks('a')
    config.hooks[hn('a')]!.enabled = false
    const { matched, disabledSkips } = matchHooksForEvent([hookA], 'PreToolUse', config)
    expect(matched).toEqual([])
    expect(disabledSkips).toHaveLength(1)
    expect(disabledSkips[0]!.hook).toBe(hn('a'))
    expect(disabledSkips[0]!.reason).toBe('hook "a" disabled entirely via config')
  })

  it('excludes hook for per-event disable but includes it for other events', () => {
    const hookA = makeLoadedHook('a', {
      PreToolUse: () => ({ result: 'skip' }),
      PostToolUse: () => ({ result: 'skip' }),
    })
    const config = configForHooks('a')
    config.hooks[hn('a')]!.events = {
      PreToolUse: { enabled: false },
    }

    const pre = matchHooksForEvent([hookA], 'PreToolUse', config)
    expect(pre.matched).toEqual([])
    expect(pre.disabledSkips).toHaveLength(1)
    expect(pre.disabledSkips[0]!.reason).toBe('hook "a" disabled for event "PreToolUse" via config')

    const post = matchHooksForEvent([hookA], 'PostToolUse', config)
    expect(post.matched).toHaveLength(1)
    expect(post.matched[0]!.name).toBe(hn('a'))
    expect(post.disabledSkips).toEqual([])
  })

  it('hook-level enabled: false takes precedence over per-event settings', () => {
    const hookA = makeLoadedHook('a', {
      PreToolUse: () => ({ result: 'skip' }),
    })
    const config = configForHooks('a')
    config.hooks[hn('a')]!.enabled = false
    config.hooks[hn('a')]!.events = {
      PreToolUse: { enabled: true },
    }
    const { matched, disabledSkips } = matchHooksForEvent([hookA], 'PreToolUse', config)
    expect(matched).toEqual([])
    expect(disabledSkips).toHaveLength(1)
    expect(disabledSkips[0]!.reason).toBe('hook "a" disabled entirely via config')
  })

  it('hook with enabled: true (explicit) behaves same as omitted', () => {
    const hookA = makeLoadedHook('a', {
      PreToolUse: () => ({ result: 'skip' }),
    })
    const config = configForHooks('a')
    config.hooks[hn('a')]!.enabled = true
    const { matched, disabledSkips } = matchHooksForEvent([hookA], 'PreToolUse', config)
    expect(matched).toHaveLength(1)
    expect(matched[0]!.name).toBe(hn('a'))
    expect(disabledSkips).toEqual([])
  })

  it('hook with enabled: false but no handler — appears in disabledSkips (disabled check before handler check)', () => {
    const hookA = makeLoadedHook('a', {
      PostToolUse: () => ({ result: 'skip' }),
    })
    const config = configForHooks('a')
    config.hooks[hn('a')]!.enabled = false
    // hookA does NOT handle PreToolUse, but enabled: false should still produce a disabledSkip
    const { matched, disabledSkips } = matchHooksForEvent([hookA], 'PreToolUse', config)
    expect(matched).toEqual([])
    expect(disabledSkips).toHaveLength(1)
    expect(disabledSkips[0]!.hook).toBe(hn('a'))
    expect(disabledSkips[0]!.reason).toBe('hook "a" disabled entirely via config')
  })

  it('hook with per-event enabled: false but no handler — appears in disabledSkips (disabled check before handler check)', () => {
    const hookA = makeLoadedHook('a', {
      PostToolUse: () => ({ result: 'skip' }),
    })
    const config = configForHooks('a')
    config.hooks[hn('a')]!.events = {
      PreToolUse: { enabled: false },
    }
    // hookA does NOT handle PreToolUse, but per-event enabled: false should still produce a disabledSkip
    const { matched, disabledSkips } = matchHooksForEvent([hookA], 'PreToolUse', config)
    expect(matched).toEqual([])
    expect(disabledSkips).toHaveLength(1)
    expect(disabledSkips[0]!.hook).toBe(hn('a'))
    expect(disabledSkips[0]!.reason).toBe('hook "a" disabled for event "PreToolUse" via config')
  })
})

// --- interpolateMessage ---

describe('interpolateMessage', () => {
  it('substitutes all four variables correctly', () => {
    const result = interpolateMessage(
      "Hook '{hook}' failed {count} times on {event}. Error: {error}",
      { hook: hn('my-hook'), event: 'PreToolUse', count: 3, error: 'boom' },
    )
    expect(result).toBe("Hook 'my-hook' failed 3 times on PreToolUse. Error: boom")
  })

  it('handles $ characters in error messages', () => {
    const result = interpolateMessage('Error: {error}', {
      hook: hn('h'),
      event: 'PreToolUse',
      count: 1,
      error: 'found $1 in path',
    })
    expect(result).toBe('Error: found $1 in path')
  })
})

// --- executeHooks (circuit breaker) ---

let tempDir: string

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-engine-test-'))
  mkdirSync(join(tempDir, '.clooks'), { recursive: true })
  return tempDir
}

/** Compute the failure file path for a temp dir (project-local path). */
function fp(dir: string): string {
  return join(dir, '.clooks/.failures')
}

function makeTestConfig(
  hookOverrides: Record<
    string,
    {
      parallel?: boolean
      maxFailures?: number
      maxFailuresMessage?: string
      onError?: import('./config/schema.js').ErrorMode
      events?: Record<string, { onError?: import('./config/schema.js').ErrorMode }>
    }
  > = {},
  globalMaxFailures = 3,
  globalOnError: import('./config/schema.js').ErrorMode = 'block',
): ClooksConfig {
  const hooks = {} as Record<HookName, import('./config/schema.js').HookEntry>
  for (const [name, overrides] of Object.entries(hookOverrides)) {
    hooks[hn(name)] = {
      resolvedPath: `.clooks/hooks/${name}.ts`,
      config: {},
      parallel: false,
      origin: 'project',
      ...overrides,
    }
  }
  return {
    version: '1.0.0',
    global: {
      timeout: ms(30000),
      onError: globalOnError,
      maxFailures: globalMaxFailures,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
    },
    hooks,
    events: {},
  }
}

describe('executeHooks', () => {
  it('hook fails under threshold → fail-closed (block result)', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('fail-hook', {
      PreToolUse: () => {
        throw new Error('boom')
      },
    })
    const config = makeTestConfig({ 'fail-hook': {} })

    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult?.result).toBe('block')
    expect(result.lastResult?.reason).toContain('fail-hook')
    expect(result.lastResult?.reason).toContain('boom')
    expect(result.traceMessages).toEqual([])
    expect(result.systemMessages).toEqual([])

    // Failure state should be written
    const state = await readFailures(fp(dir))
    expect(state[hn('fail-hook')]?.['PreToolUse']?.consecutiveFailures).toBe(1)
  })

  it('hook reaches threshold → skipped (degraded, no block result)', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('fail-hook', {
      PreToolUse: () => {
        throw new Error('boom')
      },
    })
    const config = makeTestConfig({ 'fail-hook': {} }, 3)

    // Fail twice (under threshold — produces block results)
    for (let i = 0; i < 2; i++) {
      const r = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
      expect(r.lastResult?.result).toBe('block')
    }

    // Third failure should NOT block — hook is degraded
    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult).toBeUndefined()
    expect(result.degradedMessages).toHaveLength(1)
    expect(result.degradedMessages[0]).toContain('fail-hook')
  })

  it('hook already degraded → skipped and reminder message collected', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('fail-hook', {
      PreToolUse: () => {
        throw new Error('still broken')
      },
    })
    const config = makeTestConfig({ 'fail-hook': {} }, 3)

    // Fail 3 times to enter degraded state (first 2 produce block, 3rd degrades)
    for (let i = 0; i < 2; i++) {
      await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    }
    await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))

    // Fourth invocation — still degraded
    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.degradedMessages).toHaveLength(1)
    expect(result.degradedMessages[0]).toContain('still broken')
  })

  it('hook recovers after being degraded → failure state cleared, result used', async () => {
    const dir = makeTempDir()
    let shouldThrow = true
    const hook = makeLoadedHook('recover-hook', {
      PreToolUse: () => {
        if (shouldThrow) throw new Error('broken')
        return { result: 'allow' }
      },
    })
    const config = makeTestConfig({ 'recover-hook': {} }, 3)

    // Fail 3 times (first 2 produce block, 3rd degrades)
    for (let i = 0; i < 2; i++) {
      await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    }
    await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))

    // Fix the hook
    shouldThrow = false
    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult).toEqual({ result: 'allow' })
    expect(result.degradedMessages).toHaveLength(0)

    // Failure state should be cleared
    const state = await readFailures(fp(dir))
    expect(state[hn('recover-hook')]).toBeUndefined()
  })

  it('maxFailures: 0 → always fail-closed (block result), never degrades', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('strict-hook', {
      PreToolUse: () => {
        throw new Error('boom')
      },
    })
    const config = makeTestConfig({ 'strict-hook': { maxFailures: 0 } })

    // Should always produce block result, even after many failures
    for (let i = 0; i < 5; i++) {
      const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
      expect(result.lastResult?.result).toBe('block')
      expect(result.lastResult?.reason).toContain('boom')
    }
  })

  it('degraded message uses injectContext for injectable events (PreToolUse)', async () => {
    const dir = makeTempDir()
    // A hook that succeeds + a hook that fails
    const goodHook = makeLoadedHook('good-hook', {
      PreToolUse: () => ({ result: 'allow' }),
    })
    const badHook = makeLoadedHook('bad-hook', {
      PreToolUse: () => {
        throw new Error('boom')
      },
    })
    const config = makeTestConfig({ 'good-hook': {}, 'bad-hook': {} }, 3)

    // Fail the bad hook 3 times (first 2 produce block after good-hook runs, 3rd degrades)
    for (let i = 0; i < 2; i++) {
      await executeHooks([goodHook, badHook], 'PreToolUse', {}, config, fp(dir))
    }

    const result = await executeHooks([goodHook, badHook], 'PreToolUse', {}, config, fp(dir))
    // Good hook's result should be used
    expect(result.lastResult).toEqual({ result: 'allow' })
    // Degraded message should be present
    expect(result.degradedMessages).toHaveLength(1)
    expect(result.degradedMessages[0]).toContain('bad-hook')
  })

  it('multiple degraded hooks → messages collected separately', async () => {
    const dir = makeTempDir()
    const badHook1 = makeLoadedHook('bad-1', {
      PreToolUse: () => {
        throw new Error('err1')
      },
    })
    const badHook2 = makeLoadedHook('bad-2', {
      PreToolUse: () => {
        throw new Error('err2')
      },
    })
    const config = makeTestConfig({ 'bad-1': {}, 'bad-2': {} }, 1)

    // With maxFailures=1, the first failure triggers degradation
    const result = await executeHooks([badHook1, badHook2], 'PreToolUse', {}, config, fp(dir))
    expect(result.degradedMessages).toHaveLength(2)
    expect(result.degradedMessages[0]).toContain('bad-1')
    expect(result.degradedMessages[1]).toContain('bad-2')
  })

  it('resolveMaxFailures cascade: hook-level overrides global', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('custom-hook', {
      PreToolUse: () => {
        throw new Error('boom')
      },
    })
    // Global maxFailures=3, but hook override maxFailures=1
    const config = makeTestConfig({ 'custom-hook': { maxFailures: 1 } }, 3)

    // First failure should trigger degradation (maxFailures=1)
    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.degradedMessages).toHaveLength(1)
  })

  it('degraded message written to stderr for non-injectable events', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('fail-hook', {
      // SessionEnd is not injectable
      SessionEnd: () => {
        throw new Error('boom')
      },
    })
    const config = makeTestConfig({ 'fail-hook': {} }, 1)

    // executeHooks just collects messages — stderr handling is in runEngine
    const result = await executeHooks([hook], 'SessionEnd', {}, config, fp(dir))
    expect(result.degradedMessages).toHaveLength(1)
  })

  // --- Load error circuit breaker ---

  it('load error under threshold → fail-closed (block result)', async () => {
    const dir = makeTempDir()
    const loadErrors: HookLoadError[] = [
      { name: hn('broken-hook'), error: "Cannot find module '/path/to/broken-hook.ts'" },
    ]
    const config = makeTestConfig({ 'broken-hook': {} }, 3)

    const result = await executeHooks([], 'PreToolUse', {}, config, fp(dir), loadErrors)
    expect(result.lastResult?.result).toBe('block')
    expect(result.lastResult?.reason).toContain('broken-hook')

    // Load errors use LOAD_ERROR_EVENT, not the actual event name
    const state = await readFailures(fp(dir))
    expect(state[hn('broken-hook')]?.[LOAD_ERROR_EVENT]?.consecutiveFailures).toBe(1)
    expect(state[hn('broken-hook')]?.['PreToolUse']).toBeUndefined()
  })

  it('load error reaches threshold → skipped with degraded message', async () => {
    const dir = makeTempDir()
    const loadErrors: HookLoadError[] = [
      { name: hn('broken-hook'), error: "Cannot find module '/path/to/broken-hook.ts'" },
    ]
    const config = makeTestConfig({ 'broken-hook': {} }, 3)

    // Fail twice (under threshold — produces block results)
    for (let i = 0; i < 2; i++) {
      const r = await executeHooks([], 'PreToolUse', {}, config, fp(dir), loadErrors)
      expect(r.lastResult?.result).toBe('block')
    }

    // Third failure — should skip (degraded), not block
    const result = await executeHooks([], 'PreToolUse', {}, config, fp(dir), loadErrors)
    expect(result.degradedMessages).toHaveLength(1)
    expect(result.degradedMessages[0]).toContain('broken-hook')
  })

  it('load error does not block successfully loaded hooks', async () => {
    const dir = makeTempDir()
    const goodHook = makeLoadedHook('good-hook', {
      PreToolUse: () => ({ result: 'allow' }),
    })
    const loadErrors: HookLoadError[] = [{ name: hn('broken-hook'), error: 'Cannot find module' }]
    // maxFailures=1 so load error degrades immediately
    const config = makeTestConfig({ 'good-hook': {}, 'broken-hook': {} }, 1)

    const result = await executeHooks([goodHook], 'PreToolUse', {}, config, fp(dir), loadErrors)
    expect(result.lastResult).toEqual({ result: 'allow' })
    expect(result.degradedMessages).toHaveLength(1)
    expect(result.degradedMessages[0]).toContain('broken-hook')
  })

  it('load errors use event-independent counting across different events', async () => {
    const dir = makeTempDir()
    const loadErrors: HookLoadError[] = [
      { name: hn('broken-hook'), error: "Cannot find module '/path/to/broken-hook.ts'" },
    ]
    const config = makeTestConfig({ 'broken-hook': {} }, 3)

    // Fail on PreToolUse (count=1)
    const r1 = await executeHooks([], 'PreToolUse', {}, config, fp(dir), loadErrors)
    expect(r1.lastResult?.result).toBe('block')

    // Fail on PostToolUse (count=2, same counter via LOAD_ERROR_EVENT)
    const r2 = await executeHooks([], 'PostToolUse', {}, config, fp(dir), loadErrors)
    expect(r2.lastResult?.result).toBe('block')

    // Third failure on SessionStart (count=3) — should degrade, not block
    const r3 = await executeHooks([], 'SessionStart', {}, config, fp(dir), loadErrors)
    expect(r3.lastResult).toBeUndefined()
    expect(r3.degradedMessages).toHaveLength(1)
    expect(r3.degradedMessages[0]).toContain('broken-hook')

    // Verify single counter under LOAD_ERROR_EVENT
    const state = await readFailures(fp(dir))
    expect(state[hn('broken-hook')]?.[LOAD_ERROR_EVENT]?.consecutiveFailures).toBe(3)
    expect(state[hn('broken-hook')]?.['PreToolUse']).toBeUndefined()
    expect(state[hn('broken-hook')]?.['PostToolUse']).toBeUndefined()
    expect(state[hn('broken-hook')]?.['SessionStart']).toBeUndefined()
  })

  it('load error under threshold includes actionable system message', async () => {
    const dir = makeTempDir()
    const loadErrors: HookLoadError[] = [
      {
        name: hn('order-tracer-home'),
        error: "Cannot find module '/home/joe/.clooks/hooks/order-tracer-home.ts'",
      },
    ]
    const config = makeTestConfig({ 'order-tracer-home': {} }, 3)

    const result = await executeHooks([], 'PreToolUse', {}, config, fp(dir), loadErrors)
    expect(result.lastResult?.result).toBe('block')
    expect(result.systemMessages).toHaveLength(1)
    expect(result.systemMessages[0]).toContain('[clooks] Hook "order-tracer-home" failed to load')
    expect(result.systemMessages[0]).toContain('Cannot find module')
    expect(result.systemMessages[0]).toContain('Fix: Remove')
    expect(result.systemMessages[0]).toContain('clooks.yml')
    expect(result.systemMessages[0]).toContain('disabled after 3 consecutive load failures')
  })

  it('load error at threshold includes disabled system message', async () => {
    const dir = makeTempDir()
    const loadErrors: HookLoadError[] = [
      {
        name: hn('order-tracer-home'),
        error: "Cannot find module '/home/joe/.clooks/hooks/order-tracer-home.ts'",
      },
    ]
    const config = makeTestConfig({ 'order-tracer-home': {} }, 3)

    // Fail twice to reach threshold
    for (let i = 0; i < 2; i++) {
      await executeHooks([], 'PreToolUse', {}, config, fp(dir), loadErrors)
    }

    // Third failure — threshold reached, should degrade
    const result = await executeHooks([], 'PostToolUse', {}, config, fp(dir), loadErrors)
    expect(result.lastResult).toBeUndefined()
    expect(result.systemMessages).toHaveLength(1)
    expect(result.systemMessages[0]).toContain(
      '[clooks] Hook "order-tracer-home" has been disabled',
    )
    expect(result.systemMessages[0]).toContain('3 consecutive load failures')
    expect(result.systemMessages[0]).toContain('Fix: Remove')
  })

  // --- FEAT-0017: onError cascade tests ---

  it("onError 'continue' — no block, systemMessage collected", async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('notify-hook', {
      PreToolUse: () => {
        throw new Error('notify failed')
      },
    })
    const config = makeTestConfig({ 'notify-hook': { onError: 'continue' } })

    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult).toBeUndefined()
    expect(result.systemMessages).toHaveLength(1)
    expect(result.systemMessages[0]).toContain('notify-hook')
    expect(result.systemMessages[0]).toContain('Continuing')
    expect(result.traceMessages).toEqual([])
  })

  it("onError 'trace' — no block, trace message collected", async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('trace-hook', {
      PreToolUse: () => {
        throw new Error('trace failed')
      },
    })
    const config = makeTestConfig({ 'trace-hook': { onError: 'trace' } })

    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult).toBeUndefined()
    expect(result.traceMessages).toHaveLength(1)
    expect(result.traceMessages[0]).toContain('trace-hook')
    expect(result.traceMessages[0]).toContain('onError: trace')
    expect(result.systemMessages).toEqual([])
  })

  it("onError 'block' — produces block result, stops pipeline", async () => {
    const dir = makeTempDir()
    const hook1 = makeLoadedHook('block-hook', {
      PreToolUse: () => {
        throw new Error('blocked')
      },
    })
    const hook2 = makeLoadedHook('after-hook', {
      PreToolUse: () => ({ result: 'allow' }),
    })
    const config = makeTestConfig({ 'block-hook': {}, 'after-hook': {} })

    const result = await executeHooks([hook1, hook2], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult?.result).toBe('block')
    expect(result.lastResult?.reason).toContain('blocked')
  })

  it("onError 'continue' skips recordFailure", async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('continue-hook', {
      PreToolUse: () => {
        throw new Error('err')
      },
    })
    const config = makeTestConfig({ 'continue-hook': { onError: 'continue' } })

    await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    const state = await readFailures(fp(dir))
    expect(state[hn('continue-hook')]).toBeUndefined()
  })

  it("onError 'trace' skips recordFailure", async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('trace-hook', {
      PreToolUse: () => {
        throw new Error('err')
      },
    })
    const config = makeTestConfig({ 'trace-hook': { onError: 'trace' } })

    await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    const state = await readFailures(fp(dir))
    expect(state[hn('trace-hook')]).toBeUndefined()
  })

  it('import failure always blocks regardless of hook onError', async () => {
    const dir = makeTempDir()
    const loadErrors: HookLoadError[] = [{ name: hn('broken-hook'), error: 'Cannot find module' }]
    const config = makeTestConfig({ 'broken-hook': { onError: 'continue' } })

    const result = await executeHooks([], 'PreToolUse', {}, config, fp(dir), loadErrors)
    expect(result.lastResult?.result).toBe('block')
  })

  it('trace falls back to continue for non-injectable events', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('trace-hook', {
      SessionEnd: () => {
        throw new Error('err')
      },
    })
    const config = makeTestConfig({ 'trace-hook': { onError: 'trace' } })

    const result = await executeHooks([hook], 'SessionEnd', {}, config, fp(dir))
    expect(result.traceMessages).toEqual([])
    expect(result.systemMessages.length).toBeGreaterThanOrEqual(1)
    expect(result.systemMessages[0]).toContain('Falling back')
  })
})

// --- resolveOnError ---

describe('resolveOnError', () => {
  it('hook+event overrides hook-level', () => {
    const config = makeTestConfig({
      scanner: {
        onError: 'block',
        events: { PreToolUse: { onError: 'trace' } },
      },
    })
    expect(resolveOnError(hn('scanner'), 'PreToolUse', config)).toBe('trace')
  })

  it('hook-level overrides global', () => {
    const config = makeTestConfig({ scanner: { onError: 'continue' } })
    expect(resolveOnError(hn('scanner'), 'PreToolUse', config)).toBe('continue')
  })

  it('defaults to global when no hook overrides', () => {
    const config = makeTestConfig({}, 3, 'continue')
    expect(resolveOnError(hn('unknown'), 'PreToolUse', config)).toBe('continue')
  })

  it('full cascade: hook+event → hook → global', () => {
    const config = makeTestConfig(
      {
        scanner: {
          onError: 'continue',
          events: { PreToolUse: { onError: 'trace' } },
        },
      },
      3,
      'block',
    )
    expect(resolveOnError(hn('scanner'), 'PreToolUse', config)).toBe('trace')
    expect(resolveOnError(hn('scanner'), 'PostToolUse', config)).toBe('continue')
    expect(resolveOnError(hn('unknown'), 'PreToolUse', config)).toBe('block')
  })
})

// --- FEAT-0017 M4: Trace and systemMessage output integration ---

describe('trace and systemMessage integration', () => {
  it('trace messages injected into injectContext on injectable event', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('trace-hook', {
      PreToolUse: () => {
        throw new Error('trace err')
      },
    })
    const config = makeTestConfig({ 'trace-hook': { onError: 'trace' } })

    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.traceMessages).toHaveLength(1)

    // Simulate runEngine trace injection
    let lastResult = result.lastResult
    if (result.traceMessages.length > 0) {
      const traceBlock = result.traceMessages.join('\n')
      if (lastResult === undefined) {
        lastResult = { result: 'allow', injectContext: traceBlock }
      }
    }
    expect(lastResult?.injectContext).toContain('trace-hook')
    expect(lastResult?.injectContext).toContain('onError: trace')
  })

  it('multiple trace messages concatenated with newlines', async () => {
    const dir = makeTempDir()
    const hook1 = makeLoadedHook('trace-1', {
      PreToolUse: () => {
        throw new Error('err1')
      },
    })
    const hook2 = makeLoadedHook('trace-2', {
      PreToolUse: () => {
        throw new Error('err2')
      },
    })
    const config = makeTestConfig({
      'trace-1': { onError: 'trace' },
      'trace-2': { onError: 'trace' },
    })

    const result = await executeHooks([hook1, hook2], 'PreToolUse', {}, config, fp(dir))
    expect(result.traceMessages).toHaveLength(2)

    // Simulate runEngine trace injection
    const traceBlock = result.traceMessages.join('\n')
    expect(traceBlock).toContain('trace-1')
    expect(traceBlock).toContain('trace-2')
  })

  it('systemMessage injected into translated output JSON', () => {
    // Simulate the systemMessage injection logic in runEngine
    const translated: { output?: string; exitCode: number; stderr?: string } = {
      output: JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
      }),
      exitCode: 0,
    }
    const systemMessages = ['Hook error: continue mode']

    if (systemMessages.length > 0) {
      const systemMessage = systemMessages.join('\n')
      if (translated.output) {
        const parsed = JSON.parse(translated.output)
        parsed.systemMessage = systemMessage
        translated.output = JSON.stringify(parsed)
      }
    }

    const final = JSON.parse(translated.output!)
    expect(final.systemMessage).toBe('Hook error: continue mode')
    expect(final.hookSpecificOutput.permissionDecision).toBe('allow')
  })

  it('systemMessage created as minimal JSON when no output exists', () => {
    const translated: { output?: string; exitCode: number; stderr?: string } = {
      exitCode: 0,
    }
    const systemMessages = ['Startup warning']

    if (systemMessages.length > 0) {
      const systemMessage = systemMessages.join('\n')
      if (translated.output) {
        const parsed = JSON.parse(translated.output)
        parsed.systemMessage = systemMessage
        translated.output = JSON.stringify(parsed)
      } else {
        translated.output = JSON.stringify({ systemMessage })
      }
    }

    const final = JSON.parse(translated.output!)
    expect(final.systemMessage).toBe('Startup warning')
  })
})

// --- FEAT-0016 M3: Sequential pipeline with updatedInput ---

describe('sequential pipeline: updatedInput', () => {
  it('updatedInput piped from hook A to hook B (sequential live state; M3 reducer is authoritative for final result)', async () => {
    const dir = makeTempDir()
    let capturedCtx: Record<string, unknown> | undefined

    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { file_path: '/modified' } }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: (ctx: Record<string, unknown>) => {
        capturedCtx = ctx
        return { result: 'allow' }
      },
    })
    const config = makeTestConfig({ hookA: {}, hookB: {} })
    const normalized = { event: 'PreToolUse', toolInput: { file_path: '/original' } }

    const result = await executeHooks([hookA, hookB], 'PreToolUse', normalized, config, fp(dir))
    expect(result.lastResult?.result).toBe('allow')

    // Hook B still receives the modified toolInput from hook A (sequential live state is still propagated)
    expect(capturedCtx?.toolInput).toEqual({ file_path: '/modified' })
    // Hook B should have received the original toolInput as originalToolInput
    expect(capturedCtx?.originalToolInput).toEqual({ file_path: '/original' })

    // Reducer emits the merged currentToolInput when any hook contributed one.
    // Winner (hookB) has no patch of its own, but hookA's patch merges onto the
    // original and that full-shape object reaches the wire.
    expect(result.lastResult?.updatedInput).toEqual({ file_path: '/modified' })
  })

  it('originalToolInput stays frozen across chain (M3: reducer is authoritative for final result)', async () => {
    const dir = makeTempDir()
    let capturedCtxC: Record<string, unknown> | undefined

    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { file_path: '/step1', extra: 'a' } }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { file_path: '/step2', extra: 'b' } }),
    })
    const hookC = makeLoadedHook('hookC', {
      PreToolUse: (ctx: Record<string, unknown>) => {
        capturedCtxC = ctx
        return { result: 'allow' }
      },
    })
    const config = makeTestConfig({ hookA: {}, hookB: {}, hookC: {} })
    const normalized = { event: 'PreToolUse', toolInput: { file_path: '/original' } }

    const result = await executeHooks(
      [hookA, hookB, hookC],
      'PreToolUse',
      normalized,
      config,
      fp(dir),
    )
    expect(result.lastResult?.result).toBe('allow')

    // Hook C still receives B's updatedInput as toolInput (sequential live state still propagated)
    expect(capturedCtxC?.toolInput).toEqual({ file_path: '/step2', extra: 'b' })
    // originalToolInput is always the original
    expect(capturedCtxC?.originalToolInput).toEqual({ file_path: '/original' })

    // Final wire payload is the cumulative merge of hookA's and hookB's patches
    // onto the original, even though hookC (the winner) contributed no patch.
    expect(result.lastResult?.updatedInput).toEqual({ file_path: '/step2', extra: 'b' })
  })

  it('block in middle does NOT stop chain (M3 collect-all: all PreToolUse hooks run, deny wins)', async () => {
    const dir = makeTempDir()
    let hookCRan = false

    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow' }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'block', reason: 'blocked by B' }),
    })
    const hookC = makeLoadedHook('hookC', {
      PreToolUse: () => {
        hookCRan = true
        return { result: 'allow' }
      },
    })
    const config = makeTestConfig({ hookA: {}, hookB: {}, hookC: {} })

    const result = await executeHooks([hookA, hookB, hookC], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult?.result).toBe('block')
    expect(result.lastResult?.reason).toBe('blocked by B')
    // M3: collect-all — ALL hooks run regardless of block votes
    expect(hookCRan).toBe(true)
  })

  it('injectContext accumulates across hooks', async () => {
    const dir = makeTempDir()

    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow', injectContext: 'context from A' }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'allow', injectContext: 'context from B' }),
    })
    const config = makeTestConfig({ hookA: {}, hookB: {} })

    const result = await executeHooks([hookA, hookB], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.injectContext).toBe('context from A\ncontext from B')
  })

  it('sequential pipeline: block in later group includes prior group injectContext', async () => {
    const dir = makeTempDir()
    // Hook A is parallel, returns allow with injectContext
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow', injectContext: 'context-from-A' }),
    })
    // Hook B is sequential, returns block with its own injectContext
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'block', reason: 'blocked', injectContext: 'context-from-B' }),
    })
    // Make hookA parallel so they end up in different groups
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: {} })

    const result = await executeHooks([hookA, hookB], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult?.result).toBe('block')
    // injectContext should include both A's and B's context
    expect(result.lastResult?.injectContext).toContain('context-from-A')
    expect(result.lastResult?.injectContext).toContain('context-from-B')
  })
})

describe('timeout enforcement', () => {
  it('timeout fires and is treated as error', async () => {
    const dir = makeTempDir()

    const hookSlow = makeLoadedHook('slow-hook', {
      PreToolUse: () =>
        new Promise(() => {
          // Never resolves
        }),
    })
    const config = makeTestConfig({ 'slow-hook': {} })
    // Override global timeout to be very short
    config.global.timeout = ms(50)

    const result = await executeHooks([hookSlow], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult?.result).toBe('block')
    expect(result.lastResult?.reason).toContain('slow-hook')
    expect(result.lastResult?.reason).toContain('timed out')
  })
})

describe('translateResult updatedInput', () => {
  it('passes through updatedInput on PreToolUse allow', () => {
    const out = translateResult('PreToolUse', {
      result: 'allow',
      updatedInput: { x: 1 },
    })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.updatedInput).toEqual({ x: 1 })
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow')
  })

  it('does not include updatedInput when not present', () => {
    const out = translateResult('PreToolUse', { result: 'allow' })
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.output!)
    expect(parsed.hookSpecificOutput.updatedInput).toBeUndefined()
  })
})

// --- FEAT-0016 M4: Parallel batch execution ---

describe('parallel batch', () => {
  it('hooks run concurrently', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: async () => {
        await Bun.sleep(50)
        return { result: 'allow', injectContext: 'A' }
      },
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: async () => {
        await Bun.sleep(50)
        return { result: 'allow', injectContext: 'B' }
      },
    })
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: { parallel: true } })

    const start = performance.now()
    const result = await executeHooks([hookA, hookB], 'PreToolUse', {}, config, fp(dir))
    const elapsed = performance.now() - start

    expect(result.lastResult?.result).toBe('allow')
    // Both ran — injectContext has both values
    expect(result.lastResult?.injectContext).toContain('A')
    expect(result.lastResult?.injectContext).toContain('B')
    // Concurrent: should be ~50ms, not ~100ms. Allow generous margin.
    expect(elapsed).toBeLessThan(90)
  })

  it('injectContext from multiple hooks merged', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow', injectContext: 'context-A' }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'allow', injectContext: 'context-B' }),
    })
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: { parallel: true } })

    const result = await executeHooks([hookA, hookB], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.injectContext).toContain('context-A')
    expect(result.lastResult?.injectContext).toContain('context-B')
    // Newline-joined
    expect(result.lastResult?.injectContext).toBe('context-A\ncontext-B')
  })

  it("UserPromptSubmit multi-hook sessionTitle → last non-skip hook's sessionTitle wins", async () => {
    // sessionTitle cannot be concatenated the way injectContext can — upstream
    // accepts a single session title per response. The engine preserves
    // last-writer-wins semantics: the final non-skip result's fields (other
    // than injectContext) carry forward. This test pins that contract.
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      UserPromptSubmit: () => ({ result: 'allow', sessionTitle: 'First' }),
    })
    const hookB = makeLoadedHook('hookB', {
      UserPromptSubmit: () => ({ result: 'allow', sessionTitle: 'Second' }),
    })
    // Sequential (no `parallel: true`) so ordering is deterministic: A then B.
    const config = makeTestConfig({ hookA: {}, hookB: {} })

    const result = await executeHooks([hookA, hookB], 'UserPromptSubmit', {}, config, fp(dir))
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.sessionTitle).toBe('Second')

    // Verify the translated wire output also carries the last writer's title.
    const translated = translateResult('UserPromptSubmit', result.lastResult!)
    const parsed = JSON.parse(translated.output!)
    expect(parsed.hookSpecificOutput.sessionTitle).toBe('Second')
  })

  it('block does NOT short-circuit for PreToolUse (M3 collect-all: both hooks run)', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'block', reason: 'denied' }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: async () => {
        await Bun.sleep(50)
        return { result: 'allow' }
      },
    })
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: { parallel: true } })

    const start = performance.now()
    const result = await executeHooks([hookA, hookB], 'PreToolUse', {}, config, fp(dir))
    const elapsed = performance.now() - start

    expect(result.lastResult?.result).toBe('block')
    expect(result.lastResult?.reason).toBe('denied')
    // M3: block does NOT short-circuit for PreToolUse — both hooks run (~50ms, not instant)
    expect(elapsed).toBeGreaterThan(30)
    expect(elapsed).toBeLessThan(500)
  })

  it('crash with onError block short-circuits', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => {
        throw new Error('crash')
      },
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: async () => {
        await Bun.sleep(500)
        return { result: 'allow' }
      },
    })
    const config = makeTestConfig({
      hookA: { parallel: true, onError: 'block' },
      hookB: { parallel: true },
    })

    const start = performance.now()
    const result = await executeHooks([hookA, hookB], 'PreToolUse', {}, config, fp(dir))
    const elapsed = performance.now() - start

    expect(result.lastResult?.result).toBe('block')
    expect(result.lastResult?.reason).toContain('crash')
    expect(elapsed).toBeLessThan(200)
  })

  it('crash with onError continue waits for others', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => {
        throw new Error('non-fatal')
      },
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: async () => {
        await Bun.sleep(50)
        return { result: 'allow', injectContext: 'B-ok' }
      },
    })
    const config = makeTestConfig({
      hookA: { parallel: true, onError: 'continue' },
      hookB: { parallel: true },
    })

    const result = await executeHooks([hookA, hookB], 'PreToolUse', {}, config, fp(dir))
    // Hook B's result should be used
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.injectContext).toContain('B-ok')
    // Hook A's failure logged as systemMessage
    expect(result.systemMessages.length).toBeGreaterThanOrEqual(1)
    expect(result.systemMessages[0]).toContain('non-fatal')
  })

  it('updatedInput is contract violation', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { x: 1 } }),
    })
    const config = makeTestConfig({ hookA: { parallel: true } })

    const result = await executeHooks([hookA], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult?.result).toBe('block')
    expect(result.lastResult?.reason).toContain('contract violation')
    expect(result.lastResult?.reason).toContain('hookA')

    // Should count toward maxFailures
    const state = await readFailures(fp(dir))
    expect(state[hn('hookA')]?.['PreToolUse']?.consecutiveFailures).toBe(1)
  })

  it('all skip — M3 reducer returns skip winner (not undefined)', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'skip' }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'skip' }),
    })
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: { parallel: true } })

    const result = await executeHooks([hookA, hookB], 'PreToolUse', {}, config, fp(dir))
    // M3: all-skip → reducer returns one of the skip votes (last-seen wins); skip winner is returned
    expect(result.lastResult?.result).toBe('skip')
    expect(result.degradedMessages).toEqual([])
    expect(result.traceMessages).toEqual([])
  })

  it('circuit breaker updated after all settle', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => {
        throw new Error('err-A')
      },
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => {
        throw new Error('err-B')
      },
    })
    const config = makeTestConfig({
      hookA: { parallel: true, onError: 'block' },
      hookB: { parallel: true, onError: 'block' },
    })

    await executeHooks([hookA, hookB], 'PreToolUse', {}, config, fp(dir))

    // Both failures should be recorded
    const state = await readFailures(fp(dir))
    expect(state[hn('hookA')]?.['PreToolUse']?.consecutiveFailures).toBe(1)
    expect(state[hn('hookB')]?.['PreToolUse']?.consecutiveFailures).toBe(1)
  })

  it('degraded hook in parallel group does not block pipeline', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => {
        throw new Error('degraded-err')
      },
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'allow', injectContext: 'B-ok' }),
    })
    // maxFailures=1 so first failure degrades immediately
    const config = makeTestConfig({
      hookA: { parallel: true, onError: 'block', maxFailures: 1 },
      hookB: { parallel: true },
    })

    const result = await executeHooks([hookA, hookB], 'PreToolUse', {}, config, fp(dir))
    // Hook A is degraded — should NOT block
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.injectContext).toContain('B-ok')
    expect(result.degradedMessages).toHaveLength(1)
    expect(result.degradedMessages[0]).toContain('hookA')
  })

  it('skip result clears failure state in parallel (matching sequential runner)', async () => {
    const dir = makeTempDir()
    let callCount = 0
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => {
        callCount++
        if (callCount <= 1) throw new Error('first-fail')
        return { result: 'skip' }
      },
    })
    const config = makeTestConfig({
      hookA: { parallel: true, onError: 'block', maxFailures: 0 },
    })

    // First call: failure recorded
    await executeHooks([hookA], 'PreToolUse', {}, config, fp(dir))
    const state1 = await readFailures(fp(dir))
    expect(state1[hn('hookA')]?.['PreToolUse']?.consecutiveFailures).toBe(1)

    // Second call: returns skip — should still clear failure state
    await executeHooks([hookA], 'PreToolUse', {}, config, fp(dir))
    const state2 = await readFailures(fp(dir))
    expect(state2[hn('hookA')]).toBeUndefined()
  })

  it('AbortSignal NOT fired on PreToolUse block (M3: block is a vote, not a pipeline terminator)', async () => {
    const dir = makeTempDir()
    let signalAborted = false

    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'block', reason: 'blocked' }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: async (ctx: Record<string, unknown>) => {
        const signal = ctx.signal as AbortSignal
        // Wait a tick to let hookA's result propagate
        await Bun.sleep(20)
        signalAborted = signal.aborted
        return { result: 'allow' }
      },
    })
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: { parallel: true } })

    const result = await executeHooks([hookA, hookB], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult?.result).toBe('block')
    // Give hookB a moment to check the signal
    await Bun.sleep(30)
    // M3: block does not short-circuit for PreToolUse — signal is NOT aborted
    expect(signalAborted).toBe(false)
  })

  it('parallel batch: block result injectContext merged with other hooks', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow', injectContext: 'from-allow' }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'block', reason: 'blocked', injectContext: 'from-block' }),
    })
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: { parallel: true } })

    const result = await executeHooks([hookA, hookB], 'PreToolUse', {}, config, fp(dir))

    expect(result.lastResult?.result).toBe('block')
    expect(result.lastResult?.injectContext).toContain('from-allow')
    expect(result.lastResult?.injectContext).toContain('from-block')
  })

  it('load error recovery clears LOAD_ERROR_EVENT counter when hook loads successfully', async () => {
    const dir = makeTempDir()

    // Simulate a hook that had load errors (manually seed failure state)
    const { writeFailures, recordFailure, LOAD_ERROR_EVENT: LEE } = await import('./failures.js')
    let state: Record<string, unknown> = {}
    state = recordFailure(state as any, hn('recovered-hook'), LEE as any, 'load failed')
    state = recordFailure(state as any, hn('recovered-hook'), LEE as any, 'load failed again')
    await writeFailures(fp(dir), state as any)

    // Now run a successfully loaded hook — should clear the load error counter
    const hook = makeLoadedHook('recovered-hook', {
      PreToolUse: () => ({ result: 'allow' }),
    })
    const config = makeTestConfig({ 'recovered-hook': {} })

    await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))

    const finalState = await readFailures(fp(dir))
    expect(finalState[hn('recovered-hook')]?.[LEE]).toBeUndefined()
  })

  it('sequential hook returning null/undefined is skipped', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('null-hook', {
      PreToolUse: () => null,
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'allow', injectContext: 'from-B' }),
    })
    const config = makeTestConfig({ 'null-hook': {}, hookB: {} })

    const result = await executeHooks([hookA, hookB], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.injectContext).toContain('from-B')
  })

  it('sequential hook with onError continue collects systemMessage', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('cont-hook', {
      PreToolUse: () => {
        throw new Error('soft-fail')
      },
    })
    const config = makeTestConfig({ 'cont-hook': { onError: 'continue' } })

    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult).toBeUndefined()
    expect(result.systemMessages.length).toBeGreaterThan(0)
    expect(result.systemMessages[0]).toContain('soft-fail')
  })

  it('sequential hook with onError trace collects traceMessage', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('trace-hook', {
      PreToolUse: () => {
        throw new Error('trace-err')
      },
    })
    const config = makeTestConfig({ 'trace-hook': { onError: 'trace' } })

    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult).toBeUndefined()
    expect(result.traceMessages.length).toBeGreaterThan(0)
    expect(result.traceMessages[0]).toContain('trace-err')
  })

  it('skip result with updatedMCPToolOutput promotes to lastNonSkipResult', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('mcp-hook', {
      PostToolUse: () => ({ result: 'skip', updatedMCPToolOutput: { data: 'transformed' } }),
    })
    const config = makeTestConfig({ 'mcp-hook': {} })

    const result = await executeHooks([hook], 'PostToolUse', {}, config, fp(dir))
    expect(result.lastResult?.updatedMCPToolOutput).toEqual({ data: 'transformed' })
  })

  it('parallel hook with onError trace on non-injectable event falls back to continue', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('trace-hook', {
      SessionEnd: () => {
        throw new Error('trace-non-inject')
      },
    })
    const config = makeTestConfig({ 'trace-hook': { onError: 'trace', parallel: true } })

    const result = await executeHooks([hook], 'SessionEnd' as any, {}, config, fp(dir))
    // Should fall back to continue — no block, and systemMessage about fallback
    expect(result.lastResult).toBeUndefined()
    expect(result.systemMessages.some((m) => m.includes('Falling back'))).toBe(true)
  })

  it('parallel hook with onError trace on injectable event collects traceMessage', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('par-trace', {
      PreToolUse: () => {
        throw new Error('par-trace-err')
      },
    })
    const config = makeTestConfig({ 'par-trace': { onError: 'trace', parallel: true } })

    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.traceMessages.length).toBeGreaterThan(0)
    expect(result.traceMessages[0]).toContain('par-trace-err')
  })

  it('parallel hook skip with injectContext — M3: skip losers context not propagated when allow wins', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('skip-inject', {
      PreToolUse: () => ({ result: 'skip', injectContext: 'skipped-context' }),
    })
    const hookB = makeLoadedHook('allow-hook', {
      PreToolUse: () => ({ result: 'allow' }),
    })
    const config = makeTestConfig({
      'skip-inject': { parallel: true },
      'allow-hook': { parallel: true },
    })

    const result = await executeHooks([hook, hookB], 'PreToolUse', {}, config, fp(dir))
    // M3: allow reducer only accumulates context from allow-result hooks, not skip losers.
    // Skip's injectContext is not propagated when an allow wins.
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.injectContext).toBeUndefined()
  })

  it('parallel hook skip with updatedMCPToolOutput promotes to lastNonSkipResult', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('mcp-par', {
      PostToolUse: () => ({ result: 'skip', updatedMCPToolOutput: { x: 1 } }),
    })
    const config = makeTestConfig({ 'mcp-par': { parallel: true } })

    const result = await executeHooks([hook], 'PostToolUse', {}, config, fp(dir))
    expect(result.lastResult?.updatedMCPToolOutput).toEqual({ x: 1 })
  })

  it('parallel hook with debugMessage is collected when debug env set', async () => {
    const dir = makeTempDir()
    const originalDebug = process.env.CLOOKS_DEBUG
    process.env.CLOOKS_DEBUG = 'true'

    const hook = makeLoadedHook('debug-hook', {
      PreToolUse: () => ({ result: 'allow', debugMessage: 'debug-info' }),
    })
    const config = makeTestConfig({ 'debug-hook': { parallel: true } })

    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.debugMessages).toContain('debug-info')

    if (originalDebug === undefined) {
      delete process.env.CLOOKS_DEBUG
    } else {
      process.env.CLOOKS_DEBUG = originalDebug
    }
  })

  it('parallel contract violation with degraded message when above threshold', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('violator', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { bad: true } }),
    })
    // maxFailures=1 means first violation is at threshold
    const config = makeTestConfig({ violator: { parallel: true, maxFailures: 1 } })

    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult?.result).toBe('block')
    expect(result.degradedMessages.length).toBeGreaterThan(0)
  })

  it('parallel hook with onError continue collects systemMessage', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('par-cont', {
      PreToolUse: () => {
        throw new Error('par-cont-err')
      },
    })
    const config = makeTestConfig({ 'par-cont': { onError: 'continue', parallel: true } })

    const result = await executeHooks([hook], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult).toBeUndefined()
    expect(result.systemMessages.some((m) => m.includes('par-cont-err'))).toBe(true)
  })
})

// --- FEAT-0016 M4: Mixed pipeline tests ---

describe('mixed pipeline', () => {
  it('sequential then parallel then sequential', async () => {
    const dir = makeTempDir()
    const warnSpy = spyOn(console, 'error').mockImplementation(() => {})
    let capturedParCtx: Record<string, unknown> | undefined
    let capturedSeqCCtx: Record<string, unknown> | undefined

    // Sequential group A — pipes updatedInput
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({
        result: 'allow',
        updatedInput: { file_path: '/modified-by-A' },
        injectContext: 'from-A',
      }),
    })
    // Parallel group B — receives modified toolInput, returns allow with injectContext
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: (ctx: Record<string, unknown>) => {
        capturedParCtx = ctx
        return { result: 'allow', injectContext: 'from-B' }
      },
    })
    // Sequential group C — receives merged state
    const hookC = makeLoadedHook('hookC', {
      PreToolUse: (ctx: Record<string, unknown>) => {
        capturedSeqCCtx = ctx
        return { result: 'allow', injectContext: 'from-C' }
      },
    })

    const config = makeTestConfig({
      hookA: { parallel: false },
      hookB: { parallel: true },
      hookC: { parallel: false },
    })
    // Force order: A, B, C via event order
    config.events = {
      PreToolUse: { order: [hn('hookA'), hn('hookB'), hn('hookC')] },
    }

    const normalized = { event: 'PreToolUse', toolInput: { file_path: '/original' } }
    const result = await executeHooks(
      [hookA, hookB, hookC],
      'PreToolUse',
      normalized,
      config,
      fp(dir),
    )

    expect(result.lastResult?.result).toBe('allow')

    // Parallel hook B received the modified toolInput from sequential hook A
    expect(capturedParCtx?.toolInput).toEqual({ file_path: '/modified-by-A' })
    expect(capturedParCtx?.originalToolInput).toEqual({ file_path: '/original' })
    expect(capturedParCtx?.parallel).toBe(true)

    // Sequential hook C also receives the modified toolInput (unchanged by parallel B)
    expect(capturedSeqCCtx?.toolInput).toEqual({ file_path: '/modified-by-A' })
    expect(capturedSeqCCtx?.originalToolInput).toEqual({ file_path: '/original' })
    expect(capturedSeqCCtx?.parallel).toBe(false)

    // All injectContext accumulated
    expect(result.lastResult?.injectContext).toContain('from-A')
    expect(result.lastResult?.injectContext).toContain('from-B')
    expect(result.lastResult?.injectContext).toContain('from-C')

    warnSpy.mockRestore()
  })

  it('parallel block does NOT stop subsequent groups for PreToolUse (M3 collect-all)', async () => {
    const dir = makeTempDir()
    let hookCRan = false

    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'block', reason: 'parallel-block' }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'allow' }),
    })
    const hookC = makeLoadedHook('hookC', {
      PreToolUse: () => {
        hookCRan = true
        return { result: 'allow' }
      },
    })

    const config = makeTestConfig({
      hookA: { parallel: true },
      hookB: { parallel: true },
      hookC: { parallel: false },
    })
    // Force order: parallel [A, B] then sequential [C]
    config.events = {
      PreToolUse: { order: [hn('hookA'), hn('hookB'), hn('hookC')] },
    }

    const result = await executeHooks([hookA, hookB, hookC], 'PreToolUse', {}, config, fp(dir))
    expect(result.lastResult?.result).toBe('block')
    expect(result.lastResult?.reason).toBe('parallel-block')
    // M3: block is a vote for PreToolUse — subsequent groups still run
    expect(hookCRan).toBe(true)
  })

  it('injectContext accumulates across all groups', async () => {
    const dir = makeTempDir()

    // Sequential group
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow', injectContext: 'seq-A' }),
    })
    // Parallel group
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'allow', injectContext: 'par-B' }),
    })
    const hookC = makeLoadedHook('hookC', {
      PreToolUse: () => ({ result: 'allow', injectContext: 'par-C' }),
    })
    // Sequential group
    const hookD = makeLoadedHook('hookD', {
      PreToolUse: () => ({ result: 'allow', injectContext: 'seq-D' }),
    })

    const config = makeTestConfig({
      hookA: { parallel: false },
      hookB: { parallel: true },
      hookC: { parallel: true },
      hookD: { parallel: false },
    })
    config.events = {
      PreToolUse: { order: [hn('hookA'), hn('hookB'), hn('hookC'), hn('hookD')] },
    }

    const result = await executeHooks(
      [hookA, hookB, hookC, hookD],
      'PreToolUse',
      {},
      config,
      fp(dir),
    )
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.injectContext).toBe('seq-A\npar-B\npar-C\nseq-D')
  })
})

// --- FEAT-0016 M5: Integration tests (full pipeline) ---

describe('integration: full pipeline', () => {
  it('full pipeline with ordering', async () => {
    const dir = makeTempDir()

    // Scanner is sequential, formatter is sequential.
    // Scanner returns updatedInput that formatter observes.
    // Declared in reverse order (formatter first, scanner second) to prove
    // that the order list controls execution, not declaration order.
    const formatter = makeLoadedHook('formatter', {
      PreToolUse: (ctx: Record<string, unknown>) => {
        // Formatter sees the toolInput modified by scanner
        const toolInput = ctx.toolInput as Record<string, unknown>
        return {
          result: 'allow',
          injectContext: `formatted:${toolInput.command}`,
        }
      },
    })
    const scanner = makeLoadedHook('scanner', {
      PreToolUse: () => ({
        result: 'allow',
        updatedInput: { command: 'scanned-cmd' },
        injectContext: 'scanned',
      }),
    })

    const config = makeTestConfig({
      scanner: { parallel: false },
      formatter: { parallel: false },
    })
    config.events = {
      PreToolUse: { order: [hn('scanner'), hn('formatter')] },
    }

    const normalized = { event: 'PreToolUse', toolInput: { command: 'original-cmd' } }
    // Pass hooks in reverse declaration order — order list should override
    const result = await executeHooks(
      [formatter, scanner],
      'PreToolUse',
      normalized,
      config,
      fp(dir),
    )

    expect(result.lastResult?.result).toBe('allow')
    // Formatter saw scanner's updatedInput (sequential live state still propagated to subsequent hooks)
    expect(result.lastResult?.injectContext).toBe('scanned\nformatted:scanned-cmd')
    // Wire payload is scanner's patch merged onto the original, even though
    // the winner (formatter) contributed no patch.
    expect(result.lastResult?.updatedInput).toEqual({ command: 'scanned-cmd' })
  })

  it('full pipeline with unordered hooks', async () => {
    const dir = makeTempDir()
    const executionOrder: string[] = []

    // Ordered hooks (in order list)
    const orderedA = makeLoadedHook('orderedA', {
      PreToolUse: () => {
        executionOrder.push('orderedA')
        return { result: 'allow', injectContext: 'orderedA' }
      },
    })
    const orderedB = makeLoadedHook('orderedB', {
      PreToolUse: () => {
        executionOrder.push('orderedB')
        return { result: 'allow', injectContext: 'orderedB' }
      },
    })

    // Unordered parallel hook — should run before ordered hooks
    const unorderedPar = makeLoadedHook('unorderedPar', {
      PreToolUse: () => {
        executionOrder.push('unorderedPar')
        return { result: 'allow', injectContext: 'unorderedPar' }
      },
    })

    // Unordered sequential hook — should run after ordered hooks
    const unorderedSeq = makeLoadedHook('unorderedSeq', {
      PreToolUse: () => {
        executionOrder.push('unorderedSeq')
        return { result: 'allow', injectContext: 'unorderedSeq' }
      },
    })

    const config = makeTestConfig({
      orderedA: { parallel: false },
      orderedB: { parallel: false },
      unorderedPar: { parallel: true },
      unorderedSeq: { parallel: false },
    })
    config.events = {
      PreToolUse: { order: [hn('orderedA'), hn('orderedB')] },
    }

    const result = await executeHooks(
      [orderedA, orderedB, unorderedPar, unorderedSeq],
      'PreToolUse',
      {},
      config,
      fp(dir),
    )

    expect(result.lastResult?.result).toBe('allow')
    // Unordered parallel runs first, then ordered, then unordered sequential
    expect(executionOrder).toEqual(['unorderedPar', 'orderedA', 'orderedB', 'unorderedSeq'])
    // All injectContext accumulated in execution order
    expect(result.lastResult?.injectContext).toBe('unorderedPar\norderedA\norderedB\nunorderedSeq')
  })

  it('full pipeline: updatedInput flows through to translateResult', async () => {
    const dir = makeTempDir()

    const hook = makeLoadedHook('mutator', {
      PreToolUse: () => ({
        result: 'allow',
        updatedInput: { filePath: '/new/path' },
      }),
    })

    const config = makeTestConfig({ mutator: { parallel: false } })

    const normalized = { event: 'PreToolUse', toolInput: { filePath: '/old/path' } }
    const result = await executeHooks([hook], 'PreToolUse', normalized, config, fp(dir))

    // Pipeline result has updatedInput
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.updatedInput).toEqual({ filePath: '/new/path' })

    // Now translate and verify it appears in the PreToolUse JSON output
    const translated = translateResult('PreToolUse', result.lastResult!)
    expect(translated.exitCode).toBe(0)
    const parsed = JSON.parse(translated.output!)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(parsed.hookSpecificOutput.updatedInput).toEqual({ filePath: '/new/path' })
  })

  it("ordering error: order references hook that doesn't handle event", async () => {
    const dir = makeTempDir()

    // hook-a only handles PostToolUse, hook-b handles PreToolUse.
    // Config orders PreToolUse as [hook-a], but hook-a won't match.
    const hookA = makeLoadedHook('hook-a', {
      PostToolUse: () => ({ result: 'skip' }),
    })
    const hookB = makeLoadedHook('hook-b', {
      PreToolUse: () => ({ result: 'allow' }),
    })

    const config = makeTestConfig({
      'hook-a': { parallel: false },
      'hook-b': { parallel: false },
    })
    config.events = {
      PreToolUse: { order: [hn('hook-a')] },
    }

    // Only hook-b matches PreToolUse; hook-a is excluded by matchHooksForEvent.
    // executeHooks should throw because the order list references hook-a
    // which isn't in the matched set.
    const { matched } = matchHooksForEvent(
      [hookA, hookB],
      'PreToolUse' as import('./types/branded.js').EventName,
      config,
    )

    await expect(executeHooks(matched, 'PreToolUse', {}, config, fp(dir))).rejects.toThrow(
      /hook-a.*does not handle this event/,
    )
  })
})

// --- Shadow warnings ---

describe('buildShadowWarnings', () => {
  it('produces a single collapsed line for multiple shadows on SessionStart', () => {
    const warnings = buildShadowWarnings('SessionStart', [
      hn('security-audit'),
      hn('log-bash-commands'),
    ])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toBe(
      'clooks: project hooks shadowing home: log-bash-commands, security-audit',
    )
  })

  it('renders a single shadow without trailing punctuation', () => {
    const warnings = buildShadowWarnings('SessionStart', [hn('shared-hook')])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toBe('clooks: project hooks shadowing home: shared-hook')
  })

  it('returns empty array on non-SessionStart events', () => {
    const warnings = buildShadowWarnings('PreToolUse', [hn('shared-hook')])
    expect(warnings).toEqual([])
  })

  it('returns empty array when shadows array is empty', () => {
    const warnings = buildShadowWarnings('SessionStart', [])
    expect(warnings).toEqual([])
  })

  it('sorts shadow names alphabetically regardless of input order', () => {
    const warnings = buildShadowWarnings('SessionStart', [hn('zeta'), hn('alpha'), hn('mu')])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toBe('clooks: project hooks shadowing home: alpha, mu, zeta')
  })
})

// --- Home-only failure path ---

describe('executeHooks with home-only failure path', () => {
  it('creates failure state at hash-based path under homeRoot', async () => {
    const dir = makeTempDir()
    const homeRoot = dir
    const projectRoot = join(dir, 'some-project')
    mkdirSync(projectRoot, { recursive: true })

    const failurePath = getFailurePath(projectRoot, homeRoot, false)

    const hook = makeLoadedHook('fail-hook', {
      PreToolUse: () => {
        throw new Error('home-only boom')
      },
    })
    const config = makeTestConfig({ 'fail-hook': {} })

    const result = await executeHooks([hook], 'PreToolUse', {}, config, failurePath)
    expect(result.lastResult?.result).toBe('block')

    // Verify failure state was written to the hash-based path
    const state = await readFailures(failurePath)
    expect(state[hn('fail-hook')]?.['PreToolUse']?.consecutiveFailures).toBe(1)
    expect(state[hn('fail-hook')]?.['PreToolUse']?.lastError).toContain('home-only boom')

    // Verify the path is under homeRoot/.clooks/failures/
    expect(failurePath).toContain(join(homeRoot, '.clooks/failures'))
    expect(failurePath).toMatch(/\.json$/)
  })
})

// --- formatDiagnostic / formatTraceMessage with usesTarget ---

describe('formatDiagnostic', () => {
  it('includes (uses: X, path) when usesTarget is provided', () => {
    const msg = formatDiagnostic(
      hn('log-bash-verbose'),
      'PreToolUse',
      new Error('boom'),
      'block',
      'log-bash-commands',
      '.clooks/hooks/log-bash-commands.ts',
    )
    expect(msg).toContain('Hook "log-bash-verbose"')
    expect(msg).toContain('(uses: log-bash-commands, .clooks/hooks/log-bash-commands.ts)')
    expect(msg).toContain('Action blocked')
    expect(msg).toContain('onError: block')
  })

  it('does not include uses info when usesTarget is undefined', () => {
    const msg = formatDiagnostic(hn('my-hook'), 'PreToolUse', new Error('boom'), 'block')
    expect(msg).toContain('Hook "my-hook"')
    expect(msg).not.toContain('(uses:')
    expect(msg).toContain('Action blocked')
  })

  it("shows 'unknown' when usesTarget is set but resolvedPath is undefined", () => {
    const msg = formatDiagnostic(
      hn('alias'),
      'PostToolUse',
      new Error('fail'),
      'continue',
      'target-hook',
    )
    expect(msg).toContain('(uses: target-hook, unknown)')
    expect(msg).toContain('Continuing')
  })
})

describe('formatTraceMessage', () => {
  it('includes (uses: X, path) when usesTarget is provided', () => {
    const msg = formatTraceMessage(
      hn('alias-hook'),
      new Error('oops'),
      'real-hook',
      '.clooks/hooks/real-hook.ts',
    )
    expect(msg).toContain('Hook "alias-hook"')
    expect(msg).toContain('(uses: real-hook, .clooks/hooks/real-hook.ts)')
    expect(msg).toContain('onError: trace')
  })

  it('does not include uses info when usesTarget is undefined', () => {
    const msg = formatTraceMessage(hn('my-hook'), new Error('oops'))
    expect(msg).toContain('Hook "my-hook"')
    expect(msg).not.toContain('(uses:')
    expect(msg).toContain('onError: trace')
  })
})

describe('assertCategoryCompleteness', () => {
  it('passes for current category sets (module loaded successfully)', () => {
    // If the module-level call had failed, no test in this file would run.
    // This test documents that the assertion passed at import time.
    expect(assertCategoryCompleteness).toBeFunction()
  })

  it('throws when an event is missing from all categories', () => {
    const allEvents = new Set<EventName>(['A' as EventName, 'B' as EventName, 'C' as EventName])
    const categories: Array<[string, Set<EventName>]> = [
      ['SET_1', new Set<EventName>(['A' as EventName])],
      ['SET_2', new Set<EventName>(['B' as EventName])],
    ]
    expect(() => assertCategoryCompleteness(allEvents, categories)).toThrow(
      'event "C" is in CLAUDE_CODE_EVENTS but not categorized',
    )
  })

  it('throws when a categorized event is not in allEvents', () => {
    const allEvents = new Set<EventName>(['A' as EventName])
    const categories: Array<[string, Set<EventName>]> = [
      ['SET_1', new Set<EventName>(['A' as EventName])],
      ['SET_2', new Set<EventName>(['B' as EventName])],
    ]
    expect(() => assertCategoryCompleteness(allEvents, categories)).toThrow(
      'event "B" is categorized in engine.ts but not in CLAUDE_CODE_EVENTS',
    )
  })

  it('throws when an event appears in multiple categories', () => {
    const allEvents = new Set<EventName>(['A' as EventName, 'B' as EventName])
    const categories: Array<[string, Set<EventName>]> = [
      ['SET_1', new Set<EventName>(['A' as EventName, 'B' as EventName])],
      ['SET_2', new Set<EventName>(['B' as EventName])],
    ]
    expect(() => assertCategoryCompleteness(allEvents, categories)).toThrow(
      'event "B" appears in both SET_1 and SET_2',
    )
  })

  it('passes when categories exactly match allEvents', () => {
    const allEvents = new Set<EventName>(['A' as EventName, 'B' as EventName, 'C' as EventName])
    const categories: Array<[string, Set<EventName>]> = [
      ['SET_1', new Set<EventName>(['A' as EventName])],
      ['SET_2', new Set<EventName>(['B' as EventName, 'C' as EventName])],
    ]
    expect(() => assertCategoryCompleteness(allEvents, categories)).not.toThrow()
  })

  it('StopFailure is a member of NOTIFY_ONLY_EVENTS and no other category', async () => {
    const { NOTIFY_ONLY_EVENTS } = await import('./config/constants.js')
    const { GUARD_EVENTS, OBSERVE_EVENTS, CONTINUATION_EVENTS } = await import('./engine/events.js')
    expect(NOTIFY_ONLY_EVENTS.has('StopFailure' as EventName)).toBe(true)
    expect(GUARD_EVENTS.has('StopFailure' as EventName)).toBe(false)
    expect(OBSERVE_EVENTS.has('StopFailure' as EventName)).toBe(false)
    expect(CONTINUATION_EVENTS.has('StopFailure' as EventName)).toBe(false)
  })
})

// --- FEAT-0059 M3: PreToolUse reducer unit tests ---

describe('rankPreToolUseResult', () => {
  it('block (deny) → 3', () => {
    expect(rankPreToolUseResult({ result: 'block', reason: 'policy violation' })).toBe(3)
  })

  it('defer → 2', () => {
    expect(rankPreToolUseResult({ result: 'defer' })).toBe(2)
  })

  it('ask → 1', () => {
    expect(rankPreToolUseResult({ result: 'ask', reason: 'please confirm' })).toBe(1)
  })

  it('allow → 0', () => {
    expect(rankPreToolUseResult({ result: 'allow' })).toBe(0)
  })

  it('skip → -1', () => {
    expect(rankPreToolUseResult({ result: 'skip' })).toBe(-1)
  })
})

describe('reducePreToolUseVotes', () => {
  it('empty votes → result undefined, warnings empty', () => {
    const { result, warnings } = reducePreToolUseVotes([])
    expect(result).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('all-skip → skip winner returned, warnings empty', () => {
    const skipA = { result: 'skip' as const }
    const skipB = { result: 'skip' as const }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: skipA, rank: -1 },
      { engineResult: skipB, rank: -1 },
    ])
    expect(result?.result).toBe('skip')
    expect(warnings).toEqual([])
  })

  it('allow-only → allow wins', () => {
    const allow = { result: 'allow' as const, injectContext: 'ctx' }
    const { result, warnings } = reducePreToolUseVotes([{ engineResult: allow, rank: 0 }])
    expect(result?.result).toBe('allow')
    expect(warnings).toEqual([])
  })

  it('ordering: deny > defer > ask > allow regardless of input order', () => {
    const allow = { result: 'allow' as const }
    const ask = { result: 'ask' as const, reason: 'confirm' }
    const deny = { result: 'block' as const, reason: 'policy' }
    const defer = { result: 'defer' as const }
    // Test that deny wins regardless of position in the array
    const { result } = reducePreToolUseVotes([
      { engineResult: allow, rank: 0 },
      { engineResult: ask, rank: 1 },
      { engineResult: deny, rank: 3 },
      { engineResult: defer, rank: 2 },
    ])
    expect(result?.result).toBe('block')
  })

  it('defer wins — drops updatedInput from losers and emits warning', () => {
    const allowWithInput = { result: 'allow' as const, updatedInput: { cmd: 'ls' } }
    const defer = { result: 'defer' as const }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: allowWithInput, rank: 0 },
      { engineResult: defer, rank: 2 },
    ])
    expect(result?.result).toBe('defer')
    expect(result).not.toHaveProperty('updatedInput')
    expect(warnings.some((w) => w.includes('updatedInput'))).toBe(true)
  })

  it('defer wins — drops injectContext from losers and emits warning', () => {
    const allowWithCtx = { result: 'allow' as const, injectContext: 'audit info' }
    const defer = { result: 'defer' as const }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: allowWithCtx, rank: 0 },
      { engineResult: defer, rank: 2 },
    ])
    expect(result?.result).toBe('defer')
    expect(result).not.toHaveProperty('injectContext')
    expect(
      warnings.some((w) => w.includes('additionalContext') || w.includes('injectContext')),
    ).toBe(true)
  })

  it('defer wins — no warnings when losers have no updatedInput or context', () => {
    const allow = { result: 'allow' as const }
    const ask = { result: 'ask' as const, reason: 'confirm' }
    const defer = { result: 'defer' as const }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: allow, rank: 0 },
      { engineResult: defer, rank: 2 },
      { engineResult: ask, rank: 1 },
    ])
    expect(result?.result).toBe('defer')
    expect(warnings).toEqual([])
  })

  it('deny merges injectContext from allow/ask losers AND winner, drops updatedInput', () => {
    const denyWithCtx = {
      result: 'block' as const,
      reason: 'policy',
      injectContext: 'deny-ctx',
      updatedInput: { x: 1 },
    }
    const allowWithCtx = { result: 'allow' as const, injectContext: 'allow-ctx' }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: allowWithCtx, rank: 0 },
      { engineResult: denyWithCtx, rank: 3 },
    ])
    expect(result?.result).toBe('block')
    expect(result?.injectContext).toContain('allow-ctx')
    expect(result?.injectContext).toContain('deny-ctx')
    expect(result).not.toHaveProperty('updatedInput')
    expect(warnings).toEqual([])
  })

  it('ask winner emits merged mergedToolInput when an allow loser contributed updatedInput', () => {
    const ask = { result: 'ask' as const, reason: 'confirm' }
    const allowWithInput = { result: 'allow' as const, updatedInput: { cmd: 'ls' } }
    const merged = { cmd: 'ls' }
    const { result, warnings } = reducePreToolUseVotes(
      [
        { engineResult: ask, rank: 1 },
        { engineResult: allowWithInput, rank: 0 },
      ],
      merged,
    )
    expect(result?.result).toBe('ask')
    expect(result?.updatedInput).toEqual({ cmd: 'ls' })
    expect(warnings).toEqual([])
  })

  it('ask aggregates injectContext from all allow losers (two-pass invariant)', () => {
    // Multiple allow losers, each with context; first one also has updatedInput.
    const ask = { result: 'ask' as const, reason: 'confirm' }
    const allowA = { result: 'allow' as const, updatedInput: { cmd: 'ls' }, injectContext: 'ctx-A' }
    const allowB = { result: 'allow' as const, injectContext: 'ctx-B' }
    const allowC = { result: 'allow' as const, injectContext: 'ctx-C' }
    const merged = { cmd: 'ls' }
    const { result, warnings } = reducePreToolUseVotes(
      [
        { engineResult: allowA, rank: 0 },
        { engineResult: allowB, rank: 0 },
        { engineResult: ask, rank: 1 },
        { engineResult: allowC, rank: 0 },
      ],
      merged,
    )
    expect(result?.result).toBe('ask')
    // updatedInput from the merged tool input threaded into the reducer
    expect(result?.updatedInput).toEqual({ cmd: 'ls' })
    // context from allow losers in vote order (A, B, C) joined
    expect(result?.injectContext).toContain('ctx-A')
    expect(result?.injectContext).toContain('ctx-B')
    expect(result?.injectContext).toContain('ctx-C')
    expect(warnings).toEqual([])
  })

  it('deny winner: block-loser context is excluded; allow-loser context is included', () => {
    // blockA and blockB both have context; allow also has context.
    // blockB is last-seen at rank 3 so it wins. blockA is a block-loser
    // and must NOT contribute context. allow is an allow-loser and MUST contribute.
    const blockA = { result: 'block' as const, reason: 'policy-A', injectContext: 'block-A-ctx' }
    const blockB = { result: 'block' as const, reason: 'policy-B', injectContext: 'block-B-ctx' }
    const allow = { result: 'allow' as const, injectContext: 'allow-ctx' }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: blockA, rank: 3 },
      { engineResult: blockB, rank: 3 },
      { engineResult: allow, rank: 0 },
    ])
    expect(result?.result).toBe('block')
    // Winner (blockB) context included
    expect(result?.injectContext).toContain('block-B-ctx')
    // Allow-loser context included
    expect(result?.injectContext).toContain('allow-ctx')
    // Block-loser (blockA) context must NOT be included
    expect(result?.injectContext).not.toContain('block-A-ctx')
    expect(warnings).toEqual([])
  })

  it('ask winner: ask-loser context is excluded; allow-loser context is included', () => {
    // askA and askB both have context; allow also has context.
    // askB is last-seen at rank 1 so it wins. askA is an ask-loser
    // and must NOT contribute context. allow is an allow-loser and MUST contribute.
    const askA = { result: 'ask' as const, reason: 'confirm-A', injectContext: 'ask-A-ctx' }
    const askB = { result: 'ask' as const, reason: 'confirm-B', injectContext: 'ask-B-ctx' }
    const allow = { result: 'allow' as const, injectContext: 'allow-ctx' }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: askA, rank: 1 },
      { engineResult: askB, rank: 1 },
      { engineResult: allow, rank: 0 },
    ])
    expect(result?.result).toBe('ask')
    // Winner (askB) context included
    expect(result?.injectContext).toContain('ask-B-ctx')
    // Allow-loser context included
    expect(result?.injectContext).toContain('allow-ctx')
    // Ask-loser (askA) context must NOT be included
    expect(result?.injectContext).not.toContain('ask-A-ctx')
    expect(warnings).toEqual([])
  })

  it('allow winner: both allow losers contribute context (regression anchor)', () => {
    // allowA and allowB both have context. allowB is last-seen at rank 0 so it wins.
    // Both allowA (loser) and allowB (winner) must contribute context in execution order.
    const allowA = { result: 'allow' as const, injectContext: 'allow-A-ctx' }
    const allowB = { result: 'allow' as const, injectContext: 'allow-B-ctx' }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: allowA, rank: 0 },
      { engineResult: allowB, rank: 0 },
    ])
    expect(result?.result).toBe('allow')
    // Both contexts present in execution order
    expect(result?.injectContext).toBe('allow-A-ctx\nallow-B-ctx')
    expect(warnings).toEqual([])
  })

  // --- M3 QA gap tests ---

  it('deny tie-break: last-seen wins; result.reason is from policy-B, policy-A context excluded', () => {
    // Two block votes at rank 3 (tie). Last-seen (blockB) wins.
    // Assert winner identity via reason field AND merged context composition.
    const blockA = { result: 'block' as const, reason: 'policy-A', injectContext: 'ctx-A' }
    const blockB = { result: 'block' as const, reason: 'policy-B', injectContext: 'ctx-B' }
    const allow = { result: 'allow' as const, injectContext: 'allow-ctx' }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: blockA, rank: 3 },
      { engineResult: blockB, rank: 3 },
      { engineResult: allow, rank: 0 },
    ])
    expect(result?.result).toBe('block')
    // Last-seen block winner identity
    expect(result?.reason).toBe('policy-B')
    // Winner (blockB) context AND allow-loser context included
    expect(result?.injectContext).toContain('ctx-B')
    expect(result?.injectContext).toContain('allow-ctx')
    // Block-loser (blockA) context must NOT be included
    expect(result?.injectContext).not.toContain('ctx-A')
    expect(warnings).toEqual([])
  })

  it('ask tie-break: last-seen wins; result.reason is confirm-B, ask-A context excluded', () => {
    // Two ask votes at rank 1 (tie). Last-seen (askB) wins.
    // Assert winner identity via reason field AND merged context composition.
    const askA = { result: 'ask' as const, reason: 'confirm-A', injectContext: 'ask-ctx-A' }
    const askB = { result: 'ask' as const, reason: 'confirm-B', injectContext: 'ask-ctx-B' }
    const allow = { result: 'allow' as const, injectContext: 'allow-ctx' }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: askA, rank: 1 },
      { engineResult: askB, rank: 1 },
      { engineResult: allow, rank: 0 },
    ])
    expect(result?.result).toBe('ask')
    // Last-seen ask winner identity
    expect(result?.reason).toBe('confirm-B')
    // Winner (askB) context AND allow-loser context included
    expect(result?.injectContext).toContain('ask-ctx-B')
    expect(result?.injectContext).toContain('allow-ctx')
    // Ask-loser (askA) context must NOT be included
    expect(result?.injectContext).not.toContain('ask-ctx-A')
    expect(warnings).toEqual([])
  })

  it('defer tie-break: two defer votes → merged result is {result: defer}, warnings empty', () => {
    // Both losers have no updatedInput/context so no warnings are emitted.
    const deferA = { result: 'defer' as const }
    const deferB = { result: 'defer' as const }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: deferA, rank: 2 },
      { engineResult: deferB, rank: 2 },
    ])
    expect(result?.result).toBe('defer')
    // Defer strips all extra fields — result is minimal
    expect(result).not.toHaveProperty('updatedInput')
    expect(result).not.toHaveProperty('injectContext')
    expect(warnings).toEqual([])
  })

  it('allow tie-break: reducer emits mergedToolInput (post-merge state reflects last-seen patch)', () => {
    // Two allow votes at rank 0 (tie). Last-seen wins because the spread at the
    // engine merge site applies patches in order — the reducer just emits the
    // resulting `mergedToolInput`.
    const allowA = { result: 'allow' as const, updatedInput: { cmd: 'first' } }
    const allowB = { result: 'allow' as const, updatedInput: { cmd: 'second' } }
    const merged = { cmd: 'second' }
    const { result, warnings } = reducePreToolUseVotes(
      [
        { engineResult: allowA, rank: 0 },
        { engineResult: allowB, rank: 0 },
      ],
      merged,
    )
    expect(result?.result).toBe('allow')
    expect(result?.updatedInput).toEqual({ cmd: 'second' })
    expect(warnings).toEqual([])
  })

  it('skip sandwich: skip + allow + skip → allow wins; injectContext from allow preserved', () => {
    // The >= tie-break must not promote a later skip over a genuine allow winner.
    const skipA = { result: 'skip' as const }
    const allow = { result: 'allow' as const, injectContext: 'middle' }
    const skipB = { result: 'skip' as const }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: skipA, rank: -1 },
      { engineResult: allow, rank: 0 },
      { engineResult: skipB, rank: -1 },
    ])
    expect(result?.result).toBe('allow')
    expect(result?.injectContext).toBe('middle')
    expect(warnings).toEqual([])
  })

  it('ask-loser context is included for deny winner (deny merges allow AND ask losers)', () => {
    // Deny winner must include context from ask losers as well as allow losers.
    const ask = { result: 'ask' as const, reason: 'a', injectContext: 'ask-ctx' }
    const block = { result: 'block' as const, reason: 'policy', injectContext: 'deny-ctx' }
    const allow = { result: 'allow' as const, injectContext: 'allow-ctx' }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: ask, rank: 1 },
      { engineResult: block, rank: 3 },
      { engineResult: allow, rank: 0 },
    ])
    expect(result?.result).toBe('block')
    expect(result?.injectContext).toContain('ask-ctx')
    expect(result?.injectContext).toContain('deny-ctx')
    expect(result?.injectContext).toContain('allow-ctx')
    expect(warnings).toEqual([])
  })

  it('deny winner without context, allow loser with context → merged injectContext is allow-ctx', () => {
    // The deny winner has no injectContext of its own. The allow loser does.
    // Merged result must carry the allow-loser context.
    const block = { result: 'block' as const, reason: 'policy' }
    const allow = { result: 'allow' as const, injectContext: 'fallback-ctx' }
    const { result, warnings } = reducePreToolUseVotes([
      { engineResult: block, rank: 3 },
      { engineResult: allow, rank: 0 },
    ])
    expect(result?.result).toBe('block')
    expect(result?.injectContext).toBe('fallback-ctx')
    expect(warnings).toEqual([])
  })
})
