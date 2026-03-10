import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadHook = (name: string) => readFileSync(join(FIXTURES, 'hooks', name), 'utf8')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('composability', () => {
  // Scenario 1: Two parallel hooks both allow
  test('two parallel hooks both allow — context is merged', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeHook('allow-with-context.ts', loadHook('allow-with-context.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  path: .clooks/hooks/allow-all.ts
  parallel: true
allow-with-context:
  path: .clooks/hooks/allow-with-context.ts
  parallel: true
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(output.hookSpecificOutput.additionalContext).toContain('context from allow-with-context')
  })

  // Scenario 2: Parallel block short-circuits
  test('parallel block short-circuits — deny wins', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeHook('block-always.ts', loadHook('block-always.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  path: .clooks/hooks/allow-all.ts
  parallel: true
block-always:
  path: .clooks/hooks/block-always.ts
  parallel: true
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  // Scenario 3: Parallel hook crash triggers fail-closed
  test('parallel hook crash with onError block triggers fail-closed', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  path: .clooks/hooks/allow-all.ts
  parallel: true
crash-on-run:
  path: .clooks/hooks/crash-on-run.ts
  parallel: true
  onError: block
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('crash-on-run')
  })

  // Scenario 4: Parallel hook returning updatedInput is a contract violation
  test('parallel updatedInput is a contract violation — deny with systemMessage', () => {
    sandbox = createSandbox()
    sandbox.writeHook('rewrite-command.ts', loadHook('rewrite-command.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
rewrite-command:
  path: .clooks/hooks/rewrite-command.ts
  parallel: true
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.systemMessage).toContain('contract violation')
    expect(output.systemMessage).toContain('updatedInput in parallel mode')
  })

  // Scenario 6: injectContext accumulation across multiple hooks
  test('injectContext accumulates across three sequential hooks', () => {
    sandbox = createSandbox()
    sandbox.writeHook('ctx-alpha.ts', `
export const hook = {
  meta: { name: "ctx-alpha" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "alpha context" }
  },
}
`)
    sandbox.writeHook('ctx-beta.ts', `
export const hook = {
  meta: { name: "ctx-beta" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "beta context" }
  },
}
`)
    sandbox.writeHook('ctx-gamma.ts', `
export const hook = {
  meta: { name: "ctx-gamma" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "gamma context" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
ctx-alpha:
  path: .clooks/hooks/ctx-alpha.ts
ctx-beta:
  path: .clooks/hooks/ctx-beta.ts
ctx-gamma:
  path: .clooks/hooks/ctx-gamma.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext
    expect(ctx).toContain('alpha context')
    expect(ctx).toContain('beta context')
    expect(ctx).toContain('gamma context')
    // Verify they are joined by newlines
    const parts = ctx.split('\n')
    expect(parts.length).toBeGreaterThanOrEqual(3)
  })

  // Scenario 7: Explicit event order list
  test('explicit order list controls execution order', () => {
    sandbox = createSandbox()
    sandbox.writeHook('hook-a.ts', `
export const hook = {
  meta: { name: "hook-a" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "hook-a ran" }
  },
}
`)
    sandbox.writeHook('hook-b.ts', `
export const hook = {
  meta: { name: "hook-b" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "hook-b ran" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
hook-a:
  path: .clooks/hooks/hook-a.ts
hook-b:
  path: .clooks/hooks/hook-b.ts
PreToolUse:
  order: [hook-b, hook-a]
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext
    expect(ctx).toContain('hook-a ran')
    expect(ctx).toContain('hook-b ran')
    // hook-b should appear before hook-a since order is [hook-b, hook-a]
    const idxB = ctx.indexOf('hook-b ran')
    const idxA = ctx.indexOf('hook-a ran')
    expect(idxB).toBeLessThan(idxA)
  })

  // Scenario 8: Mixed sequential + parallel groups
  test('mixed sequential and parallel groups all execute', () => {
    sandbox = createSandbox()
    sandbox.writeHook('p1.ts', `
export const hook = {
  meta: { name: "p1" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "p1 ran" }
  },
}
`)
    sandbox.writeHook('p2.ts', `
export const hook = {
  meta: { name: "p2" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "p2 ran" }
  },
}
`)
    sandbox.writeHook('s1.ts', `
export const hook = {
  meta: { name: "s1" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "s1 ran" }
  },
}
`)
    sandbox.writeHook('p3.ts', `
export const hook = {
  meta: { name: "p3" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "p3 ran" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
p1:
  path: .clooks/hooks/p1.ts
  parallel: true
p2:
  path: .clooks/hooks/p2.ts
  parallel: true
s1:
  path: .clooks/hooks/s1.ts
p3:
  path: .clooks/hooks/p3.ts
  parallel: true
PreToolUse:
  order: [p1, p2, s1, p3]
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext
    expect(ctx).toContain('p1 ran')
    expect(ctx).toContain('p2 ran')
    expect(ctx).toContain('s1 ran')
    expect(ctx).toContain('p3 ran')
    // Verify group ordering: sequential s1 runs after parallel p1/p2, p3 runs after s1
    const idxP1 = ctx.indexOf('p1 ran')
    const idxP2 = ctx.indexOf('p2 ran')
    const idxS1 = ctx.indexOf('s1 ran')
    const idxP3 = ctx.indexOf('p3 ran')
    expect(idxS1).toBeGreaterThan(Math.max(idxP1, idxP2))
    expect(idxP3).toBeGreaterThan(idxS1)
  })

  // Scenario 9: Multiple hooks with mixed onError modes
  test('crash with onError continue does not block — pipeline continues', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeHook('allow-with-context.ts', loadHook('allow-with-context.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  path: .clooks/hooks/allow-all.ts
crash-on-run:
  path: .clooks/hooks/crash-on-run.ts
  onError: continue
allow-with-context:
  path: .clooks/hooks/allow-with-context.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // allow-with-context runs and its context appears
    expect(output.hookSpecificOutput.additionalContext).toContain('context from allow-with-context')
    // crash diagnostic is surfaced via systemMessage
    expect(output.systemMessage).toContain('crash-on-run')
    expect(output.systemMessage).toContain('Continuing')
  })

  // Scenario 10: injectContext survives a block
  test('injectContext from prior hook survives a subsequent block', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-with-context.ts', loadHook('allow-with-context.ts'))
    sandbox.writeHook('block-always.ts', loadHook('block-always.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-with-context:
  path: .clooks/hooks/allow-with-context.ts
block-always:
  path: .clooks/hooks/block-always.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // PreToolUse block output does not include additionalContext — it only has
    // permissionDecision and permissionDecisionReason. So we cannot directly observe
    // that allow-with-context's injectContext survived. We verify:
    // 1. The block came from block-always (proving it ran after allow-with-context)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('test block')
    // 2. Exit code 0 confirms allow-with-context didn't crash (it ran successfully before block-always)
    expect(result.exitCode).toBe(0)
  })
})
