import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

// --- Helpers ---

/** Compute the hash-based failure path for home-only configs. */
function hashFailurePath(homeRoot: string, projectRoot: string): string {
  const hash = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12)
  return join(homeRoot, '.clooks/failures', `${hash}.json`)
}

// ============================================================================
// Partial home state
// ============================================================================

describe('partial home state', () => {
  test('1. home dir exists, no config, no project config — exit 0 (noop)', () => {
    sandbox = createSandbox()
    // No configs at all — just the bare sandbox with a home dir
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  test('2. home config exists but hook file missing — load error circuit breaker at hash-based .failures path', () => {
    sandbox = createSandbox()

    // Home config references a hook file that doesn't exist
    sandbox.writeHomeConfig(`
version: "1.0.0"
missing-hook:
  uses: ./.clooks/hooks/does-not-exist.ts
  maxFailures: 3
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: import fails -> block (count 1 < 3)
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(o1.systemMessage).toContain('failed to load')

    // Verify hash-based failure path was created
    const failPath = hashFailurePath(sandbox.home, sandbox.dir)
    expect(existsSync(failPath)).toBe(true)

    // Invocation 2: count 2 < 3 -> still blocks
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.hookSpecificOutput.permissionDecision).toBe('deny')

    // Invocation 3: count 3 == 3 -> degraded (disabled)
    const r3 = sandbox.run([], { stdin })
    expect(r3.exitCode).toBe(0)
    const o3 = JSON.parse(r3.stdout)
    expect(o3.systemMessage).toContain('has been disabled')
  })

  test('3. malformed home config YAML — exit 2', () => {
    sandbox = createSandbox()

    // Use syntax that Bun's YAML parser rejects (nested braces)
    sandbox.writeHomeConfig(`{{{{`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('invalid YAML')
  })

  test('4. home config valid YAML but missing version — exit 2', () => {
    sandbox = createSandbox()

    sandbox.writeHomeConfig(`
my-hook: {}
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('version')
  })

  test('5. home config with version but zero hooks — exit 0 (noop)', () => {
    sandbox = createSandbox()

    sandbox.writeHomeConfig(`
version: "1.0.0"
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })
})

// ============================================================================
// Home-only circuit breaker
// ============================================================================

describe('home-only circuit breaker', () => {
  test('6. hash-based .failures path persists across invocations (3 invocations, threshold reached)', () => {
    sandbox = createSandbox()

    sandbox.writeHomeHook(
      'crash-hook.ts',
      `
export const hook = {
  meta: { name: "crash-hook" },
  PreToolUse() {
    throw new Error("intentional crash")
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
crash-hook:
  maxFailures: 3
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const failPath = hashFailurePath(sandbox.home, sandbox.dir)

    // Invocation 1: crash -> block, failure recorded
    sandbox.run([], { stdin })
    expect(existsSync(failPath)).toBe(true)
    const state1 = JSON.parse(readFileSync(failPath, 'utf8'))
    expect(state1['crash-hook'].PreToolUse.consecutiveFailures).toBe(1)

    // Invocation 2: crash -> block, failure count 2
    sandbox.run([], { stdin })
    const state2 = JSON.parse(readFileSync(failPath, 'utf8'))
    expect(state2['crash-hook'].PreToolUse.consecutiveFailures).toBe(2)

    // Invocation 3: crash -> degraded (count 3 == threshold)
    const r3 = sandbox.run([], { stdin })
    expect(r3.exitCode).toBe(0)
    const o3 = JSON.parse(r3.stdout)
    expect(o3.hookSpecificOutput.additionalContext).toContain('will be skipped')
  })

  test('7. recovery from home-only degradation clears hash-based failures file', () => {
    sandbox = createSandbox()

    sandbox.writeHomeHook(
      'crash-hook.ts',
      `
export const hook = {
  meta: { name: "crash-hook" },
  PreToolUse() {
    throw new Error("intentional crash")
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
crash-hook:
  maxFailures: 2
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const failPath = hashFailurePath(sandbox.home, sandbox.dir)

    // Invocation 1: crash -> block
    sandbox.run([], { stdin })
    expect(existsSync(failPath)).toBe(true)

    // Fix the hook
    sandbox.writeHomeHook(
      'crash-hook.ts',
      `
export const hook = {
  meta: { name: "crash-hook" },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`,
    )

    // Invocation 2: success -> failure counter clears, file removed
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.hookSpecificOutput.permissionDecision).toBe('allow')
    // Failure file should be cleaned up since state is empty
    expect(existsSync(failPath)).toBe(false)
  })

  test('8. two different projects with same home config — isolated hash-based failure files', () => {
    // Create two sandboxes sharing the same home directory structure
    const sandbox1 = createSandbox()
    const sandbox2 = createSandbox()

    const crashHook = `
export const hook = {
  meta: { name: "crash-hook" },
  PreToolUse() {
    throw new Error("intentional crash")
  },
}
`

    const homeConfig = `
version: "1.0.0"
crash-hook:
  maxFailures: 2
`

    // Set up both sandboxes with same home config
    sandbox1.writeHomeHook('crash-hook.ts', crashHook)
    sandbox1.writeHomeConfig(homeConfig)
    sandbox2.writeHomeHook('crash-hook.ts', crashHook)
    sandbox2.writeHomeConfig(homeConfig)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Crash in sandbox1 twice -> degraded in sandbox1
    sandbox1.run([], { stdin })
    sandbox1.run([], { stdin })

    // sandbox2 should still have 0 failures (different project root = different hash)
    const failPath1 = hashFailurePath(sandbox1.home, sandbox1.dir)
    const failPath2 = hashFailurePath(sandbox2.home, sandbox2.dir)
    expect(failPath1).not.toBe(failPath2)

    // sandbox2 first invocation should block (not degraded)
    const r = sandbox2.run([], { stdin })
    expect(r.exitCode).toBe(0)
    const o = JSON.parse(r.stdout)
    expect(o.hookSpecificOutput.permissionDecision).toBe('deny')

    sandbox1.cleanup()
    sandbox2.cleanup()
    // Prevent afterEach from double-cleaning
    sandbox = undefined as unknown as Sandbox
  })
})

// ============================================================================
// Multi-hook home configs
// ============================================================================

describe('multi-hook home configs', () => {
  test('9. two home hooks on PreToolUse, deny + allow — deny wins via precedence; both run', () => {
    sandbox = createSandbox()

    sandbox.writeHomeHook(
      'blocker.ts',
      `
export const hook = {
  meta: { name: "blocker" },
  PreToolUse() {
    return { result: "block" as const, reason: "blocked-by-home" }
  },
}
`,
    )
    sandbox.writeHomeHook(
      'observer.ts',
      `
import { writeFileSync } from "fs"
export const hook = {
  meta: { name: "observer" },
  PreToolUse() {
    writeFileSync("/tmp/clooks-observer-ran", "yes")
    return { result: "allow" as const, injectContext: "observer-ran" }
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
blocker: {}
observer: {}
PreToolUse:
  order: [blocker, observer]
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // deny > allow via M3 precedence — deny wins
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('blocked-by-home')
    // Both hooks run to completion; deny wins via precedence (rank 3 > rank 0).
    // Per the deny-winner accumulation rule, allow-loser injectContext is merged
    // into the deny winner and emitted as additionalContext by the translator:
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('observer-ran')
  })

  test('10. home config with explicit event order — ordering respected', () => {
    sandbox = createSandbox()

    sandbox.writeHomeHook(
      'first.ts',
      `
export const hook = {
  meta: { name: "first" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "FIRST" }
  },
}
`,
    )
    sandbox.writeHomeHook(
      'second.ts',
      `
export const hook = {
  meta: { name: "second" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "SECOND" }
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
first: {}
second: {}
PreToolUse:
  order: [first, second]
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    // Both should appear and FIRST should come before SECOND
    expect(ctx).toContain('FIRST')
    expect(ctx).toContain('SECOND')
    expect(ctx.indexOf('FIRST')).toBeLessThan(ctx.indexOf('SECOND'))
  })

  test('11. home hook handles SessionStart + PreToolUse, project hook handles PreToolUse only — home hook fires for SessionStart', () => {
    sandbox = createSandbox()

    // Home hook: handles both SessionStart and PreToolUse
    sandbox.writeHomeHook(
      'multi-event.ts',
      `
export const hook = {
  meta: { name: "multi-event" },
  SessionStart() {
    return { result: "allow" as const, injectContext: "home-session-start" }
  },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "home-pre-tool-use" }
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
multi-event: {}
`)

    // Project hook: handles PreToolUse only (different name, no shadow)
    sandbox.writeHook(
      'project-only.ts',
      `
export const hook = {
  meta: { name: "project-only" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "project-pre-tool-use" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
project-only: {}
`)

    // SessionStart: home hook should fire (project-only has no SessionStart handler)
    const r1 = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(r1.exitCode).toBe(0)
    // SessionStart is not injectable, so no additionalContext output — just verify it doesn't crash
    // and exits successfully

    // PreToolUse: both home and project hooks should fire
    const r2 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    const ctx = o2.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('home-pre-tool-use')
    expect(ctx).toContain('project-pre-tool-use')
  })

  test('12. shadow eliminates ALL home hook handlers — home SessionStart handler is gone', () => {
    sandbox = createSandbox()

    // Home hook: handles SessionStart and PreToolUse
    sandbox.writeHomeHook(
      'shared-hook.ts',
      `
export const hook = {
  meta: { name: "shared-hook" },
  SessionStart() {
    return { result: "allow" as const, injectContext: "home-session-handler" }
  },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "home-pretool-handler" }
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
shared-hook: {}
`)

    // Project hook: same name, only handles PreToolUse
    // This shadows the ENTIRE home hook — including its SessionStart handler
    sandbox.writeHook(
      'shared-hook.ts',
      `
export const hook = {
  meta: { name: "shared-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "project-pretool-handler" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
shared-hook: {}
`)

    // SessionStart: the home hook's SessionStart handler is gone because the whole hook is shadowed
    // No hooks match SessionStart, so exit 0 with just the shadow warning
    const r1 = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    // Should have shadow warning
    expect(o1.systemMessage).toContain('shadowing')
    // Should NOT have the home hook's SessionStart output
    const ctx1 = o1.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx1).not.toContain('home-session-handler')

    // PreToolUse: only the project version runs
    const r2 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    const ctx2 = o2.hookSpecificOutput.additionalContext ?? ''
    expect(ctx2).toContain('project-pretool-handler')
    expect(ctx2).not.toContain('home-pretool-handler')
  })
})

// ============================================================================
// Config globals conflict
// ============================================================================

describe('config globals conflict', () => {
  test('13. home onError: continue, project hook crashes — continue from home global applies', () => {
    sandbox = createSandbox()

    sandbox.writeHomeConfig(`
version: "1.0.0"
config:
  onError: continue
`)

    sandbox.writeHook(
      'crash-hook.ts',
      `
export const hook = {
  meta: { name: "crash-hook" },
  PreToolUse() {
    throw new Error("intentional crash")
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
crash-hook: {}
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Should NOT block — onError: continue from home global
    // Crash is swallowed, systemMessage has diagnostic
    expect(output.hookSpecificOutput?.permissionDecision).toBeUndefined()
    expect(output.systemMessage).toContain('Continuing')
  })

  test('14. home timeout: 5000, project timeout: 200, hook hangs — project wins, ~200ms timeout', () => {
    sandbox = createSandbox()

    sandbox.writeHomeConfig(`
version: "1.0.0"
config:
  timeout: 5000
`)

    // Use a never-resolving promise (no timers) so the process can exit after timeout
    sandbox.writeHook(
      'hang-hook.ts',
      `
export const hook = {
  meta: { name: "hang-hook" },
  PreToolUse() {
    return new Promise(() => {})
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
config:
  timeout: 200
hang-hook: {}
`)

    const start = Date.now()
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json'), timeout: 10000 })
    const elapsed = Date.now() - start
    expect(result.exitCode).toBe(0)
    // Should have timed out and blocked (default onError: block)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    // Timeout message should mention the timeout
    const reason = output.hookSpecificOutput.permissionDecisionReason ?? ''
    expect(reason).toContain('timed out')
    // Should complete in well under 5000ms (project timeout of 200ms applies)
    expect(elapsed).toBeLessThan(3000)
  })

  test('15. home maxFailures: 1 applied to project hook — degrades after 1 failure', () => {
    sandbox = createSandbox()

    sandbox.writeHomeConfig(`
version: "1.0.0"
config:
  maxFailures: 1
`)

    sandbox.writeHook(
      'crash-hook.ts',
      `
export const hook = {
  meta: { name: "crash-hook" },
  PreToolUse() {
    throw new Error("intentional crash")
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
crash-hook: {}
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: crash -> count 1 == threshold -> degraded immediately
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    // With maxFailures: 1, first crash puts count at 1 == threshold -> degraded
    expect(o1.hookSpecificOutput.additionalContext).toContain('will be skipped')
  })

  test('16. local onError: block overrides home onError: continue — block wins', () => {
    sandbox = createSandbox()

    sandbox.writeHomeConfig(`
version: "1.0.0"
config:
  onError: continue
`)

    sandbox.writeHook(
      'crash-hook.ts',
      `
export const hook = {
  meta: { name: "crash-hook" },
  PreToolUse() {
    throw new Error("intentional crash")
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
crash-hook: {}
`)

    // Local override: onError back to block
    sandbox.writeLocalConfig(`
config:
  onError: block
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Should block — local overrides home's continue with block
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  })
})

// ============================================================================
// Shadow edge cases
// ============================================================================

describe('shadow edge cases', () => {
  test('17. shadow warning only on SessionStart, absent on PreToolUse', () => {
    sandbox = createSandbox()

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

    // SessionStart: shadow warning should appear
    const r1 = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.systemMessage).toContain('shadowing')

    // PreToolUse: shadow warning should NOT appear (only emitted on SessionStart)
    const r2 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.systemMessage ?? '').not.toContain('shadowing')
  })

  test('18. multiple shadows all reported (2 home hooks shadowed by 2 project hooks)', () => {
    sandbox = createSandbox()

    // Home hooks
    sandbox.writeHomeHook(
      'hook-a.ts',
      `
export const hook = {
  meta: { name: "hook-a" },
  SessionStart() { return null },
}
`,
    )
    sandbox.writeHomeHook(
      'hook-b.ts',
      `
export const hook = {
  meta: { name: "hook-b" },
  SessionStart() { return null },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
hook-a: {}
hook-b: {}
`)

    // Project hooks with same names — bytes diverge so the shadow warning
    // is not suppressed by the byte-equality filter.
    sandbox.writeHook(
      'hook-a.ts',
      `
export const hook = {
  meta: { name: "hook-a" },
  SessionStart() { return null },
  // diverged from home
}
`,
    )
    sandbox.writeHook(
      'hook-b.ts',
      `
export const hook = {
  meta: { name: "hook-b" },
  SessionStart() { return null },
  // diverged from home
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
hook-a: {}
hook-b: {}
`)

    const result = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.systemMessage).toContain('clooks: project hooks shadowing home: hook-a, hook-b')
  })
})

// ============================================================================
// Local override + home interactions
// ============================================================================

describe('local override + home interactions', () => {
  test('19. local modifies home hook config — hook runs with overridden config, path stays home', () => {
    sandbox = createSandbox()

    sandbox.writeHomeHook(
      'config-hook.ts',
      `
export const hook = {
  meta: { name: "config-hook", config: { greeting: "default-hello" } },
  PreToolUse(_ctx: Record<string, unknown>, config: Record<string, unknown>) {
    return {
      result: "allow" as const,
      injectContext: \`config-hook received: \${JSON.stringify(config)}\`,
    }
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
config-hook: {}
`)

    // Local override changes the config
    // (local replacement is atomic per hook entry)
    sandbox.writeLocalConfig(`
config-hook:
  config:
    greeting: "local-override"
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('config-hook received: {"greeting":"local-override"}')
  })

  test('20. local defines new hook not in home or project — succeeds', () => {
    sandbox = createSandbox()

    sandbox.writeHomeConfig(`
version: "1.0.0"
`)

    sandbox.writeConfig(`
version: "1.0.0"
`)

    // Local defines a new hook that doesn't exist in home or project
    sandbox.writeLocalConfig(`
new-hook: {}
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// Special cases
// ============================================================================

describe('special cases', () => {
  test('21. cwd == home dir (isSameConfig guard) — config loads as home-only, no false shadow warnings', () => {
    sandbox = createSandbox()

    // Write config in the home dir's .clooks
    sandbox.writeHomeHook(
      'home-hook.ts',
      `
export const hook = {
  meta: { name: "home-hook" },
  SessionStart() { return null },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "home-hook-works" }
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
home-hook: {}
`)

    // Run with cwd set to the home dir — engine will see projectRoot == homeRoot
    const r1 = sandbox.run([], { stdin: loadEvent('session-start.json'), cwd: sandbox.home })
    expect(r1.exitCode).toBe(0)
    // No shadow warnings — isSameConfig prevents double-loading
    const o1Str = r1.stdout.trim()
    if (o1Str) {
      const o1 = JSON.parse(o1Str)
      expect(o1.systemMessage ?? '').not.toContain('shadowing')
    }

    // PreToolUse should work normally
    const r2 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json'), cwd: sandbox.home })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.hookSpecificOutput.additionalContext).toContain('home-hook-works')
  })

  test('22. home hook imports bare npm specifier — specific "pre-bundling" error message', () => {
    sandbox = createSandbox()

    // The imported value must be used (Bun tree-shakes unused imports)
    sandbox.writeHomeHook(
      'npm-hook.ts',
      `
import { foo } from "@nonexistent-clooks-test-pkg-xyz123"
export const hook = {
  meta: { name: "npm-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: String(foo) }
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
npm-hook: {}
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    // Load error triggers fail-closed (block) with a systemMessage about the import error
    const output = JSON.parse(result.stdout)
    expect(output.systemMessage).toContain('pre-bundling')
  })
})

// ============================================================================
// Event ordering across layers
// ============================================================================

describe('event ordering across layers', () => {
  test('23. home order + project order concatenate — home hooks run first', () => {
    sandbox = createSandbox()

    sandbox.writeHomeHook(
      'home-first.ts',
      `
export const hook = {
  meta: { name: "home-first" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "HOME-FIRST" }
  },
}
`,
    )
    sandbox.writeHomeHook(
      'home-second.ts',
      `
export const hook = {
  meta: { name: "home-second" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "HOME-SECOND" }
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
home-first: {}
home-second: {}
PreToolUse:
  order: [home-first, home-second]
`)

    sandbox.writeHook(
      'project-first.ts',
      `
export const hook = {
  meta: { name: "project-first" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "PROJECT-FIRST" }
  },
}
`,
    )
    sandbox.writeHook(
      'project-second.ts',
      `
export const hook = {
  meta: { name: "project-second" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "PROJECT-SECOND" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
project-first: {}
project-second: {}
PreToolUse:
  order: [project-first, project-second]
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    // All four should appear
    expect(ctx).toContain('HOME-FIRST')
    expect(ctx).toContain('HOME-SECOND')
    expect(ctx).toContain('PROJECT-FIRST')
    expect(ctx).toContain('PROJECT-SECOND')
    // Home hooks should come before project hooks (home order is prepended)
    expect(ctx.indexOf('HOME-FIRST')).toBeLessThan(ctx.indexOf('PROJECT-FIRST'))
    expect(ctx.indexOf('HOME-SECOND')).toBeLessThan(ctx.indexOf('PROJECT-FIRST'))
  })

  test('24. local order replaces concatenated home+project order', () => {
    sandbox = createSandbox()

    sandbox.writeHomeHook(
      'home-hook.ts',
      `
export const hook = {
  meta: { name: "home-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "HOME" }
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
home-hook: {}
PreToolUse:
  order: [home-hook]
`)

    sandbox.writeHook(
      'project-hook.ts',
      `
export const hook = {
  meta: { name: "project-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "PROJECT" }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
project-hook: {}
PreToolUse:
  order: [project-hook]
`)

    // Local override reverses the order: project before home
    sandbox.writeLocalConfig(`
PreToolUse:
  order: [project-hook, home-hook]
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    expect(ctx).toContain('HOME')
    expect(ctx).toContain('PROJECT')
    // Local order: project-hook first, then home-hook
    expect(ctx.indexOf('PROJECT')).toBeLessThan(ctx.indexOf('HOME'))
  })
})
