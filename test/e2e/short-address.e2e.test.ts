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

describe('short address resolution', () => {
  // Test 1: Short address hook loads and executes
  test('short address hook loads and executes', () => {
    sandbox = createSandbox()
    sandbox.writeFile(
      '.clooks/vendor/github.com/testuser/hooks/allow-all.ts',
      `
export const hook = {
  meta: { name: "allow-all" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "short-address-ran" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  uses: testuser/hooks:allow-all
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('short-address-ran')
  })

  // Test 2: Short address hook with config overrides
  test('short address hook receives config overrides', () => {
    sandbox = createSandbox()
    sandbox.writeFile(
      '.clooks/vendor/github.com/testuser/hooks/configurable.ts',
      `
export const hook = {
  meta: { name: "configurable", config: { mode: "default", severity: "warn" } },
  PreToolUse(_ctx: Record<string, unknown>, config: Record<string, unknown>) {
    return { result: "allow" as const, injectContext: \`mode=\${config.mode},severity=\${config.severity}\` }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
configurable:
  uses: testuser/hooks:configurable
  config:
    mode: strict
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('mode=strict')
    expect(ctx).toContain('severity=warn')
  })

  // Test 3: Multiple short-address hooks in order list
  test('multiple short-address hooks respect order list', () => {
    sandbox = createSandbox()
    sandbox.writeFile(
      '.clooks/vendor/github.com/testuser/pack/hook-a.ts',
      `
export const hook = {
  meta: { name: "hook-a" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "hook-a-ran" }
  },
}
`,
    )
    sandbox.writeFile(
      '.clooks/vendor/github.com/testuser/pack/hook-b.ts',
      `
export const hook = {
  meta: { name: "hook-b" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "hook-b-ran" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
hook-a:
  uses: testuser/pack:hook-a
hook-b:
  uses: testuser/pack:hook-b
PreToolUse:
  order: [hook-a, hook-b]
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('hook-a-ran')
    expect(ctx).toContain('hook-b-ran')
    const idxA = ctx.indexOf('hook-a-ran')
    const idxB = ctx.indexOf('hook-b-ran')
    expect(idxA).toBeLessThan(idxB)
  })

  // Test 4: Mixed path-like and short-address hooks
  test('mixed path-like and short-address hooks both execute', () => {
    sandbox = createSandbox()
    sandbox.writeFile(
      '.clooks/vendor/github.com/testuser/hooks/path-hook.ts',
      `
export const hook = {
  meta: { name: "path-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "path-hook-ran" }
  },
}
`,
    )
    sandbox.writeFile(
      '.clooks/vendor/github.com/testuser/hooks/short-hook.ts',
      `
export const hook = {
  meta: { name: "short-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "short-hook-ran" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
path-hook:
  uses: ./.clooks/vendor/github.com/testuser/hooks/path-hook.ts
short-hook:
  uses: testuser/hooks:short-hook
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('path-hook-ran')
    expect(ctx).toContain('short-hook-ran')
  })

  // Test 5: Short address for home hook
  test('short address hook in home config loads and executes', () => {
    sandbox = createSandbox()
    sandbox.writeHomeFile(
      '.clooks/vendor/github.com/testuser/hooks/home-hook.ts',
      `
export const hook = {
  meta: { name: "home-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "home-hook-ran" }
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
home-hook:
  uses: testuser/hooks:home-hook
`)
    // Also need a project config for the engine to run
    sandbox.writeConfig(`
version: "1.0.0"
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('home-hook-ran')
  })

  // Test 6: Short address not found produces fail-closed
  test('short address not found produces fail-closed behavior (deny)', () => {
    sandbox = createSandbox()
    // Intentionally do NOT write the vendor file
    sandbox.writeConfig(`
version: "1.0.0"
missing-hook:
  uses: testuser/hooks:nonexistent
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    // Fail-closed: load errors go through circuit breaker producing deny, exit 0
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  // Test 7: Short address with .js vendored hook
  test('short address with .js vendored hook loads and executes', () => {
    sandbox = createSandbox()
    sandbox.writeFile(
      '.clooks/vendor/github.com/testuser/hooks/js-hook.js',
      `
export const hook = {
  meta: { name: "js-hook" },
  PreToolUse() {
    return { result: "allow", injectContext: "js-short-addr-ran" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
js-hook:
  uses: testuser/hooks:js-hook
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('js-short-addr-ran')
  })
})
