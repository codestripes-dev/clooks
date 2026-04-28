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
    sandbox.writeHomeHook(
      'home-hook.ts',
      `
export const hook = {
  meta: { name: "home-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "from-home-hook" }
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
home-hook: {}
`)

    // Project config with a project hook
    sandbox.writeHook(
      'project-hook.ts',
      `
export const hook = {
  meta: { name: "project-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "from-project-hook" }
  },
}
`,
    )
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
    sandbox.writeHomeHook(
      'shared-hook.ts',
      `
export const hook = {
  meta: { name: "shared-hook" },
  SessionStart() { return null },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "from-home" }
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
shared-hook: {}
`)

    // Project config: shared-hook (same name) returns project context
    sandbox.writeHook(
      'shared-hook.ts',
      `
export const hook = {
  meta: { name: "shared-hook" },
  SessionStart() { return null },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "from-project" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
shared-hook: {}
`)

    // SessionStart should produce a shadow warning
    const r1 = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.systemMessage).toContain('clooks: project hooks shadowing home: shared-hook')

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

  test('no shadow warning when project hook bytes match home', () => {
    sandbox = createSandbox()

    const sharedSource = `
export const hook = {
  meta: { name: "shared-hook" },
  SessionStart() { return null },
}
`
    sandbox.writeHomeHook('shared-hook.ts', sharedSource)
    sandbox.writeHomeConfig(`
version: "1.0.0"
shared-hook: {}
`)

    sandbox.writeHook('shared-hook.ts', sharedSource)
    sandbox.writeConfig(`
version: "1.0.0"
shared-hook: {}
`)

    const r = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(r.exitCode).toBe(0)
    // No warning, no hook output → empty stdout. Assert directly on stdout
    // rather than JSON.parse, which would fail on an empty buffer.
    expect(r.stdout).not.toContain('clooks: project hooks shadowing home')
  })

  test('shadow warning fires when project hook diverges from home', () => {
    sandbox = createSandbox()

    sandbox.writeHomeHook(
      'shared-hook.ts',
      `
export const hook = {
  meta: { name: "shared-hook" },
  SessionStart() { return null },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
shared-hook: {}
`)

    sandbox.writeHook(
      'shared-hook.ts',
      `
export const hook = {
  meta: { name: "shared-hook" },
  SessionStart() { return null },
  // diverged from home
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
shared-hook: {}
`)

    const r = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(r.exitCode).toBe(0)
    const o = JSON.parse(r.stdout)
    expect(o.systemMessage).toContain('clooks: project hooks shadowing home: shared-hook')
  })

  test('partial shadow suppression — only divergent hooks appear in collapsed line', () => {
    sandbox = createSandbox()

    const sharedA = `
export const hook = {
  meta: { name: "hook-a" },
  SessionStart() { return null },
}
`
    const sharedB = `
export const hook = {
  meta: { name: "hook-b" },
  SessionStart() { return null },
}
`
    const homeC = `
export const hook = {
  meta: { name: "hook-c" },
  SessionStart() { return null },
}
`
    const projectC = `
export const hook = {
  meta: { name: "hook-c" },
  SessionStart() { return null },
  // diverged from home
}
`

    sandbox.writeHomeHook('hook-a.ts', sharedA)
    sandbox.writeHomeHook('hook-b.ts', sharedB)
    sandbox.writeHomeHook('hook-c.ts', homeC)
    sandbox.writeHomeConfig(`
version: "1.0.0"
hook-a: {}
hook-b: {}
hook-c: {}
`)

    sandbox.writeHook('hook-a.ts', sharedA)
    sandbox.writeHook('hook-b.ts', sharedB)
    sandbox.writeHook('hook-c.ts', projectC)
    sandbox.writeConfig(`
version: "1.0.0"
hook-a: {}
hook-b: {}
hook-c: {}
`)

    const r = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(r.exitCode).toBe(0)
    const o = JSON.parse(r.stdout)
    expect(o.systemMessage).toContain('clooks: project hooks shadowing home: hook-c')
    expect(o.systemMessage).not.toContain('hook-a')
    expect(o.systemMessage).not.toContain('hook-b')
  })

  test('shadow suppressed when project hook is referenced via path-like uses', () => {
    sandbox = createSandbox()

    const sharedSource = `
export const hook = {
  meta: { name: "vendored-hook" },
  SessionStart() { return null },
}
`
    // Home references the hook via a path-like uses pointing into a custom
    // subdir (not the convention path). Project mirrors the same pattern.
    // Filter must re-derive both paths against their respective roots — if
    // it ever trusted entry.resolvedPath (cwd-relative), suppression would
    // silently break under the binary's $CLAUDE_PROJECT_DIR cwd.
    sandbox.writeHomeFile('.clooks/custom/vendored-hook.ts', sharedSource)
    sandbox.writeHomeConfig(`
version: "1.0.0"
vendored-hook:
  uses: ./.clooks/custom/vendored-hook.ts
`)

    sandbox.writeFile('.clooks/custom/vendored-hook.ts', sharedSource)
    sandbox.writeConfig(`
version: "1.0.0"
vendored-hook:
  uses: ./.clooks/custom/vendored-hook.ts
`)

    const r = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).not.toContain('clooks: project hooks shadowing home')
  })

  test('shadow suppressed when project hook uses short-address vendored copy', () => {
    sandbox = createSandbox()

    const sharedSource = `
export const hook = {
  meta: { name: "team-hook" },
  SessionStart() { return null },
}
`
    // Home keeps the hook at the convention path (~/.clooks/hooks/<name>.ts)
    // while project pulls it via short-address vendoring
    // (.clooks/vendor/github.com/<owner>/<repo>/<name>.ts) — the dominant
    // real-world topology FEAT-0068 was built for.
    sandbox.writeHomeHook('team-hook.ts', sharedSource)
    sandbox.writeHomeConfig(`
version: "1.0.0"
team-hook: {}
`)

    sandbox.writeFile('.clooks/vendor/github.com/acme/core-hooks/team-hook.ts', sharedSource)
    sandbox.writeConfig(`
version: "1.0.0"
team-hook:
  uses: acme/core-hooks:team-hook
`)

    const r = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).not.toContain('clooks: project hooks shadowing home')
  })

  test('home-only configuration — no project config', () => {
    sandbox = createSandbox()

    // Only home config, no project config at all
    sandbox.writeHomeHook(
      'home-hook.ts',
      `
export const hook = {
  meta: { name: "home-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "home-only-works" }
  },
}
`,
    )
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
