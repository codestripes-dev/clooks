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

describe('error cascade advanced', () => {
  test('1. Hook A (onError:continue) crashes, Hook B (onError:block) crashes — both diagnostics + block', () => {
    sandbox = createSandbox()
    sandbox.writeHook('hook-a.ts', `
export const hook = {
  meta: { name: "hook-a" },
  PreToolUse() { throw new Error("hook-a crash") },
}
`)
    sandbox.writeHook('hook-b.ts', `
export const hook = {
  meta: { name: "hook-b" },
  PreToolUse() { throw new Error("hook-b crash") },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
hook-a:
  path: .clooks/hooks/hook-a.ts
  onError: continue
hook-b:
  path: .clooks/hooks/hook-b.ts
  onError: block
PreToolUse:
  order: [hook-a, hook-b]
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Hook B blocks because onError:block
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    // Both diagnostics should appear: hook-a in systemMessage (continue), hook-b in the block reason
    expect(output.systemMessage).toContain('hook-a')
    expect(output.systemMessage).toContain('Continuing')
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('hook-b')
  })

  test('2. two hooks crash with onError:continue — both diagnostics in systemMessage', () => {
    sandbox = createSandbox()
    sandbox.writeHook('cont-a.ts', `
export const hook = {
  meta: { name: "cont-a" },
  PreToolUse() { throw new Error("cont-a crash") },
}
`)
    sandbox.writeHook('cont-b.ts', `
export const hook = {
  meta: { name: "cont-b" },
  PreToolUse() { throw new Error("cont-b crash") },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
config:
  onError: continue
cont-a:
  path: .clooks/hooks/cont-a.ts
cont-b:
  path: .clooks/hooks/cont-b.ts
PreToolUse:
  order: [cont-a, cont-b]
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Both hooks swallowed — action not blocked
    expect(output.hookSpecificOutput?.permissionDecision).toBeUndefined()
    // Both diagnostics in systemMessage
    expect(output.systemMessage).toContain('cont-a')
    expect(output.systemMessage).toContain('cont-b')
  })

  test('3. hook degraded (above maxFailures) with onError:block — degraded message, no block', () => {
    sandbox = createSandbox()
    sandbox.writeHook('degrading.ts', `
export const hook = {
  meta: { name: "degrading" },
  PreToolUse() { throw new Error("degrading crash") },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
degrading:
  path: .clooks/hooks/degrading.ts
  maxFailures: 2
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocations 1-2: crash → block then degraded
    sandbox.run([], { stdin })
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.hookSpecificOutput?.additionalContext ?? '').toContain('will be skipped')

    // Invocation 3: still degraded — NOT blocked
    const r3 = sandbox.run([], { stdin })
    expect(r3.exitCode).toBe(0)
    const o3 = JSON.parse(r3.stdout)
    expect(o3.hookSpecificOutput.permissionDecision).not.toBe('deny')
    expect(o3.hookSpecificOutput?.additionalContext ?? '').toContain('will be skipped')
  })

  test('4. onError:trace on non-injectable event — fallback to continue, runtime warning', () => {
    sandbox = createSandbox()
    // SessionEnd is a non-injectable observe event
    sandbox.writeHook('trace-noninject.ts', `
export const hook = {
  meta: { name: "trace-noninject" },
  SessionEnd() { throw new Error("trace crash") },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
trace-noninject:
  path: .clooks/hooks/trace-noninject.ts
  onError: trace
`)

    const stdin = loadEvent('session-end.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(0)
    // Should get a warning about trace fallback to continue
    const output = JSON.parse(result.stdout)
    const sysMsg = output.systemMessage ?? ''
    expect(sysMsg).toContain('does not support additionalContext')
    expect(sysMsg).toContain('Falling back to "continue"')
  })

  test('5. beforeHook blocks, prior hooks injectContext merged into block result (injectable event)', () => {
    sandbox = createSandbox()
    // Hook A: allows with injectContext
    sandbox.writeHook('inject-a.ts', `
export const hook = {
  meta: { name: "inject-a" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "context-from-a" }
  },
}
`)
    // Hook B: beforeHook blocks
    sandbox.writeHook('before-block-b.ts', `
export const hook = {
  meta: { name: "before-block-b" },
  beforeHook(event: any) {
    event.respond({ result: "block", reason: "before-hook blocked" })
  },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
inject-a:
  path: .clooks/hooks/inject-a.ts
before-block-b:
  path: .clooks/hooks/before-block-b.ts
PreToolUse:
  order: [inject-a, before-block-b]
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Block from Hook B's beforeHook
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    // Hook A's injectContext is merged internally into blockResult.injectContext,
    // but PreToolUse deny output format drops additionalContext — only permissionDecision
    // and permissionDecisionReason are emitted. So the merge is structurally correct
    // but not observable in serialized output. Document this explicitly:
    expect(output.hookSpecificOutput.additionalContext).toBeUndefined()
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('before-hook blocked')
  })

  test('6. afterHook crashes — treated as runtime error, onError applies', () => {
    sandbox = createSandbox()
    sandbox.writeHook('after-crash.ts', `
export const hook = {
  meta: { name: "after-crash" },
  async afterHook() {
    throw new Error("afterHook kaboom")
  },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
after-crash:
  path: .clooks/hooks/after-crash.ts
  onError: continue
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // onError:continue means the afterHook crash is swallowed
    expect(output.hookSpecificOutput?.permissionDecision).toBeUndefined()
    // systemMessage should mention the error
    expect(output.systemMessage).toContain('after-crash')
    expect(output.systemMessage).toContain('afterHook kaboom')
  })

  test('7. beforeHook calls respond() twice — "only once" error, onError applies', () => {
    sandbox = createSandbox()
    sandbox.writeHook('respond-twice.ts', `
export const hook = {
  meta: { name: "respond-twice" },
  beforeHook(event: any) {
    event.respond({ result: "block", reason: "first respond" })
    event.respond({ result: "block", reason: "second respond" })
  },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`)
    // Use onError:block (default) to see the error surface
    sandbox.writeConfig(`
version: "1.0.0"
respond-twice:
  path: .clooks/hooks/respond-twice.ts
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Second respond() throws "only once" error.
    // Since first respond() already succeeded (blocking the handler),
    // the block from the first respond() takes effect.
    // The "only once" error is thrown from beforeHook but after respond() was already called.
    // The lifecycle function runs: beforeHook calls respond, which succeeds on first call.
    // Then calls respond again which throws. The throw propagates out of beforeHook.
    // Since beforeHook threw, the lifecycle() throws, which is caught by the engine.
    // onError:block means this surfaces as a block with diagnostic.
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    const reason = output.hookSpecificOutput.permissionDecisionReason ?? ''
    expect(reason).toContain('only be called once')
  })

  test('8. beforeHook calls respond(null) — "non-null result" error, onError applies', () => {
    sandbox = createSandbox()
    sandbox.writeHook('respond-null.ts', `
export const hook = {
  meta: { name: "respond-null" },
  beforeHook(event: any) {
    event.respond(null)
  },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
respond-null:
  path: .clooks/hooks/respond-null.ts
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // respond(null) throws "non-null result" error
    // onError:block (default) → blocked
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    const reason = output.hookSpecificOutput.permissionDecisionReason ?? ''
    expect(reason).toContain('non-null')
  })
})
