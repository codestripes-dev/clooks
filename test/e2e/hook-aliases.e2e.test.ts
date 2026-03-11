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

// ---------------------------------------------------------------------------
// 1. Basic Alias Execution
// ---------------------------------------------------------------------------

describe('hook aliases — basic execution', () => {
  test('two aliases of same hook execute independently with different configs', () => {
    sandbox = createSandbox()
    sandbox.writeHook('log-bash.ts', `
export const hook = {
  meta: { name: "log-bash", config: { mode: "default" } },
  PreToolUse(_ctx: Record<string, unknown>, config: Record<string, unknown>) {
    return { result: "allow" as const, injectContext: \`mode=\${config.mode}\` }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
log-verbose:
  uses: log-bash
  config: { mode: "verbose" }
log-quiet:
  uses: log-bash
  config: { mode: "quiet" }
PreToolUse:
  order: [log-verbose, log-quiet]
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('mode=verbose')
    expect(ctx).toContain('mode=quiet')
  })

  test('alias of marketplace hook resolves to vendor directory', () => {
    sandbox = createSandbox()
    sandbox.writeFile('.clooks/vendor/acme/scanner/index.ts', `
export const hook = {
  meta: { name: "acme/scanner", config: { mode: "default" } },
  PreToolUse(_ctx: Record<string, unknown>, config: Record<string, unknown>) {
    return { result: "allow" as const, injectContext: \`scanner-mode=\${config.mode}\` }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
strict-scanner:
  uses: acme/scanner
  config: { mode: "enforce" }
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('scanner-mode=enforce')
  })

  test('alias with path-like uses resolves to custom file', () => {
    sandbox = createSandbox()
    sandbox.writeFile('lib/custom-hook.ts', `
export const hook = {
  meta: { name: "custom-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "custom-hook-ran" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
my-hook:
  uses: ./lib/custom-hook.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('custom-hook-ran')
  })
})

// ---------------------------------------------------------------------------
// 2. Migration & Validation Errors
// ---------------------------------------------------------------------------

describe('hook aliases — migration & validation errors', () => {
  test('deprecated path field produces migration error', () => {
    sandbox = createSandbox()
    sandbox.writeConfig(`
version: "1.0.0"
my-hook:
  path: scripts/hook.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('deprecated')
    expect(result.stderr).toContain('uses: "./scripts/hook.ts"')
  })

  test('alias chain produces validation error', () => {
    sandbox = createSandbox()
    sandbox.writeHook('real-hook.ts', `
export const hook = {
  meta: { name: "real-hook" },
  PreToolUse() { return { result: "allow" as const } },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
alias-a:
  uses: alias-b
alias-b:
  uses: real-hook
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Alias chains are not allowed')
  })

  test('bare path with .ts produces helpful error', () => {
    sandbox = createSandbox()
    sandbox.writeConfig(`
version: "1.0.0"
my-hook:
  uses: scripts/hook.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('uses: ./scripts/hook.ts')
  })
})

// ---------------------------------------------------------------------------
// 3. meta.name Validation
// ---------------------------------------------------------------------------

describe('hook aliases — meta.name validation', () => {
  test('alias meta.name validated against uses target, not YAML key', () => {
    sandbox = createSandbox()
    sandbox.writeHook('base-hook.ts', `
export const hook = {
  meta: { name: "base-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "base-hook-ran" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
my-alias:
  uses: base-hook
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('base-hook-ran')
  })

  test('alias meta.name mismatch with uses target fails', () => {
    sandbox = createSandbox()
    sandbox.writeHook('base-hook.ts', `
export const hook = {
  meta: { name: "wrong-name" },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
my-alias:
  uses: base-hook
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    // meta.name mismatch is a load error — goes through circuit breaker → deny result
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    // Error details appear in systemMessage (load error diagnostic)
    expect(output.systemMessage).toContain('meta.name')
    expect(output.systemMessage).toContain('wrong-name')
  })

  test('path-like uses skips meta.name validation', () => {
    sandbox = createSandbox()
    sandbox.writeFile('lib/hook.ts', `
export const hook = {
  meta: { name: "anything-goes" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "path-like-ran" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
my-hook:
  uses: ./lib/hook.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('path-like-ran')
  })
})

// ---------------------------------------------------------------------------
// 4. Error Messages
// ---------------------------------------------------------------------------

describe('hook aliases — error messages', () => {
  test('error message includes uses target for aliased hook', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crasher.ts', `
export const hook = {
  meta: { name: "crasher" },
  PreToolUse() {
    throw new Error("intentional crash")
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
my-alias:
  uses: crasher
  onError: block
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    // For runtime crashes (not load errors), the error details are in permissionDecisionReason
    const reason = output.hookSpecificOutput.permissionDecisionReason ?? ''
    expect(reason).toContain('my-alias')
    expect(reason).toContain('uses: crasher')
    expect(reason).toContain('crasher.ts')
  })

  test('error message for non-alias hook unchanged', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crasher.ts', `
export const hook = {
  meta: { name: "crasher" },
  PreToolUse() {
    throw new Error("intentional crash")
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
crasher: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const combined = result.stderr + (result.stdout ? (() => {
      try { return JSON.parse(result.stdout).systemMessage ?? '' } catch { return '' }
    })() : '')
    expect(combined).not.toContain('(uses:')
  })
})

// ---------------------------------------------------------------------------
// 5. Circuit Breaker Independence
// ---------------------------------------------------------------------------

describe('hook aliases — circuit breaker independence', () => {
  test('aliases have independent circuit breaker counters', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crasher.ts', `
export const hook = {
  meta: { name: "crasher" },
  PreToolUse() {
    throw new Error("intentional crash")
  },
}
`)
    // Use onError: continue so both aliases run on each invocation
    // (with onError: block, the first crash short-circuits the pipeline).
    // Different maxFailures thresholds let us verify independent counters.
    sandbox.writeConfig(`
version: "1.0.0"
alias-a:
  uses: crasher
  maxFailures: 2
  onError: continue
alias-b:
  uses: crasher
  maxFailures: 3
  onError: continue
PreToolUse:
  order: [alias-a, alias-b]
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: both crash, failure counts: alias-a=1, alias-b=1
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)

    // Invocation 2: both crash, failure counts: alias-a=2 (degraded), alias-b=2 (not yet)
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)

    // Invocation 3: alias-a is degraded (skipped with reminder), alias-b crashes (count=3, now degraded)
    const r3 = sandbox.run([], { stdin })
    expect(r3.exitCode).toBe(0)
    const o3 = JSON.parse(r3.stdout)
    const ctx3 = (o3.hookSpecificOutput?.additionalContext ?? '') + (o3.systemMessage ?? '')
    // alias-a should be skipped with a degraded message
    expect(ctx3).toContain('alias-a')
    // alias-b reaches its threshold on this invocation — it may appear as a
    // "Continuing" trace or degraded notice, but should NOT yet show "has been disabled"
    // because it only just hit the threshold (threshold=3, count now 3 → degraded).
    // Actually both will show "has been disabled" — alias-a from invocation 2, alias-b from this one.
    // The key independence test: alias-a was disabled on invocation 2, alias-b on invocation 3.

    // Invocation 4: both degraded — both skipped with reminders
    const r4 = sandbox.run([], { stdin })
    expect(r4.exitCode).toBe(0)
    const o4 = JSON.parse(r4.stdout)
    const ctx4 = (o4.hookSpecificOutput?.additionalContext ?? '') + (o4.systemMessage ?? '')
    expect(ctx4).toContain('alias-a')
    expect(ctx4).toContain('alias-b')
  })
})

// ---------------------------------------------------------------------------
// 6. Ordering
// ---------------------------------------------------------------------------

describe('hook aliases — ordering', () => {
  test('aliases participate independently in event ordering', () => {
    sandbox = createSandbox()
    sandbox.writeHook('ordered-hook.ts', `
export const hook = {
  meta: { name: "ordered-hook", config: { label: "default" } },
  PreToolUse(_ctx: Record<string, unknown>, config: Record<string, unknown>) {
    return { result: "allow" as const, injectContext: \`order=\${config.label}\` }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
second:
  uses: ordered-hook
  config: { label: "second" }
first:
  uses: ordered-hook
  config: { label: "first" }
PreToolUse:
  order: [first, second]
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('order=first')
    expect(ctx).toContain('order=second')
    // first should appear before second in the output
    const idxFirst = ctx.indexOf('order=first')
    const idxSecond = ctx.indexOf('order=second')
    expect(idxFirst).toBeLessThan(idxSecond)
  })
})

// ---------------------------------------------------------------------------
// 7. Config Resolved Output
// ---------------------------------------------------------------------------

describe('hook aliases — config resolved output', () => {
  test('clooks config --resolved shows uses and resolved for aliases', () => {
    sandbox = createSandbox()
    sandbox.writeHook('log-bash.ts', `
export const hook = {
  meta: { name: "log-bash" },
  PreToolUse() { return { result: "allow" as const } },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
verbose-logger:
  uses: log-bash
  config: { verbose: true }
`)
    const result = sandbox.run(['config', '--resolved'], {})
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('uses: log-bash')
    expect(result.stdout).toContain('resolved: .clooks/hooks/log-bash.ts')
  })

  test('clooks config --resolved --json shows uses and resolved', () => {
    sandbox = createSandbox()
    sandbox.writeHook('log-bash.ts', `
export const hook = {
  meta: { name: "log-bash" },
  PreToolUse() { return { result: "allow" as const } },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
verbose-logger:
  uses: log-bash
  config: { verbose: true }
`)
    const result = sandbox.run(['--json', 'config', '--resolved'], {})
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.ok).toBe(true)
    const hook = parsed.data.hooks['verbose-logger']
    expect(hook.uses).toBe('log-bash')
    expect(hook.resolved).toBe('.clooks/hooks/log-bash.ts')
  })
})

// ---------------------------------------------------------------------------
// 8. Referenced Hook Without YAML Entry (Rule 1)
// ---------------------------------------------------------------------------

describe('hook aliases — referenced hook without YAML entry', () => {
  test('alias works when referenced hook has no YAML entry', () => {
    sandbox = createSandbox()
    sandbox.writeHook('base-impl.ts', `
export const hook = {
  meta: { name: "base-impl", config: { key: "default" } },
  PreToolUse(_ctx: Record<string, unknown>, config: Record<string, unknown>) {
    return { result: "allow" as const, injectContext: \`key=\${config.key}\` }
  },
}
`)
    // No "base-impl:" entry in YAML — only the alias references it
    sandbox.writeConfig(`
version: "1.0.0"
my-alias:
  uses: base-impl
  config: { key: "overridden" }
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('key=overridden')
  })
})

// ---------------------------------------------------------------------------
// 9. Local Override of Alias
// ---------------------------------------------------------------------------

describe('hook aliases — local override', () => {
  test('local override without uses field fails — alias name does not resolve', () => {
    sandbox = createSandbox()
    sandbox.writeHook('log-bash.ts', `
export const hook = {
  meta: { name: "log-bash" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "log-bash-ran" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
verbose-logger:
  uses: log-bash
  config: { verbose: true }
`)
    // Local override replaces atomically — no uses field means it tries to
    // resolve "verbose-logger" as a file, which doesn't exist
    sandbox.writeLocalConfig(`
verbose-logger:
  config: { verbose: false }
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    // verbose-logger.ts doesn't exist — load error goes through circuit breaker → deny
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    // systemMessage should mention the missing file
    expect(output.systemMessage).toContain('verbose-logger')
  })

  test('local override of alias with uses field works', () => {
    sandbox = createSandbox()
    sandbox.writeHook('log-bash.ts', `
export const hook = {
  meta: { name: "log-bash", config: { verbose: true } },
  PreToolUse(_ctx: Record<string, unknown>, config: Record<string, unknown>) {
    return { result: "allow" as const, injectContext: \`verbose=\${config.verbose}\` }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
verbose-logger:
  uses: log-bash
  config: { verbose: true }
`)
    // Local override with uses repeated — works correctly
    sandbox.writeLocalConfig(`
verbose-logger:
  uses: log-bash
  config: { verbose: false }
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('verbose=false')
  })
})

// ---------------------------------------------------------------------------
// 10. Module-Level Shared State
// ---------------------------------------------------------------------------

describe('hook aliases — module-level shared state', () => {
  test('aliases of same hook share module-level state within one invocation', () => {
    sandbox = createSandbox()
    sandbox.writeHook('counter.ts', `
let counter = 0

export const hook = {
  meta: { name: "counter", config: {} },
  PreToolUse() {
    counter++
    return { result: "allow" as const, injectContext: \`counter=\${counter}\` }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
first-counter:
  uses: counter
second-counter:
  uses: counter
PreToolUse:
  order: [first-counter, second-counter]
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    // Both aliases share the same module, so counter increments:
    // first-counter sees counter=1, second-counter sees counter=2
    expect(ctx).toContain('counter=1')
    expect(ctx).toContain('counter=2')
  })
})
