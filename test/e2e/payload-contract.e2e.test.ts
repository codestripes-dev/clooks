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

describe('payload contract — context field optionality', () => {
  // 1. SessionStart hook receives no permissionMode
  test('SessionStart — permissionMode is absent', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'session-perm.ts',
      `
export const hook = {
  meta: { name: "session-perm" },
  SessionStart(ctx: any) {
    return { result: "skip" as const, injectContext: String(ctx.permissionMode) }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
session-perm: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.additionalContext).toBe('undefined')
  })

  // 2. PreCompact hook receives empty string customInstructions for auto trigger
  test('PreCompact — customInstructions is empty string for auto trigger', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'compact-auto.ts',
      `
export const hook = {
  meta: { name: "compact-auto" },
  PreCompact(ctx: any) {
    const isEmptyString = typeof ctx.customInstructions === "string" && ctx.customInstructions.length === 0
    return { result: "skip" as const, debugMessage: isEmptyString ? "empty-string-confirmed" : "unexpected:" + String(ctx.customInstructions) }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
compact-auto: {}
`)
    const result = sandbox.run([], {
      stdin: loadEvent('pre-compact.json'),
      env: { CLOOKS_DEBUG: 'true' },
    })
    expect(result.exitCode).toBe(0)
    // Debug mode outputs debug messages to stderr
    expect(result.stderr).toContain('empty-string-confirmed')
  })

  // 2b. PreCompact hook receives user-provided customInstructions for manual trigger
  test('PreCompact — customInstructions carries user content for manual trigger', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'compact-manual.ts',
      `
export const hook = {
  meta: { name: "compact-manual" },
  PreCompact(ctx: any) {
    return { result: "skip" as const, debugMessage: "instructions:" + String(ctx.customInstructions) }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
compact-manual: {}
`)
    const result = sandbox.run([], {
      stdin: loadEvent('pre-compact-manual.json'),
      env: { CLOOKS_DEBUG: 'true' },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('instructions:summarize the design discussion')
  })

  // 3. PostToolUse hook receives originalToolInput
  test('PostToolUse — originalToolInput is accessible', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'post-original.ts',
      `
export const hook = {
  meta: { name: "post-original" },
  PostToolUse(ctx: any) {
    const hasIt = ctx.originalToolInput !== undefined
    return { result: "skip" as const, injectContext: hasIt ? JSON.stringify(ctx.originalToolInput) : "missing" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
post-original: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('post-tool-use.json') })
    expect(result.exitCode).toBe(0)
    // originalToolInput is added by the engine for tool events — check it arrived
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.additionalContext).toContain('ls -la')
  })

  // 4. TaskCompleted hook handles missing teammateName
  test('TaskCompleted — teammateName absent is handled gracefully', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'task-team.ts',
      `
export const hook = {
  meta: { name: "task-team" },
  TaskCompleted(ctx: any) {
    const name = ctx.teammateName ?? "no-teammate"
    if (name !== "no-teammate") throw new Error("expected fallback value")
    return { result: "skip" as const }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
task-team: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('task-completed.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  // 5. PostToolUseFailure with isInterrupt absent
  test('PostToolUseFailure — isInterrupt absent is handled gracefully', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'ptuf-interrupt.ts',
      `
export const hook = {
  meta: { name: "ptuf-interrupt" },
  PostToolUseFailure(ctx: any) {
    const interrupt = ctx.isInterrupt ?? "not-present"
    return { result: "skip" as const, injectContext: String(interrupt) }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
ptuf-interrupt: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('post-tool-use-failure.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.additionalContext).toBe('not-present')
  })

  // 6. PermissionRequest with permissionSuggestions absent
  test('PermissionRequest — permissionSuggestions absent on minimal fixture', () => {
    sandbox = createSandbox()
    // Use an inline fixture without permission_suggestions to test the optional field
    sandbox.writeHook(
      'perm-suggest.ts',
      `
export const hook = {
  meta: { name: "perm-suggest" },
  PermissionRequest(ctx: any) {
    const hasSuggestions = ctx.permissionSuggestions !== undefined
    if (hasSuggestions) throw new Error("expected permissionSuggestions to be absent")
    return { result: "skip" as const }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
perm-suggest: {}
`)
    // Use inline fixture WITHOUT permission_suggestions
    const minimalFixture = JSON.stringify({
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'test' },
    })
    const result = sandbox.run([], { stdin: minimalFixture })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })
})

describe('payload contract — new output fields', () => {
  // 7. PermissionRequest allow with updatedPermissions
  test('PermissionRequest allow with updatedPermissions', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'perm-perms.ts',
      `
export const hook = {
  meta: { name: "perm-perms" },
  PermissionRequest() {
    return {
      result: "allow" as const,
      updatedPermissions: [{ tool: "Bash", permission: "allow" }],
    }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
perm-perms: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('permission-request.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(output.hookSpecificOutput.decision.behavior).toBe('allow')
    expect(output.hookSpecificOutput.decision.updatedPermissions).toEqual([
      { tool: 'Bash', permission: 'allow' },
    ])
  })

  // 8. PermissionRequest block with interrupt
  test('PermissionRequest block with interrupt', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'perm-interrupt.ts',
      `
export const hook = {
  meta: { name: "perm-interrupt" },
  PermissionRequest() {
    return {
      result: "block" as const,
      reason: "stopped",
      interrupt: true,
    }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
perm-interrupt: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('permission-request.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(output.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(output.hookSpecificOutput.decision.interrupt).toBe(true)
    expect(output.hookSpecificOutput.decision.message).toBe('stopped')
  })

  // 9. PostToolUse with updatedMCPToolOutput (top-level, not in hookSpecificOutput)
  test('PostToolUse with updatedMCPToolOutput → top-level output', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'post-mcp.ts',
      `
export const hook = {
  meta: { name: "post-mcp" },
  PostToolUse() {
    return {
      result: "skip" as const,
      updatedMCPToolOutput: { replaced: true },
    }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
post-mcp: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('post-tool-use.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.updatedMCPToolOutput).toEqual({ replaced: true })
    // Should NOT be inside hookSpecificOutput
    expect(output.hookSpecificOutput).toBeUndefined()
  })

  // 10. WorktreeCreate success without path → exit 1
  test('WorktreeCreate success without path → exit 1 with error', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'worktree-nopath.ts',
      `
export const hook = {
  meta: { name: "worktree-nopath" },
  WorktreeCreate() {
    return { result: "success" as const }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
worktree-nopath: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('worktree-create.json') })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('path is missing or empty')
  })

  // 11. PermissionRequest allow with updatedInput only (no updatedPermissions)
  test('PermissionRequest allow with updatedInput only', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'perm-input.ts',
      `
export const hook = {
  meta: { name: "perm-input" },
  PermissionRequest() {
    return {
      result: "allow" as const,
      updatedInput: { command: "safe-cmd" },
    }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
perm-input: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('permission-request.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(output.hookSpecificOutput.decision.behavior).toBe('allow')
    expect(output.hookSpecificOutput.decision.updatedInput).toEqual({ command: 'safe-cmd' })
    expect(output.hookSpecificOutput.decision.updatedPermissions).toBeUndefined()
  })
})
