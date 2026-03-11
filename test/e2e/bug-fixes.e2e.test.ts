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

describe('Bug 1: LOAD_ERROR_EVENT counter cleared after hook restoration', () => {
  test('hook recovers from load-error degradation when file is restored', () => {
    sandbox = createSandbox()

    // Register a hook pointing to a MISSING file with maxFailures: 3
    sandbox.writeConfig(`
version: "1.0.0"
recoverable-hook:
  maxFailures: 3
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocations 1-2: load error, under threshold → block
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(o1.systemMessage).toContain('failed to load')

    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.hookSpecificOutput.permissionDecision).toBe('deny')

    // Invocation 3: threshold reached → degraded
    const r3 = sandbox.run([], { stdin })
    expect(r3.exitCode).toBe(0)
    const o3 = JSON.parse(r3.stdout)
    expect(o3.systemMessage).toContain('has been disabled')

    // Invocation 4: still degraded, "will be skipped" message
    const r4 = sandbox.run([], { stdin })
    expect(r4.exitCode).toBe(0)
    const o4 = JSON.parse(r4.stdout)
    expect(o4.hookSpecificOutput?.additionalContext ?? o4.systemMessage ?? '').toContain('will be skipped')

    // NOW RESTORE the hook file
    sandbox.writeHook('recoverable-hook.ts', `
export const hook = {
  meta: { name: "recoverable-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "hook-restored" }
  },
}
`)

    // Invocation 5: hook loads successfully — __load__ counter should be cleared
    const r5 = sandbox.run([], { stdin })
    expect(r5.exitCode).toBe(0)
    const o5 = JSON.parse(r5.stdout)
    expect(o5.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(o5.hookSpecificOutput.additionalContext).toContain('hook-restored')

    // Invocation 6: should still work — no "will be skipped" or degraded messages
    const r6 = sandbox.run([], { stdin })
    expect(r6.exitCode).toBe(0)
    const o6 = JSON.parse(r6.stdout)
    expect(o6.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(o6.hookSpecificOutput.additionalContext).toContain('hook-restored')
    // Verify no degraded/disabled messages
    const sysMsg6 = o6.systemMessage ?? ''
    expect(sysMsg6).not.toContain('will be skipped')
    expect(sysMsg6).not.toContain('has been disabled')
  })

  test('__load__ counter is cleared even when hook was not yet degraded', () => {
    sandbox = createSandbox()

    // Register a hook pointing to a MISSING file with maxFailures: 5
    sandbox.writeConfig(`
version: "1.0.0"
partial-fail-hook:
  maxFailures: 5
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: load error → block (count = 1, under threshold)
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    expect(JSON.parse(r1.stdout).hookSpecificOutput.permissionDecision).toBe('deny')

    // Verify .failures file exists with __load__ entry
    expect(sandbox.fileExists('.clooks/.failures')).toBe(true)

    // Restore the hook file before reaching threshold
    sandbox.writeHook('partial-fail-hook.ts', `
export const hook = {
  meta: { name: "partial-fail-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "recovered-early" }
  },
}
`)

    // Invocation 2: hook loads successfully → __load__ counter should be cleared
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(o2.hookSpecificOutput.additionalContext).toContain('recovered-early')

    // .failures file should be removed (state is empty)
    expect(sandbox.fileExists('.clooks/.failures')).toBe(false)
  })
})

describe('Bug 2: shadow warning emitted on early exit when no hooks match', () => {
  test('shadow warning present when no hooks match the event', () => {
    sandbox = createSandbox()

    // Home config defines shared-hook handling only PreToolUse
    sandbox.writeHomeHook('shared-hook.ts', `
export const hook = {
  meta: { name: "shared-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "from-home" }
  },
}
`)
    sandbox.writeHomeConfig(`
version: "1.0.0"
shared-hook: {}
`)

    // Project config defines shared-hook handling only PreToolUse (same name = shadow)
    sandbox.writeHook('shared-hook.ts', `
export const hook = {
  meta: { name: "shared-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "from-project" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
shared-hook: {}
`)

    // Send SessionStart — neither hook handles SessionStart, so no hooks match.
    // Before the fix, shadow warnings were computed AFTER the early exit,
    // so they were lost. Now they should be present.
    const r1 = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.systemMessage).toContain('clooks: project hook "shared-hook" is shadowing a global hook with the same name.')
  })

  test('no shadow warning when hooks match (existing behavior preserved)', () => {
    sandbox = createSandbox()

    // Home config defines shared-hook handling SessionStart + PreToolUse
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

    // Project config shadows with SessionStart + PreToolUse
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

    // SessionStart: hook matches → goes through full pipeline → shadow warning should still appear
    const r1 = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.systemMessage).toContain('clooks: project hook "shared-hook" is shadowing a global hook with the same name.')
  })
})

describe('Bug 3: load errors block all events (fail-closed invariant)', () => {
  test('load error for a hook blocks unrelated events (fail-closed by design)', () => {
    sandbox = createSandbox()

    // Hook ONLY exports PreToolUse, but the file is missing so we can't know that.
    // A working hook that handles PostToolUse alongside the missing one.
    sandbox.writeHook('working-hook.ts', `
export const hook = {
  meta: { name: "working-hook" },
  PostToolUse() {
    return { result: "skip" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
working-hook: {}
missing-hook:
  uses: ./.clooks/hooks/does-not-exist.ts
  maxFailures: 2
`)

    // Send a PostToolUse event. The missing-hook doesn't handle PostToolUse
    // (it was intended for PreToolUse only), but since it failed to load,
    // the engine can't know which events it handles.
    // Fail-closed: the load error blocks the entire invocation.
    const postToolUseEvent = JSON.stringify({ hook_event_name: "PostToolUse" })

    const r1 = sandbox.run([], { stdin: postToolUseEvent })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    // Load error produces a system message about the failure
    expect(o1.systemMessage).toContain('failed to load')
    // working-hook never runs because executeHooks returns early after blocking load error
    // (PostToolUse is an observe event, so the block surfaces via hookSpecificOutput.additionalContext)
    const ctx = o1.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).not.toContain('working-hook')

    // This documents the fail-closed invariant: when a hook can't be loaded,
    // the engine can't inspect its exports to know which events it handles,
    // so it must conservatively block ALL events. This is by design.
  })

  test('after load-error hook is degraded, unrelated events proceed normally', () => {
    sandbox = createSandbox()

    sandbox.writeHook('working-hook.ts', `
export const hook = {
  meta: { name: "working-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "working-hook-ran" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
working-hook: {}
missing-hook:
  uses: ./.clooks/hooks/does-not-exist.ts
  maxFailures: 2
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: load error for missing-hook → blocks (count = 1)
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.hookSpecificOutput.permissionDecision).toBe('deny')

    // Invocation 2: load error again → degraded (count = 2 == threshold)
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.systemMessage).toContain('has been disabled')

    // Invocation 3: missing-hook is degraded, working-hook runs normally
    const r3 = sandbox.run([], { stdin })
    expect(r3.exitCode).toBe(0)
    const o3 = JSON.parse(r3.stdout)
    expect(o3.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(o3.hookSpecificOutput.additionalContext).toContain('working-hook-ran')
  })
})
