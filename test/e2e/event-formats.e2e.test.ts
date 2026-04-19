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
    sandbox.writeHook(
      'perm-block.ts',
      `
export const hook = {
  meta: { name: "perm-block" },
  PermissionRequest() {
    return { result: "block" as const, reason: "denied by policy" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
perm-block: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('permission-request.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput).toBeDefined()
    expect(output.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(output.hookSpecificOutput.decision).toEqual({
      behavior: 'deny',
      message: 'denied by policy',
    })
    // PermissionRequest block does NOT use top-level decision/reason
    expect(output.decision).toBeUndefined()
  })

  // 2. PermissionRequest allow → empty stdout, exit 0
  test('PermissionRequest allow → empty stdout, exit 0', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'perm-allow.ts',
      `
export const hook = {
  meta: { name: "perm-allow" },
  PermissionRequest() {
    return { result: "allow" as const }
  },
}
`,
    )
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
    sandbox.writeHook(
      'perm-skip.ts',
      `
export const hook = {
  meta: { name: "perm-skip" },
  PermissionRequest() {
    return { result: "skip" as const }
  },
}
`,
    )
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
    sandbox.writeHook(
      'perm-crash.ts',
      `
export const hook = {
  meta: { name: "perm-crash" },
  PermissionRequest() {
    throw new Error("permission check failed")
  },
}
`,
    )
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
    expect(output.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(output.hookSpecificOutput.decision.message).toContain('perm-crash')
  })

  // 4a. PermissionRequest allow + updatedPermissions addRules → entry serializes verbatim
  test('PermissionRequest allow with updatedPermissions addRules → entry round-trips verbatim', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'perm-allow-addrules.ts',
      `
export const hook = {
  meta: { name: "perm-allow-addrules" },
  PermissionRequest() {
    return {
      result: "allow",
      updatedPermissions: [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "npm test" }],
          behavior: "allow",
          destination: "session",
        },
      ],
    }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
