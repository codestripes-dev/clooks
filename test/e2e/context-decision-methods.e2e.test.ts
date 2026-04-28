import { describe, test, expect, afterEach } from 'bun:test'
import { createSandbox, type Sandbox } from './helpers/sandbox'

// E2E coverage for ctx decision methods on tool-keyed events.
//
// Scenario 1: Bash PreToolUse — `ctx.allow({ updatedInput })` patch-merges
//   onto the running tool input.
// Scenario 2: Bash PermissionRequest — `ctx.allow({ updatedInput,
//   updatedPermissions })` echoes both onto the wire payload.
// Scenario 3: MCP-tool PermissionRequest — author casts ctx via
//   `as unknown as UnknownPermissionRequestContext` and returns
//   `ctx.allow({ updatedInput })` with a loose-typed patch.
// Scenario 4: Bash PreToolUse — `ctx.ask({ reason, updatedInput })`
//   emits permissionDecision:'ask' with permissionDecisionReason and
//   patch-merged updatedInput on the wire.

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

function preToolUseEvent(toolInput: Record<string, unknown>): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: toolInput,
  })
}

function permissionRequestEvent(toolName: string, toolInput: Record<string, unknown>): string {
  return JSON.stringify({
    hook_event_name: 'PermissionRequest',
    session_id: 'test-session-001',
    cwd: '/tmp/test',
    transcript_path: '/tmp/transcript.json',
    tool_name: toolName,
    tool_input: toolInput,
  })
}

