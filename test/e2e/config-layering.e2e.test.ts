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

describe('config layering', () => {
  test('home + project configs merge — both hooks run', () => {
    sandbox = createSandbox()

    // Home config with a home hook
    sandbox.writeHomeHook('home-hook.ts', `
export const hook = {
  meta: { name: "home-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "from-home-hook" }
  },
}
`)
    sandbox.writeHomeConfig(`
version: "1.0.0"
home-hook: {}
`)

    // Project config with a project hook
    sandbox.writeHook('project-hook.ts', `
export const hook = {
  meta: { name: "project-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "from-project-hook" }
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
    expect(context).toContain('from-home-hook')
    expect(context).toContain('from-project-hook')
  })

  test('project hook shadows home hook — warning on SessionStart', () => {
    sandbox = createSandbox()

    // Home config: shared-hook returns home context
    sandbox.writeHomeHook('shared-hook.ts', `
export const hook = {
  meta: { name: "shared-hook" },
  SessionStart() { return null },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "from-home" }
  },
}
`)
    sandbox.writeHomeConfig(`
version: "1.0.0"
shared-hook: {}
`)

    // Project config: shared-hook (same name) returns project context
    sandbox.writeHook('shared-hook.ts', `
export const hook = {
  meta: { name: "shared-hook" },
  SessionStart() { return null },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "from-project" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
shared-hook: {}
`)

    // SessionStart should produce a shadow warning
    const r1 = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.systemMessage).toContain('clooks: project hook "shared-hook" is shadowing a global hook with the same name.')

    // PreToolUse should only run the project version
    const r2 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    const context = o2.hookSpecificOutput.additionalContext ?? ''
    expect(context).toContain('from-project')
    expect(context).not.toContain('from-home')
  })

  test('local override changes hook config', () => {
    sandbox = createSandbox()

    // Project config with config-echo hook using default config
    sandbox.writeHook('config-echo.ts', loadHook('config-echo.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
config-echo: {}
`)

    // Local override replaces config-echo entry with custom greeting
    // Local override uses atomic replacement
    sandbox.writeLocalConfig(`
config-echo:
  config:
    greeting: "local-override"
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const context = output.hookSpecificOutput.additionalContext ?? ''
    expect(context).toContain('config-echo received: {"greeting":"local-override"}')
  })

  test('home-only configuration — no project config', () => {
    sandbox = createSandbox()

    // Only home config, no project config at all
    sandbox.writeHomeHook('home-hook.ts', `
export const hook = {
  meta: { name: "home-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "home-only-works" }
  },
}
`)
    sandbox.writeHomeConfig(`
version: "1.0.0"
home-hook: {}
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(output.hookSpecificOutput.additionalContext).toContain('home-only-works')
  })
})
