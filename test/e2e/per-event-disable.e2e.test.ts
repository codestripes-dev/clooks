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

// ============================================================================
// Core Behavior Tests
// ============================================================================

describe('per-event disable — core behavior', () => {
  test('1. hook-level enabled: false — hook does not run', () => {
    sandbox = createSandbox()

    sandbox.writeHook('blocker.ts', `
export const hook = {
  meta: { name: "blocker" },
  PreToolUse() {
    return { result: "block" as const, reason: "should-not-run" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
blocker:
  enabled: false
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    // No output at all — hook didn't run, so no block
    expect(result.stdout.trim()).toBe('')
  })

  test('2. per-event enabled: false — hook skipped for that event only', () => {
    sandbox = createSandbox()

    sandbox.writeHook('multi.ts', `
export const hook = {
  meta: { name: "multi" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "multi-pre-ran" }
  },
  PostToolUse() {
    return { result: "skip" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
multi:
  events:
    PreToolUse:
      enabled: false
`)

    // PreToolUse — hook should NOT run
    const r1 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(r1.exitCode).toBe(0)
    expect(r1.stdout.trim()).toBe('')

    // PostToolUse — hook SHOULD run
    const r2 = sandbox.run([], { stdin: loadEvent('post-tool-use.json') })
    expect(r2.exitCode).toBe(0)
    // PostToolUse returns skip, which produces no output — but the hook ran without error
  })

  test('3. debug logging shows disabled reason', () => {
    sandbox = createSandbox()

    sandbox.writeHook('debug-target.ts', `
export const hook = {
  meta: { name: "debug-target" },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
debug-target:
  events:
    PreToolUse:
      enabled: false
`)

    const result = sandbox.run([], {
      stdin: loadEvent('pre-tool-use-bash.json'),
      env: { CLOOKS_DEBUG: 'true' },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('hook "debug-target" disabled for event "PreToolUse" via config')
  })

  test('4. hook-level disable takes precedence over per-event settings', () => {
    sandbox = createSandbox()

    sandbox.writeHook('precedence.ts', `
export const hook = {
  meta: { name: "precedence" },
  PreToolUse() {
    return { result: "block" as const, reason: "should-not-run" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
precedence:
  enabled: false
  events:
    PreToolUse:
      onError: continue
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  test('5. disabled hook in order list — silently skipped, no error', () => {
    sandbox = createSandbox()

    sandbox.writeHook('enabled-hook.ts', `
export const hook = {
  meta: { name: "enabled-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "enabled-hook-ran" }
  },
}
`)
    sandbox.writeHook('disabled-hook.ts', `
export const hook = {
  meta: { name: "disabled-hook" },
  PreToolUse() {
    return { result: "block" as const, reason: "should-not-run" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
enabled-hook: {}
disabled-hook:
  events:
    PreToolUse:
      enabled: false
PreToolUse:
  order: [enabled-hook, disabled-hook]
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.additionalContext).toContain('enabled-hook-ran')
  })

  test('6. all events disabled — hook simply does not run', () => {
    sandbox = createSandbox()

    sandbox.writeHook('all-disabled.ts', `
export const hook = {
  meta: { name: "all-disabled" },
  PreToolUse() {
    return { result: "block" as const, reason: "should-not-run" }
  },
  PostToolUse() {
    return { result: "skip" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
all-disabled:
  events:
    PreToolUse:
      enabled: false
    PostToolUse:
      enabled: false
`)

    const r1 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(r1.exitCode).toBe(0)
    expect(r1.stdout.trim()).toBe('')

    const r2 = sandbox.run([], { stdin: loadEvent('post-tool-use.json') })
    expect(r2.exitCode).toBe(0)
  })

  test('7. unhandled event warning on SessionStart', () => {
    sandbox = createSandbox()

    sandbox.writeHook('warn-target.ts', `
export const hook = {
  meta: { name: "warn-target" },
  PreToolUse() {
    return { result: "allow" as const }
  },
  SessionStart() { return null },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
warn-target:
  events:
    PostToolUse:
      enabled: false
`)

    const result = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.systemMessage).toContain('warn-target')
    expect(output.systemMessage).toContain('PostToolUse')
    expect(output.systemMessage).toContain('does not handle event')
  })

  test('8. validation rejects non-boolean enabled', () => {
    sandbox = createSandbox()

    sandbox.writeHook('bad-enabled.ts', `
export const hook = {
  meta: { name: "bad-enabled" },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
bad-enabled:
  enabled: "yes"
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('boolean')
  })
})

// ============================================================================
// Config Layering Tests
// ============================================================================

describe('per-event disable — config layering', () => {
  test('9. local override disables a project hook', () => {
    sandbox = createSandbox()

    sandbox.writeHook('guard-hook.ts', `
export const hook = {
  meta: { name: "guard-hook" },
  PreToolUse() {
    return { result: "block" as const, reason: "guard-blocked" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
guard-hook: {}
`)
    sandbox.writeLocalConfig(`
guard-hook:
  enabled: false
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  test('10. local override disables a specific event on a project hook', () => {
    sandbox = createSandbox()

    sandbox.writeHook('multi-hook.ts', `
export const hook = {
  meta: { name: "multi-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "multi-pre-ran" }
  },
  PostToolUse() {
    return { result: "skip" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
multi-hook:
  events:
    PreToolUse:
      onError: continue
`)
    sandbox.writeLocalConfig(`
multi-hook:
  events:
    PreToolUse:
      enabled: false
`)

    // PreToolUse — disabled via local override
    const r1 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(r1.exitCode).toBe(0)
    expect(r1.stdout.trim()).toBe('')

    // PostToolUse — still runs (local atomic replacement only affects the events map)
    const r2 = sandbox.run([], { stdin: loadEvent('post-tool-use.json') })
    expect(r2.exitCode).toBe(0)
  })

  test('11. home hook disabled via home config', () => {
    sandbox = createSandbox()

    sandbox.writeHomeHook('home-hook.ts', `
export const hook = {
  meta: { name: "home-hook" },
  PreToolUse() {
    return { result: "block" as const, reason: "home-blocked" }
  },
}
`)
    sandbox.writeHomeConfig(`
version: "1.0.0"
home-hook:
  enabled: false
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  test('12. home hook disabled per-event, project hook unaffected', () => {
    sandbox = createSandbox()

    sandbox.writeHomeHook('home-hook.ts', `
export const hook = {
  meta: { name: "home-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "from-home" }
  },
}
`)
    sandbox.writeHomeConfig(`
version: "1.0.0"
home-hook:
  events:
    PreToolUse:
      enabled: false
`)

    sandbox.writeHook('project-hook.ts', `
export const hook = {
  meta: { name: "project-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "from-project" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
project-hook: {}
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const context = output.hookSpecificOutput.additionalContext ?? ''
    expect(context).toContain('from-project')
    expect(context).not.toContain('from-home')
  })

  test('13. local disables a home hook (home-only setup, no project config)', () => {
    sandbox = createSandbox()

    sandbox.writeHomeHook('home-hook.ts', `
export const hook = {
  meta: { name: "home-hook" },
  PreToolUse() {
    return { result: "block" as const, reason: "home-blocked" }
  },
}
`)
    sandbox.writeHomeConfig(`
version: "1.0.0"
home-hook: {}
`)
    sandbox.writeLocalConfig(`
home-hook:
  enabled: false
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  test('14. disabled hook in order list with home+project hooks', () => {
    sandbox = createSandbox()

    sandbox.writeHomeHook('home-hook.ts', `
export const hook = {
  meta: { name: "home-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "home-hook-ran" }
  },
}
`)
    sandbox.writeHomeConfig(`
version: "1.0.0"
home-hook: {}
PreToolUse:
  order: [home-hook]
`)

    sandbox.writeHook('proj-hook.ts', `
export const hook = {
  meta: { name: "proj-hook" },
  PreToolUse() {
    return { result: "block" as const, reason: "should-not-run" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
proj-hook:
  events:
    PreToolUse:
      enabled: false
PreToolUse:
  order: [proj-hook]
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const context = output.hookSpecificOutput.additionalContext ?? ''
    expect(context).toContain('home-hook-ran')
  })

  test('15. order list startup warning for disabled hook on SessionStart', () => {
    sandbox = createSandbox()

    sandbox.writeHook('active-hook.ts', `
export const hook = {
  meta: { name: "active-hook" },
  PreToolUse() {
    return { result: "allow" as const }
  },
  SessionStart() { return null },
}
`)
    sandbox.writeHook('inactive-hook.ts', `
export const hook = {
  meta: { name: "inactive-hook" },
  PreToolUse() {
    return { result: "allow" as const }
  },
  SessionStart() { return null },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
active-hook: {}
inactive-hook:
  enabled: false
PreToolUse:
  order: [active-hook, inactive-hook]
`)

    const result = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.systemMessage).toContain('inactive-hook')
    expect(output.systemMessage).toContain('disabled')
  })
})