perm-allow-addrules: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('permission-request.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(output.hookSpecificOutput.decision.behavior).toBe('allow')
    expect(output.hookSpecificOutput.decision.updatedPermissions).toEqual([
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'npm test' }],
        behavior: 'allow',
        destination: 'session',
      },
    ])
  })

  // 4b. PermissionRequest allow + updatedPermissions setMode → entry serializes verbatim
  test('PermissionRequest allow with updatedPermissions setMode → entry round-trips verbatim', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'perm-allow-setmode.ts',
      `
export const hook = {
  meta: { name: "perm-allow-setmode" },
  PermissionRequest() {
    return {
      result: "allow",
      updatedPermissions: [
        {
          type: "setMode",
          mode: "acceptEdits",
          destination: "session",
        },
      ],
    }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
perm-allow-setmode: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('permission-request.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.decision.updatedPermissions).toEqual([
      {
        type: 'setMode',
        mode: 'acceptEdits',
        destination: 'session',
      },
    ])
  })

  // 4c. PermissionRequest allow + updatedPermissions removeDirectories → entry serializes verbatim
  test('PermissionRequest allow with updatedPermissions removeDirectories → entry round-trips verbatim', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'perm-allow-removedirs.ts',
      `
export const hook = {
  meta: { name: "perm-allow-removedirs" },
  PermissionRequest() {
    return {
      result: "allow",
      updatedPermissions: [
        {
          type: "removeDirectories",
          directories: ["/tmp/old-a", "/tmp/old-b"],
          destination: "localSettings",
        },
      ],
    }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
perm-allow-removedirs: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('permission-request.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.decision.updatedPermissions).toEqual([
      {
        type: 'removeDirectories',
        directories: ['/tmp/old-a', '/tmp/old-b'],
        destination: 'localSettings',
      },
    ])
  })

  // 5. UserPromptSubmit block → generic { decision: "block", reason } format
  test('UserPromptSubmit block → top-level decision/reason (not hookSpecificOutput)', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'prompt-block.ts',
      `
export const hook = {
  meta: { name: "prompt-block" },
  UserPromptSubmit() {
    return { result: "block" as const, reason: "prompt rejected" }
  },
}
`,
    )
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
    sandbox.writeHook(
      'prompt-allow.ts',
      `
export const hook = {
  meta: { name: "prompt-allow" },
  UserPromptSubmit() {
    return { result: "allow" as const }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
prompt-allow: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('user-prompt-submit.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  // 6b. UserPromptSubmit allow + injectContext + sessionTitle → hookSpecificOutput with both fields
  test('UserPromptSubmit allow with injectContext + sessionTitle → hookSpecificOutput carries both', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'prompt-title.ts',
      `
export const hook = {
  meta: { name: "prompt-title" },
  UserPromptSubmit() {
    return {
      result: "allow" as const,
      injectContext: "ctx",
      sessionTitle: "Test",
    }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
prompt-title: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('user-prompt-submit.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput).toBeDefined()
    expect(output.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')
    expect(output.hookSpecificOutput.additionalContext).toBe('ctx')
    expect(output.hookSpecificOutput.sessionTitle).toBe('Test')
    // Allow path must NOT carry top-level decision or continue keys
    expect(output.decision).toBeUndefined()
    expect(output.continue).toBeUndefined()
  })

  // 7. Stop block → generic guard format
  test('Stop block → top-level decision/reason', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'stop-block.ts',
      `
export const hook = {
  meta: { name: "stop-block" },
  Stop() {
    return { result: "block" as const, reason: "not yet" }
  },
}
`,
    )
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

  // 7b. PreCompact block → generic guard format (exit 0 + decision:block + reason)
  test('PreCompact block → top-level decision/reason', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'precompact-block.ts',
      `
export const hook = {
  meta: { name: "precompact-block" },
  PreCompact() {
    return { result: "block" as const, reason: "not yet" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
precompact-block: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-compact.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.decision).toBe('block')
    expect(output.reason).toBe('not yet')
    // PreCompact block uses generic guard format, NOT hookSpecificOutput
    expect(output.hookSpecificOutput).toBeUndefined()
  })

  // 8. PreToolUse skip → empty stdout (distinct from allow which emits JSON)
  test('PreToolUse skip → empty stdout, exit 0', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'pre-skip.ts',
      `
export const hook = {
  meta: { name: "pre-skip" },
  PreToolUse() {
    return { result: "skip" as const }
  },
}
`,
    )
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
    sandbox.writeHook(
      'pre-rewrite.ts',
      `
export const hook = {
  meta: { name: "pre-rewrite" },
  PreToolUse(ctx: Record<string, unknown>) {
    return {
      result: "allow" as const,
      updatedInput: { command: "echo safe" },
    }
  },
}
`,
    )
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

  // 9b. ConfigChange block for policy_settings → downgraded to skip + systemMessage warning (M5)
  test('ConfigChange block for source: "policy_settings" → downgraded to systemMessage, no decision', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'config-blocker.ts',
      `
export const hook = {
  meta: { name: "config-blocker" },
  ConfigChange() {
    return { result: "block" as const, reason: "disallowed" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
config-blocker: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('config-change-policy.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // No block JSON — upstream would ignore it anyway
    expect(output.decision).toBeUndefined()
    expect(output.reason).toBeUndefined()
    // systemMessage carries the downgrade warning
    expect(output.systemMessage).toContain('Clooks downgraded')
    expect(output.systemMessage).toContain('policy_settings')
    expect(output.systemMessage).toContain('disallowed')
  })
})

describe('event formats — observe events', () => {
  // 10. PostToolUse allow with injectContext → hookSpecificOutput.additionalContext
  test('PostToolUse allow with injectContext → hookSpecificOutput.additionalContext', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'post-context.ts',
      `
export const hook = {
  meta: { name: "post-context" },
  PostToolUse() {
    return { result: "allow" as const, injectContext: "post-tool observation" }
  },
}
`,
    )
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

  // 11. PostToolUse crash with onError:block → decision: "block" + reason
  // (author-returnable block and cascade unified onto the same upstream shape in PLAN-0014 M5)
  test('PostToolUse crash with onError:block → decision: "block" + reason', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'post-crash.ts',
      `
export const hook = {
  meta: { name: "post-crash" },
  PostToolUse() {
    throw new Error("post-tool crash")
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
post-crash:
  onError: block
`)
    const result = sandbox.run([], { stdin: loadEvent('post-tool-use.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // PostToolUse cascade emits decision: "block" + reason (same shape as author-returnable block)
    expect(output.decision).toBe('block')
    expect(output.reason).toContain('post-crash')
    expect(output.hookSpecificOutput).toBeUndefined()
    expect(output.systemMessage).toBeUndefined()
  })

  // 11b. PostToolUse author-returnable block → decision: "block" + reason
  test('PostToolUse author returns block → decision: "block" + reason', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'post-block.ts',
      `
export const hook = {
  meta: { name: "post-block" },
  PostToolUse() {
    return { result: "block" as const, reason: "tool output suspicious" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
post-block: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('post-tool-use.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.decision).toBe('block')
    expect(output.reason).toBe('tool output suspicious')
    expect(output.hookSpecificOutput).toBeUndefined()
    expect(output.systemMessage).toBeUndefined()
  })

  // 12. SessionStart allow with injectContext → additionalContext present
  test('SessionStart allow with injectContext → hookSpecificOutput.additionalContext', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'session-context.ts',
      `
export const hook = {
  meta: { name: "session-context" },
  SessionStart() {
    return { result: "allow" as const, injectContext: "session startup info" }
  },
}
`,
    )
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
    sandbox.writeHook(
      'notify-context.ts',
      `
export const hook = {
  meta: { name: "notify-context" },
  Notification() {
    return { result: "allow" as const, injectContext: "notification context" }
  },
}
`,
    )
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

  // 13z. SessionEnd with reason: "resume" → accepted and dispatched (M2)
  test('SessionEnd with reason: "resume" → hook receives context and dispatches cleanly', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'session-end-resume.ts',
      `
export const hook = {
  meta: { name: "session-end-resume" },
  SessionEnd(ctx: any) {
    // Assert the new "resume" reason flows through normalization to ctx.reason.
    if (ctx.reason !== "resume") {
      throw new Error("expected reason=resume, got " + ctx.reason)
    }
    return { result: "skip" as const }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
session-end-resume: {}
`)
    // session-end.json fixture carries reason: "resume" after M2 extension.
    const result = sandbox.run([], { stdin: loadEvent('session-end.json') })
    expect(result.exitCode).toBe(0)
    // skip → empty stdout
    expect(result.stdout.trim()).toBe('')
  })

  // 13a. PostCompact skip → empty stdout, exit 0 (pure observer)
  test('PostCompact skip → empty stdout, exit 0', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'post-compact-skip.ts',
      `
export const hook = {
  meta: { name: "post-compact-skip" },
  PostCompact() {
    return { result: "skip" as const }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
post-compact-skip: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('post-compact.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })
})

describe('event formats — continuation events', () => {
  // 14. TaskCompleted continue → exit 2, stderr contains feedback
  test('TaskCompleted continue → exit 2, stderr has feedback', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'task-continue.ts',
      `
export const hook = {
  meta: { name: "task-continue" },
  TaskCompleted() {
    return { result: "continue" as const, feedback: "keep iterating" }
  },
}
`,
    )
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
    sandbox.writeHook(
      'task-stop.ts',
      `
export const hook = {
  meta: { name: "task-stop" },
  TaskCompleted() {
    return { result: "stop" as const, reason: "all done" }
  },
}
`,
    )
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

  // 15a. TaskCreated continue → exit 2, stderr contains feedback
  test('TaskCreated continue → exit 2, stderr has feedback', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'task-created-continue.ts',
      `
export const hook = {
  meta: { name: "task-created-continue" },
  TaskCreated() {
    return { result: "continue" as const, feedback: "task subject must start with [TICKET-NNN]" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
task-created-continue: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('task-created.json') })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('task subject must start with [TICKET-NNN]')
    expect(result.stdout.trim()).toBe('')
  })

  // 15b. TaskCreated stop → exit 0, { continue: false, stopReason }
  test('TaskCreated stop → exit 0, JSON with continue:false', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'task-created-stop.ts',
      `
export const hook = {
  meta: { name: "task-created-stop" },
  TaskCreated() {
    return { result: "stop" as const, reason: "teammate halted by policy" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
task-created-stop: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('task-created.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.continue).toBe(false)
    expect(output.stopReason).toBe('teammate halted by policy')
  })

  // 15c. TaskCreated skip → empty stdout, exit 0
  test('TaskCreated skip → empty stdout, exit 0', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'task-created-skip.ts',
      `
export const hook = {
  meta: { name: "task-created-skip" },
  TaskCreated() {
    return { result: "skip" as const }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
task-created-skip: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('task-created.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  // 16. TeammateIdle crash with onError:block → exit 2 + stderr (retry/feedback)
  test('TeammateIdle crash with onError:block → exit 2 + stderr (retry, not stop-teammate)', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'teammate-crash.ts',
      `
export const hook = {
  meta: { name: "teammate-crash" },
  TeammateIdle() {
    throw new Error("teammate hook crashed")
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
teammate-crash:
  onError: block
`)
    const result = sandbox.run([], { stdin: loadEvent('teammate-idle.json') })
    // CONTINUATION onError:block → exit-2 + stderr (upstream's documented retry path).
    // PLAN-0015 M6: previously emitted {continue: false, stopReason} (stop-teammate path)
    // which was more aggressive than upstream's documented semantic.
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('teammate-crash')
    // stdout must be empty — no {continue: false, stopReason} JSON.
    expect(result.stdout.trim()).toBe('')
  })

  // 16a. TaskCompleted crash with onError:block → exit 2 + stderr (retry/feedback)
  test('TaskCompleted crash with onError:block → exit 2 + stderr (retry, not stop-teammate)', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'task-completed-crash.ts',
      `
export const hook = {
  meta: { name: "task-completed-crash" },
  TaskCompleted() {
    throw new Error("task completion hook crashed")
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
task-completed-crash:
  onError: block
`)
    const result = sandbox.run([], { stdin: loadEvent('task-completed.json') })
    // CONTINUATION onError:block → exit-2 + stderr (upstream's documented retry path).
    // Matches upstream's canonical TaskCompleted "tests failed" example.
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('task-completed-crash')
    // stdout must be empty — no {continue: false, stopReason} JSON.
    expect(result.stdout.trim()).toBe('')
  })

  // 16b. TaskCreated crash with onError:block → exit 2 + stderr (retry/feedback)
  test('TaskCreated crash with onError:block → exit 2 + stderr (retry, not stop-teammate)', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'task-created-crash.ts',
      `
export const hook = {
  meta: { name: "task-created-crash" },
  TaskCreated() {
    throw new Error("task creation hook crashed")
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
task-created-crash:
  onError: block
`)
    const result = sandbox.run([], { stdin: loadEvent('task-created.json') })
    // CONTINUATION onError:block → exit-2 + stderr (upstream's documented retry path).
    // Parallels 16a; asserts TaskCreated shares the exit-2 + stderr retry shape.
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('task-created-crash')
    // stdout must be empty — no {continue: false, stopReason} JSON.
    expect(result.stdout.trim()).toBe('')
  })

  // 17. TeammateIdle skip → empty stdout, exit 0
  test('TeammateIdle skip → empty stdout, exit 0', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'teammate-skip.ts',
      `
export const hook = {
  meta: { name: "teammate-skip" },
  TeammateIdle() {
    return { result: "skip" as const }
  },
}
`,
    )
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
    sandbox.writeHook(
      'worktree-block.ts',
      `
export const hook = {
  meta: { name: "worktree-block" },
  WorktreeCreate() {
    return { result: "block" as const, reason: "worktree not allowed" }
  },
}
`,
    )
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
    sandbox.writeHook(
      'prompt-trace-crash.ts',
      `
export const hook = {
  meta: { name: "prompt-trace-crash" },
  UserPromptSubmit() {
    throw new Error("trace test error")
  },
}
`,
    )
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
    sandbox.writeHook(
      'session-end-trace.ts',
      `
export const hook = {
  meta: { name: "session-end-trace" },
  SessionEnd() {
    throw new Error("session end trace error")
  },
}
`,
    )
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
    sandbox.writeHook(
      'stop-with-context.ts',
      `
export const hook = {
  meta: { name: "stop-with-context" },
  Stop() {
    return { result: "allow" as const, injectContext: "should be dropped" }
  },
}
`,
    )
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
    sandbox.writeHook(
      'stop-crasher.ts',
      `
export const hook = {
  meta: { name: "stop-crasher" },
  Stop() {
    throw new Error("stop crash")
  },
}
`,
    )
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
    sandbox.writeHook(
      'any-hook.ts',
      `
export const hook = {
  meta: { name: "any-hook" },
  PreToolUse() { return { result: "allow" as const } },
}
`,
    )
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

describe('event formats — StopFailure (NOTIFY_ONLY_EVENTS)', () => {
  // SF-1. StopFailure skip → empty stdout, exit 0 (pure notify-only)
  test('StopFailure skip → empty stdout, exit 0', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'stop-failure-skip.ts',
      `
export const hook = {
  meta: { name: "stop-failure-skip" },
  StopFailure() {
    return { result: "skip" as const }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
stop-failure-skip: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('stop-failure.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  // SF-2. StopFailure author-returned block → empty stdout, exit 0
  // Proves the translator's NOTIFY_ONLY_EVENTS early-return drops the
  // "block" result regardless of what the hook returns. Upstream drops output
  // and exit code for StopFailure, so blocking is impossible.
  test('StopFailure block (author-returned) → empty stdout, exit 0', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'stop-failure-block.ts',
      `
export const hook = {
  meta: { name: "stop-failure-block" },
  StopFailure() {
    return { result: "block" as const, reason: "author says block" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
stop-failure-block: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('stop-failure.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  // SF-3. StopFailure crash with onError: continue → exit 0, stderr contains diagnostic
  test('StopFailure crash with onError: continue → empty stdout, exit 0, stderr contains diagnostic', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'stop-failure-crash-continue.ts',
      `
export const hook = {
  meta: { name: "stop-failure-crash-continue" },
  StopFailure() {
    throw new Error("alerting failed")
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
stop-failure-crash-continue:
  onError: continue
`)
    const result = sandbox.run([], { stdin: loadEvent('stop-failure.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
    // Diagnostic surfaces via the systemMessage stream (onError: continue path).
    expect(result.stderr).toContain('stop-failure-crash-continue')
  })

  // SF-4. StopFailure crash with no override (cascade → block) → soft-coerce proof.
  // Engine writes one stderr warning containing "notify-only event",
  // does NOT block the pipeline, and records the failure for maxFailures.
  test('StopFailure crash with no override (cascade → block) → empty stdout, exit 0, stderr contains "notify-only event"', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'stop-failure-crash-block.ts',
      `
export const hook = {
  meta: { name: "stop-failure-crash-block" },
  StopFailure() {
    throw new Error("alerting endpoint is down")
  },
}
`,
    )
    // No onError override — global default cascades to "block".
    sandbox.writeConfig(`
version: "1.0.0"
stop-failure-crash-block: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('stop-failure.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
    // Exact soft-coerce anchor phrase — M1 baseline would not emit this.
    expect(result.stderr).toContain('notify-only event')
    expect(result.stderr).toContain('stop-failure-crash-block')
    expect(result.stderr).toContain('StopFailure')
  })
})
