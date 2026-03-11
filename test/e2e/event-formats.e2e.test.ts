import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('event formats — guard events', () => {
  // 1. PermissionRequest block → unique hookSpecificOutput.decision format
  test('PermissionRequest block → hookSpecificOutput with decision.behavior deny', () => {
    sandbox = createSandbox()
    sandbox.writeHook('perm-block.ts', `
export const hook = {
  meta: { name: "perm-block" },
  PermissionRequest() {
    return { result: "block" as const, reason: "denied by policy" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
perm-block: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('permission-request.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput).toBeDefined()
    expect(output.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(output.hookSpecificOutput.decision).toEqual({ behavior: 'deny' })
    // PermissionRequest block does NOT use top-level decision/reason
    expect(output.decision).toBeUndefined()
  })

  // 2. PermissionRequest allow → empty stdout, exit 0
  test('PermissionRequest allow → empty stdout, exit 0', () => {
    sandbox = createSandbox()
    sandbox.writeHook('perm-allow.ts', `
export const hook = {
  meta: { name: "perm-allow" },
  PermissionRequest() {
    return { result: "allow" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
perm-allow: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('permission-request.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  // 3. PermissionRequest skip → empty stdout, exit 0
  test('PermissionRequest skip → empty stdout, exit 0', () => {
    sandbox = createSandbox()
    sandbox.writeHook('perm-skip.ts', `
export const hook = {
  meta: { name: "perm-skip" },
  PermissionRequest() {
    return { result: "skip" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
perm-skip: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('permission-request.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  // 4. PermissionRequest crash with onError:block → deny in PermissionRequest format
  test('PermissionRequest crash with onError:block → hookSpecificOutput.decision.behavior deny', () => {
    sandbox = createSandbox()
    sandbox.writeHook('perm-crash.ts', `
export const hook = {
  meta: { name: "perm-crash" },
  PermissionRequest() {
    throw new Error("permission check failed")
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
perm-crash:
  onError: block
`)
    const result = sandbox.run([], { stdin: loadEvent('permission-request.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Crash with onError:block produces a block result which goes through
    // the PermissionRequest branch of translateResult
    expect(output.hookSpecificOutput).toBeDefined()
    expect(output.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(output.hookSpecificOutput.decision).toEqual({ behavior: 'deny' })
  })

  // 5. UserPromptSubmit block → generic { decision: "block", reason } format
  test('UserPromptSubmit block → top-level decision/reason (not hookSpecificOutput)', () => {
    sandbox = createSandbox()
    sandbox.writeHook('prompt-block.ts', `
export const hook = {
  meta: { name: "prompt-block" },
  UserPromptSubmit() {
    return { result: "block" as const, reason: "prompt rejected" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
prompt-block: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('user-prompt-submit.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.decision).toBe('block')
    expect(output.reason).toBe('prompt rejected')
    // UserPromptSubmit block uses generic guard format, NOT hookSpecificOutput
    expect(output.hookSpecificOutput).toBeUndefined()
  })

  // 6. UserPromptSubmit allow → empty stdout, exit 0
  test('UserPromptSubmit allow → empty stdout, exit 0', () => {
    sandbox = createSandbox()
    sandbox.writeHook('prompt-allow.ts', `
export const hook = {
  meta: { name: "prompt-allow" },
  UserPromptSubmit() {
    return { result: "allow" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
prompt-allow: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('user-prompt-submit.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  // 7. Stop block → generic guard format
  test('Stop block → top-level decision/reason', () => {
    sandbox = createSandbox()
    sandbox.writeHook('stop-block.ts', `
export const hook = {
  meta: { name: "stop-block" },
  Stop() {
    return { result: "block" as const, reason: "not yet" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
stop-block: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('stop.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.decision).toBe('block')
    expect(output.reason).toBe('not yet')
  })

  // 8. PreToolUse skip → empty stdout (distinct from allow which emits JSON)
  test('PreToolUse skip → empty stdout, exit 0', () => {
    sandbox = createSandbox()
    sandbox.writeHook('pre-skip.ts', `
export const hook = {
  meta: { name: "pre-skip" },
  PreToolUse() {
    return { result: "skip" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
pre-skip: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  // 9. PreToolUse allow with updatedInput → hookSpecificOutput.updatedInput present
  test('PreToolUse allow with updatedInput → hookSpecificOutput includes updatedInput', () => {
    sandbox = createSandbox()
    sandbox.writeHook('pre-rewrite.ts', `
export const hook = {
  meta: { name: "pre-rewrite" },
  PreToolUse(ctx: Record<string, unknown>) {
    return {
      result: "allow" as const,
      updatedInput: { command: "echo safe" },
    }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
pre-rewrite: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(output.hookSpecificOutput.updatedInput).toEqual({ command: 'echo safe' })
  })
})

describe('event formats — observe events', () => {
  // 10. PostToolUse allow with injectContext → hookSpecificOutput.additionalContext
  test('PostToolUse allow with injectContext → hookSpecificOutput.additionalContext', () => {
    sandbox = createSandbox()
    sandbox.writeHook('post-context.ts', `
export const hook = {
  meta: { name: "post-context" },
  PostToolUse() {
    return { result: "allow" as const, injectContext: "post-tool observation" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
post-context: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('post-tool-use.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput).toBeDefined()
    expect(output.hookSpecificOutput.hookEventName).toBe('PostToolUse')
    expect(output.hookSpecificOutput.additionalContext).toBe('post-tool observation')
  })

  // 11. PostToolUse crash with onError:block → injectable observe block uses additionalContext
  test('PostToolUse crash with onError:block → hookSpecificOutput.additionalContext (not systemMessage)', () => {
    sandbox = createSandbox()
    sandbox.writeHook('post-crash.ts', `
export const hook = {
  meta: { name: "post-crash" },
  PostToolUse() {
    throw new Error("post-tool crash")
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
post-crash:
  onError: block
`)
    const result = sandbox.run([], { stdin: loadEvent('post-tool-use.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // PostToolUse is injectable, so block result surfaces via additionalContext
    expect(output.hookSpecificOutput).toBeDefined()
    expect(output.hookSpecificOutput.hookEventName).toBe('PostToolUse')
    expect(output.hookSpecificOutput.additionalContext).toContain('post-crash')
  })

  // 12. SessionStart allow with injectContext → additionalContext present
  test('SessionStart allow with injectContext → hookSpecificOutput.additionalContext', () => {
    sandbox = createSandbox()
    sandbox.writeHook('session-context.ts', `
export const hook = {
  meta: { name: "session-context" },
  SessionStart() {
    return { result: "allow" as const, injectContext: "session startup info" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
session-context: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput).toBeDefined()
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(output.hookSpecificOutput.additionalContext).toBe('session startup info')
  })

  // 13. Notification allow with injectContext → additionalContext present
  test('Notification allow with injectContext → hookSpecificOutput.additionalContext', () => {
    sandbox = createSandbox()
    sandbox.writeHook('notify-context.ts', `
export const hook = {
  meta: { name: "notify-context" },
  Notification() {
    return { result: "allow" as const, injectContext: "notification context" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
notify-context: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('notification.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput).toBeDefined()
    expect(output.hookSpecificOutput.hookEventName).toBe('Notification')
    expect(output.hookSpecificOutput.additionalContext).toBe('notification context')
  })
})

describe('event formats — continuation events', () => {
  // 14. TaskCompleted continue → exit 2, stderr contains feedback
  test('TaskCompleted continue → exit 2, stderr has feedback', () => {
    sandbox = createSandbox()
    sandbox.writeHook('task-continue.ts', `
export const hook = {
  meta: { name: "task-continue" },
  TaskCompleted() {
    return { result: "continue" as const, feedback: "keep iterating" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
task-continue: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('task-completed.json') })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('keep iterating')
    expect(result.stdout.trim()).toBe('')
  })

  // 15. TaskCompleted stop → exit 0, { continue: false, stopReason }
  test('TaskCompleted stop → exit 0, JSON with continue:false', () => {
    sandbox = createSandbox()
    sandbox.writeHook('task-stop.ts', `
export const hook = {
  meta: { name: "task-stop" },
  TaskCompleted() {
    return { result: "stop" as const, reason: "all done" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
task-stop: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('task-completed.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.continue).toBe(false)
    expect(output.stopReason).toBe('all done')
  })

  // 16. TeammateIdle crash with onError:block → { continue: false, stopReason }
  test('TeammateIdle crash with onError:block → continue:false (not deny)', () => {
    sandbox = createSandbox()
    sandbox.writeHook('teammate-crash.ts', `
export const hook = {
  meta: { name: "teammate-crash" },
  TeammateIdle() {
    throw new Error("teammate hook crashed")
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
teammate-crash:
  onError: block
`)
    const result = sandbox.run([], { stdin: loadEvent('teammate-idle.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Continuation events with block result → { continue: false, stopReason }
    expect(output.continue).toBe(false)
    expect(output.stopReason).toContain('teammate-crash')
    // Should NOT use deny or hookSpecificOutput
    expect(output.hookSpecificOutput).toBeUndefined()
    expect(output.decision).toBeUndefined()
  })

  // 17. TeammateIdle skip → empty stdout, exit 0
  test('TeammateIdle skip → empty stdout, exit 0', () => {
    sandbox = createSandbox()
    sandbox.writeHook('teammate-skip.ts', `
export const hook = {
  meta: { name: "teammate-skip" },
  TeammateIdle() {
    return { result: "skip" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
teammate-skip: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('teammate-idle.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })
})

describe('event formats — WorktreeCreate', () => {
  // 18. WorktreeCreate block → exit 1, stderr contains reason
  test('WorktreeCreate block → exit 1, stderr has reason', () => {
    sandbox = createSandbox()
    sandbox.writeHook('worktree-block.ts', `
export const hook = {
  meta: { name: "worktree-block" },
  WorktreeCreate() {
    return { result: "block" as const, reason: "worktree not allowed" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
worktree-block: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('worktree-create.json') })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('worktree not allowed')
    expect(result.stdout.trim()).toBe('')
  })
})

describe('event formats — cross-cutting', () => {
  // 19. onError:trace on non-injectable guard event (UserPromptSubmit) → fallback to continue
  test('onError:trace on UserPromptSubmit (injectable) → additionalContext', () => {
    sandbox = createSandbox()
    sandbox.writeHook('prompt-trace-crash.ts', `
export const hook = {
  meta: { name: "prompt-trace-crash" },
  UserPromptSubmit() {
    throw new Error("trace test error")
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
prompt-trace-crash:
  onError: trace
`)
    const result = sandbox.run([], { stdin: loadEvent('user-prompt-submit.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // UserPromptSubmit IS injectable, so trace message goes to additionalContext
    expect(output.hookSpecificOutput).toBeDefined()
    expect(output.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')
    expect(output.hookSpecificOutput.additionalContext).toContain('trace')
    expect(output.hookSpecificOutput.additionalContext).toContain('prompt-trace-crash')
  })

  // 20. onError:trace on non-injectable observe event (SessionEnd) → fallback to continue
  test('onError:trace on SessionEnd (non-injectable) → fallback to continue, no additionalContext', () => {
    sandbox = createSandbox()
    sandbox.writeHook('session-end-trace.ts', `
export const hook = {
  meta: { name: "session-end-trace" },
  SessionEnd() {
    throw new Error("session end trace error")
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
session-end-trace:
  onError: trace
`)
    const result = sandbox.run([], { stdin: loadEvent('session-end.json') })
    expect(result.exitCode).toBe(0)
    // Non-injectable event: trace falls back to continue, no additionalContext
    // systemMessage should indicate the fallback
    const output = JSON.parse(result.stdout)
    expect(output.systemMessage).toContain('does not support additionalContext')
    expect(output.systemMessage).toContain('Falling back to "continue"')
  })

  // 21. injectContext on non-injectable event → silently dropped
  test('injectContext on non-injectable event (Stop) → silently dropped', () => {
    sandbox = createSandbox()
    sandbox.writeHook('stop-with-context.ts', `
export const hook = {
  meta: { name: "stop-with-context" },
  Stop() {
    return { result: "allow" as const, injectContext: "should be dropped" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
stop-with-context: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('stop.json') })
    expect(result.exitCode).toBe(0)
    // Stop is not injectable, so allow with injectContext → empty stdout
    expect(result.stdout.trim()).toBe('')
  })

  // 22. Degraded message on non-injectable event → surfaces via stderr
  test('degraded message on non-injectable event (Stop) → surfaces via stderr', () => {
    sandbox = createSandbox()
    sandbox.writeHook('stop-crasher.ts', `
export const hook = {
  meta: { name: "stop-crasher" },
  Stop() {
    throw new Error("stop crash")
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
stop-crasher:
  onError: block
  maxFailures: 2
`)
    // First invocation: block (newCount=1 < maxFailures=2, so under threshold → block)
    const result1 = sandbox.run([], { stdin: loadEvent('stop.json') })
    expect(result1.exitCode).toBe(0)
    const output1 = JSON.parse(result1.stdout)
    expect(output1.decision).toBe('block')

    // Second invocation: degraded (newCount=2 >= maxFailures=2, at threshold → degrade)
    // Stop is non-injectable, so degraded message goes to stderr
    const result2 = sandbox.run([], { stdin: loadEvent('stop.json') })
    expect(result2.exitCode).toBe(0)
    expect(result2.stderr).toContain('warning')
    expect(result2.stderr).toContain('stop-crasher')
  })

  // 23. Unknown hook_event_name in stdin → exit 2, "missing or unrecognized"
  test('unknown hook_event_name → exit 2, missing or unrecognized', () => {
    sandbox = createSandbox()
    sandbox.writeHook('any-hook.ts', `
export const hook = {
  meta: { name: "any-hook" },
  PreToolUse() { return { result: "allow" as const } },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
any-hook: {}
`)
    const result = sandbox.run([], {
      stdin: JSON.stringify({ hook_event_name: 'NonExistentEvent' }),
    })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('missing or unrecognized')
  })
})
