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

describe('vendoring', () => {
  // Test 1: Vendor .ts hook loads and executes
  test('vendor .ts hook loads and executes', () => {
    sandbox = createSandbox()
    sandbox.writeFile(
      '.clooks/vendor/github.com/testuser/hooks/allow-all.ts',
      `
export const hook = {
  meta: { name: "allow-all" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "vendor-hook-ran" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  uses: ./.clooks/vendor/github.com/testuser/hooks/allow-all.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('vendor-hook-ran')
  })

  // Test 2: Vendor .js hook loads and executes
  test('vendor .js hook loads and executes', () => {
    sandbox = createSandbox()
    sandbox.writeFile(
      '.clooks/vendor/github.com/testuser/hooks/js-hook.js',
      `
export const hook = {
  meta: { name: "js-vendor-hook" },
  PreToolUse() {
    return { result: "allow", injectContext: "js-vendor-ran" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
js-vendor-hook:
  uses: ./.clooks/vendor/github.com/testuser/hooks/js-hook.js
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('js-vendor-ran')
  })

  // Test 3: Vendor hook meta.name mismatch is allowed for path-like uses
  test('vendor hook meta.name mismatch is allowed for path-like uses', () => {
    sandbox = createSandbox()
    sandbox.writeFile(
      '.clooks/vendor/github.com/testuser/hooks/mismatch-hook.ts',
      `
export const hook = {
  meta: { name: "internal-name" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "mismatch-hook-ran" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
lint-guard:
  uses: ./.clooks/vendor/github.com/testuser/hooks/mismatch-hook.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('mismatch-hook-ran')
  })

  // Test 4: Vendor hook with config overrides
  test('vendor hook receives config overrides from clooks.yml', () => {
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
  uses: ./.clooks/vendor/github.com/testuser/hooks/configurable.ts
  config:
    mode: strict
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('mode=strict') // override took effect
    expect(ctx).toContain('severity=warn') // default survived merge
  })

  // Test 5: Missing vendor file produces fail-closed behavior
  test('missing vendor file produces fail-closed behavior (deny)', () => {
    sandbox = createSandbox()
    // Intentionally do NOT write the vendor file
    sandbox.writeConfig(`
version: "1.0.0"
missing-hook:
  uses: ./.clooks/vendor/github.com/testuser/hooks/nonexistent.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    // Fail-closed: load errors go through circuit breaker producing deny, exit 0
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  // Test 6: Vendor hook in order list executes after local hook
  test('vendor hook in order list executes after local hook', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'local-hook.ts',
      `
export const hook = {
  meta: { name: "local-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "local-hook-ran" }
  },
}
`,
    )
    sandbox.writeFile(
      '.clooks/vendor/github.com/testuser/hooks/vendor-hook.ts',
      `
export const hook = {
  meta: { name: "vendor-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "vendor-hook-ran" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
local-hook: {}
vendor-hook:
  uses: ./.clooks/vendor/github.com/testuser/hooks/vendor-hook.ts
PreToolUse:
  order: [local-hook, vendor-hook]
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('local-hook-ran')
    expect(ctx).toContain('vendor-hook-ran')
    // local-hook should appear before vendor-hook in the accumulated context
    const idxLocal = ctx.indexOf('local-hook-ran')
    const idxVendor = ctx.indexOf('vendor-hook-ran')
    expect(idxLocal).toBeLessThan(idxVendor)
  })
})
