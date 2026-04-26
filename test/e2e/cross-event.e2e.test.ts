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

describe('cross-event interactions', () => {
  // 1. Hook registered for both PreToolUse and PostToolUse —
  //    circuit breaker tracks per-event (PreToolUse failures don't affect PostToolUse)
  test('circuit breaker tracks failures per-event independently', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'multi-event.ts',
      `
export const hook = {
  meta: { name: "multi-event" },
  PreToolUse() {
    throw new Error("pre-tool crash")
  },
  PostToolUse() {
    return { result: "allow" as const, injectContext: "post-tool worked" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
multi-event:
  onError: block
  maxFailures: 2
`)
    // Crash on PreToolUse — should block
    const r1 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.hookSpecificOutput.permissionDecision).toBe('deny')

    // PostToolUse should still work — PreToolUse failures don't affect it
    const r2 = sandbox.run([], { stdin: loadEvent('post-tool-use.json') })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.hookSpecificOutput).toBeDefined()
    expect(o2.hookSpecificOutput.additionalContext).toBe('post-tool worked')
  })

  // 2. beforeHook blocks on PreToolUse — subsequent PostToolUse invocation still runs
  test('beforeHook block on PreToolUse does not affect PostToolUse', () => {
    sandbox = createSandbox()
    // Write a lifecycle module that blocks PreToolUse in beforeHook
    sandbox.writeHook(
      'lifecycle-multi.ts',
      `
export const hook = {
  meta: { name: "lifecycle-multi" },
  beforeHook(event: any) {
    if (event.type === "PreToolUse") {
      return event.block({ reason: "blocked in beforeHook" })
    }
  },
  PreToolUse(ctx: any) {
    return ctx.allow()
  },
  PostToolUse(ctx: any) {
    return ctx.skip({ injectContext: "post-tool passed" })
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
lifecycle-multi: {}
`)
    // PreToolUse blocked by beforeHook
    const r1 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.hookSpecificOutput.permissionDecision).toBe('deny')

    // PostToolUse should still run normally
    const r2 = sandbox.run([], { stdin: loadEvent('post-tool-use.json') })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.hookSpecificOutput.additionalContext).toBe('post-tool passed')
  })

  // 3. Hook crash on one event does not pollute circuit breaker of unhit hooks
  test('crash on one hook does not pollute another hook circuit breaker', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'crasher.ts',
      `
export const hook = {
  meta: { name: "crasher" },
  PreToolUse() {
    throw new Error("crasher failed")
  },
}
`,
    )
    sandbox.writeHook(
      'observer.ts',
      `
export const hook = {
  meta: { name: "observer" },
  PostToolUse(ctx: any) {
    return ctx.skip({ injectContext: "observed" })
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
crasher:
  onError: block
  maxFailures: 2
observer: {}
`)
    // Crash the first hook on PreToolUse
    const r1 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.hookSpecificOutput.permissionDecision).toBe('deny')

    // Observer on PostToolUse should be unaffected
    const r2 = sandbox.run([], { stdin: loadEvent('post-tool-use.json') })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.hookSpecificOutput.additionalContext).toBe('observed')
  })

  // 4. Unknown hook_event_name with valid JSON → exit 2
  test('unknown hook_event_name with valid JSON object → exit 2', () => {
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
      stdin: JSON.stringify({ hook_event_name: 'FakeEvent', tool_name: 'Bash' }),
    })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('missing or unrecognized')
  })

  // 5. Valid JSON array at top level → exit 2
  test('valid JSON array at top level → exit 2', () => {
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
      stdin: JSON.stringify([{ hook_event_name: 'PreToolUse' }]),
    })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('not a JSON object')
  })
})
