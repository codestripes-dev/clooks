import { describe, test, expect, afterEach } from 'bun:test'
import { createSandbox, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

// Build events inline rather than using the shared fixture: patch-merge
// scenarios need custom tool_input shapes per test.
function preToolUseEvent(toolInput: Record<string, unknown>): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: toolInput,
  })
}

function permissionRequestEvent(toolInput: Record<string, unknown>): string {
  return JSON.stringify({
    hook_event_name: 'PermissionRequest',
    session_id: 'test-session-001',
    cwd: '/tmp/test',
    transcript_path: '/tmp/transcript.json',
    tool_name: 'Bash',
    tool_input: toolInput,
  })
}

describe('PreToolUse — updatedInput patch merge', () => {
  test('single hook partial patch merges onto running tool input', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'patch-command.ts',
      `
export const hook = {
  meta: { name: "patch-command" },
  PreToolUse() {
    return { result: "allow" as const, updatedInput: { command: "echo patched" } }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
patch-command: {}
`)
    const result = sandbox.run([], {
      stdin: preToolUseEvent({ command: 'echo original', timeout: 5000 }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(output.hookSpecificOutput.updatedInput).toEqual({
      command: 'echo patched',
      timeout: 5000,
    })
  })

  test('sequential chain accumulates patches across hooks', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'patch-env.ts',
      `
export const hook = {
  meta: { name: "patch-env" },
  PreToolUse() {
    return { result: "allow" as const, updatedInput: { env: "ci" } }
  },
}
`,
    )
    sandbox.writeHook(
      'patch-description.ts',
      `
export const hook = {
  meta: { name: "patch-description" },
  PreToolUse() {
    return { result: "allow" as const, updatedInput: { description: "linted" } }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
patch-env: {}
patch-description: {}
PreToolUse:
  order: [patch-env, patch-description]
`)
    // Seed original toolInput with command + timeout so the assertion proves
    // three-way merge: both original keys survive + both patches are added.
    const result = sandbox.run([], {
      stdin: preToolUseEvent({ command: 'echo x', timeout: 5000 }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.updatedInput).toEqual({
      command: 'echo x',
      timeout: 5000,
      env: 'ci',
      description: 'linted',
    })
  })

  test('null value in patch unsets the key from merged input', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'unset-timeout.ts',
      `
export const hook = {
  meta: { name: "unset-timeout" },
  PreToolUse() {
    return { result: "allow" as const, updatedInput: { timeout: null } }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
unset-timeout: {}
`)
    const result = sandbox.run([], {
      stdin: preToolUseEvent({ command: 'echo x', timeout: 5000 }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.updatedInput).toEqual({ command: 'echo x' })
    expect('timeout' in output.hookSpecificOutput.updatedInput).toBe(false)
  })

  test('parallel hooks returning updatedInput is rejected as contract violation', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'parallel-patch-a.ts',
      `
export const hook = {
  meta: { name: "parallel-patch-a" },
  PreToolUse() {
    return { result: "allow" as const, updatedInput: { command: "echo a" } }
  },
}
`,
    )
    sandbox.writeHook(
      'parallel-patch-b.ts',
      `
export const hook = {
  meta: { name: "parallel-patch-b" },
  PreToolUse() {
    return { result: "allow" as const, updatedInput: { command: "echo b" } }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
parallel-patch-a:
  parallel: true
parallel-patch-b:
  parallel: true
`)
    const result = sandbox.run([], {
      stdin: preToolUseEvent({ command: 'echo original', timeout: 5000 }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.systemMessage).toContain('contract violation')
    expect(output.systemMessage).toContain('updatedInput in parallel mode')
  })

  test('backwards-compatible full-shape return still merges identically', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'fullshape-rewrite.ts',
      `
export const hook = {
  meta: { name: "fullshape-rewrite" },
  PreToolUse(ctx: Record<string, unknown>) {
    const toolInput = ctx.toolInput as Record<string, unknown>
    return {
      result: "allow" as const,
      updatedInput: { ...toolInput, command: "new" },
    }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
fullshape-rewrite: {}
`)
    const result = sandbox.run([], {
      stdin: preToolUseEvent({ command: 'echo original', timeout: 5000 }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.updatedInput).toEqual({
      command: 'new',
      timeout: 5000,
    })
  })

  test('sequential hook B observes merge-so-far from hook A via ctx.toolInput', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'seq-a-patch-timeout.ts',
      `
export const hook = {
  meta: { name: "seq-a-patch-timeout" },
  PreToolUse() {
    return { result: "allow" as const, updatedInput: { timeout: 10000 } }
  },
}
`,
    )
    sandbox.writeHook(
      'seq-b-snapshot.ts',
      `
export const hook = {
  meta: { name: "seq-b-snapshot" },
  PreToolUse(ctx: Record<string, unknown>) {
    return {
      result: "allow" as const,
      injectContext: "TOOLINPUT_SNAPSHOT:" + JSON.stringify(ctx.toolInput),
    }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
seq-a-patch-timeout: {}
seq-b-snapshot: {}
PreToolUse:
  order: [seq-a-patch-timeout, seq-b-snapshot]
`)
    const result = sandbox.run([], {
      stdin: preToolUseEvent({ command: 'echo x', timeout: 5000 }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const additionalContext: string = output.hookSpecificOutput.additionalContext
    if (!additionalContext.startsWith('TOOLINPUT_SNAPSHOT:')) {
      throw new Error("hook B's snapshot did not reach the wire — merge-so-far threading broken.")
    }
    const parsed = JSON.parse(additionalContext.slice('TOOLINPUT_SNAPSHOT:'.length))
    expect(parsed.timeout).toBe(10000)
    expect(parsed.command).toBe('echo x')
  })

  test('sequential null unset propagates to next hook as key-absent', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'seq-a-unset-timeout.ts',
      `
export const hook = {
  meta: { name: "seq-a-unset-timeout" },
  PreToolUse() {
    return { result: "allow" as const, updatedInput: { timeout: null } }
  },
}
`,
    )
    sandbox.writeHook(
      'seq-b-snapshot-unset.ts',
      `
export const hook = {
  meta: { name: "seq-b-snapshot-unset" },
  PreToolUse(ctx: Record<string, unknown>) {
    return {
      result: "allow" as const,
      injectContext: "TOOLINPUT_SNAPSHOT:" + JSON.stringify(ctx.toolInput),
    }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
seq-a-unset-timeout: {}
seq-b-snapshot-unset: {}
PreToolUse:
  order: [seq-a-unset-timeout, seq-b-snapshot-unset]
`)
    const result = sandbox.run([], {
      stdin: preToolUseEvent({ command: 'echo x', timeout: 5000 }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const additionalContext: string = output.hookSpecificOutput.additionalContext
    if (!additionalContext.startsWith('TOOLINPUT_SNAPSHOT:')) {
      throw new Error("hook B's snapshot did not reach the wire — merge-so-far threading broken.")
    }
    const parsed = JSON.parse(additionalContext.slice('TOOLINPUT_SNAPSHOT:'.length))
    expect('timeout' in parsed).toBe(false)
    expect(parsed.command).toBe('echo x')
  })
})

describe('PermissionRequest — updatedInput patch merge', () => {
  test('single hook partial patch merges onto running tool input', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'perm-patch-command.ts',
      `
export const hook = {
  meta: { name: "perm-patch-command" },
  PermissionRequest() {
    return { result: "allow" as const, updatedInput: { command: "echo patched" } }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
perm-patch-command: {}
`)
    const result = sandbox.run([], {
      stdin: permissionRequestEvent({ command: 'echo original', timeout: 5000 }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(output.hookSpecificOutput.decision.behavior).toBe('allow')
    expect(output.hookSpecificOutput.decision.updatedInput).toEqual({
      command: 'echo patched',
      timeout: 5000,
    })
  })

  test('null value in patch unsets the key from merged input', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'perm-unset-timeout.ts',
      `
export const hook = {
  meta: { name: "perm-unset-timeout" },
  PermissionRequest() {
    return { result: "allow" as const, updatedInput: { timeout: null } }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
perm-unset-timeout: {}
`)
    const result = sandbox.run([], {
      stdin: permissionRequestEvent({ command: 'echo x', timeout: 5000 }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.decision.updatedInput).toEqual({ command: 'echo x' })
    expect('timeout' in output.hookSpecificOutput.decision.updatedInput).toBe(false)
  })

  test('parallel hooks returning updatedInput is rejected as contract violation', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'perm-parallel-a.ts',
      `
export const hook = {
  meta: { name: "perm-parallel-a" },
  PermissionRequest() {
    return { result: "allow" as const, updatedInput: { command: "echo a" } }
  },
}
`,
    )
    sandbox.writeHook(
      'perm-parallel-b.ts',
      `
export const hook = {
  meta: { name: "perm-parallel-b" },
  PermissionRequest() {
    return { result: "allow" as const, updatedInput: { command: "echo b" } }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
perm-parallel-a:
  parallel: true
perm-parallel-b:
  parallel: true
`)
    const result = sandbox.run([], {
      stdin: permissionRequestEvent({ command: 'echo original', timeout: 5000 }),
    })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // PermissionRequest contract-violation flows through block-result machinery,
    // which the PermissionRequest translator emits as hookSpecificOutput.decision.behavior === 'deny'.
    expect(output.hookSpecificOutput.hookEventName).toBe('PermissionRequest')
    expect(output.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(output.systemMessage).toContain('contract violation')
    expect(output.systemMessage).toContain('updatedInput in parallel mode')
  })
})