describe('ctx decision methods (tool-keyed events)', () => {
  test('Scenario 1: PreToolUse Bash ctx.allow({ updatedInput }) merges patch into wire payload', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'pretooluse-allow-method.ts',
      `
export const hook = {
  meta: { name: "pretooluse-allow-method" },
  PreToolUse(ctx: { toolName: string; allow: (opts: { updatedInput?: Record<string, unknown> }) => unknown; skip: () => unknown }) {
    if (ctx.toolName === 'Bash') {
      return ctx.allow({ updatedInput: { timeout: 60000 } })
    }
    return ctx.skip()
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
pretooluse-allow-method: {}
`)
    const result = sandbox.run([], {
      stdin: preToolUseEvent({ command: 'ls', timeout: 30000 }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    // Patch-merge: the hook's updatedInput.timeout overrides; command is preserved.
    expect(output.hookSpecificOutput.updatedInput).toEqual({
      command: 'ls',
      timeout: 60000,
    })
  })

  test('Scenario 2: PermissionRequest Bash ctx.allow({ updatedInput, updatedPermissions }) echoes both', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'permreq-allow-method.ts',
      `
export const hook = {
  meta: { name: "permreq-allow-method" },
  PermissionRequest(ctx: { toolName: string; allow: (opts: { updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] }) => unknown; skip: () => unknown }) {
    if (ctx.toolName === 'Bash') {
      return ctx.allow({
        updatedInput: { command: 'npm run lint' },
        updatedPermissions: [
          { type: 'addRules', destination: 'session', behavior: 'allow', rules: [{ toolName: 'Bash', ruleContent: 'npm run lint' }] },
        ],
      })
    }
    return ctx.skip()
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
permreq-allow-method: {}
`)
    const result = sandbox.run([], {
      stdin: permissionRequestEvent('Bash', { command: 'npm run test', timeout: 5000 }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(output.hookSpecificOutput.decision.behavior).toBe('allow')
    // Patch-merge keeps timeout; command is overridden by the patch.
    expect(output.hookSpecificOutput.decision.updatedInput).toEqual({
      command: 'npm run lint',
      timeout: 5000,
    })
    expect(output.hookSpecificOutput.decision.updatedPermissions).toEqual([
      {
        type: 'addRules',
        destination: 'session',
        behavior: 'allow',
        rules: [{ toolName: 'Bash', ruleContent: 'npm run lint' }],
      },
    ])
  })

  test('Scenario 3: MCP-tool PermissionRequest via UnknownPermissionRequestContext cast', () => {
    sandbox = createSandbox()
    // The hook fixture below uses a local structural alias (`UnknownPermCtx`)
    // because the inline-string fixture cannot easily import from the project
    // sources at sandbox-runtime. The exported `UnknownPermissionRequestContext`
    // shape is validated separately at compile-time in
    // `test/types/decision-method-narrowing.types.ts` (stanza (e)).
    sandbox.writeHook(
      'permreq-mcp-unknown.ts',
      `
type UnknownPermCtx = {
  toolName: string
  toolInput: Record<string, unknown>
  allow: (opts: { updatedInput?: Record<string, unknown> }) => unknown
  skip: () => unknown
}

export const hook = {
  meta: { name: "permreq-mcp-unknown" },
  PermissionRequest(rawCtx: { toolName: string }) {
    const ctx = rawCtx as unknown as UnknownPermCtx
    if (ctx.toolName.startsWith('mcp__')) {
      return ctx.allow({ updatedInput: { argument: 'rewritten', extraField: 42 } })
    }
    return ctx.skip()
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
permreq-mcp-unknown: {}
`)
    const result = sandbox.run([], {
      stdin: permissionRequestEvent('mcp__memory__search', {
        argument: 'original',
        flag: true,
      }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(output.hookSpecificOutput.decision.behavior).toBe('allow')
    // Patch overrides argument, adds extraField, leaves flag untouched.
    expect(output.hookSpecificOutput.decision.updatedInput).toEqual({
      argument: 'rewritten',
      flag: true,
      extraField: 42,
    })
  })

  // M3 Gap 2: one acceptance scenario per category from the spike's matrix.
  // Scenario 5 — Guard event ctx.skip(): UserPromptSubmit returning skip with
  //   no opts should produce exit 0 + empty stdout (no hookSpecificOutput).
  // Scenario 6 — Observe event ctx.skip({ injectContext }): PostToolUse skip
  //   with injectContext echoes additionalContext on hookSpecificOutput.
  // Scenario 7 — Implementation event ctx.success({ path }): WorktreeCreate
  //   emits the path on stdout (raw string, not JSON).
  // Scenario 8 — Continuation event ctx.continue({ feedback }): TeammateIdle
  //   emits exit 2 with the feedback on stderr.

  test('Scenario 5: UserPromptSubmit ctx.skip() emits exit 0 with no stdout', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'ups-skip-method.ts',
      `
export const hook = {
  meta: { name: "ups-skip-method" },
  UserPromptSubmit(ctx: { skip: () => unknown }) {
    return ctx.skip()
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
ups-skip-method: {}
`)
    const result = sandbox.run([], {
      stdin: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        prompt: 'hello',
      }),
    })
    expect(result.exitCode).toBe(0)
    // Skip with no opts on a guard event produces no stdout — translateResult
    // returns { exitCode: EXIT_OK } only when no injectable fields are set.
    expect(result.stdout.trim()).toBe('')
  })

  test('Scenario 6: PostToolUse ctx.skip({ injectContext }) echoes additionalContext on hookSpecificOutput', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'pt-skip-inject-method.ts',
      `
export const hook = {
  meta: { name: "pt-skip-inject-method" },
  PostToolUse(ctx: { skip: (opts: { injectContext: string }) => unknown }) {
    return ctx.skip({ injectContext: 'context-from-hook' })
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
pt-skip-inject-method: {}
`)
    const result = sandbox.run([], {
      stdin: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        tool_response: 'ok',
        tool_use_id: 'tu-pt-skip-1',
      }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe('PostToolUse')
    expect(output.hookSpecificOutput.additionalContext).toBe('context-from-hook')
  })

  test('Scenario 7: WorktreeCreate ctx.success({ path }) emits the path on stdout', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'wt-success-method.ts',
      `
export const hook = {
  meta: { name: "wt-success-method" },
  WorktreeCreate(ctx: { success: (opts: { path: string }) => unknown }) {
    return ctx.success({ path: '/tmp/scratch-wt' })
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
wt-success-method: {}
`)
    const result = sandbox.run([], {
      stdin: JSON.stringify({
        hook_event_name: 'WorktreeCreate',
        name: 'scratch',
      }),
    })
    expect(result.exitCode).toBe(0)
    // WorktreeCreate success emits the raw path string on stdout, not JSON.
    expect(result.stdout.trim()).toBe('/tmp/scratch-wt')
  })

  test('Scenario 8: TeammateIdle ctx.continue({ feedback }) emits exit 2 with feedback on stderr', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'ti-continue-method.ts',
      `
export const hook = {
  meta: { name: "ti-continue-method" },
  TeammateIdle(ctx: { continue: (opts: { feedback: string }) => unknown }) {
    return ctx.continue({ feedback: 'keep going' })
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
ti-continue-method: {}
`)
    const result = sandbox.run([], {
      stdin: JSON.stringify({ hook_event_name: 'TeammateIdle' }),
    })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('keep going')
    expect(result.stdout.trim()).toBe('')
  })

  test('Scenario 4: PreToolUse Bash ctx.ask({ reason, updatedInput }) emits ask + reason + patch-merged updatedInput', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'pretooluse-ask-method.ts',
      `
export const hook = {
  meta: { name: "pretooluse-ask-method" },
  PreToolUse(ctx: { toolName: string; ask: (opts: { reason: string; updatedInput?: Record<string, unknown> }) => unknown; skip: () => unknown }) {
    if (ctx.toolName === 'Bash') {
      return ctx.ask({ reason: 'verify timeout', updatedInput: { timeout: 60000 } })
    }
    return ctx.skip()
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
pretooluse-ask-method: {}
`)
    const result = sandbox.run([], {
      stdin: preToolUseEvent({ command: 'ls', timeout: 30000 }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(output.hookSpecificOutput.permissionDecision).toBe('ask')
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe('verify timeout')
    // Patch-merge proof on the ask path: timeout overridden by patch,
    // command preserved from the running tool input.
    expect(output.hookSpecificOutput.updatedInput).toEqual({
      command: 'ls',
      timeout: 60000,
    })
  })
})
