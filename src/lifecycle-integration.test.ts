import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { executeHooks } from './engine/index.js'
import type { LoadedHook } from './loader.js'
import type { ClooksHook } from './types/hook.js'
import type { ClooksConfig, HookEntry } from './config/schema.js'
import type { HookName } from './types/branded.js'
import { hn, ms } from './test-utils.js'
import { DEFAULT_MAX_FAILURES_MESSAGE } from './config/constants.js'

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- test helper, any callable shape is fine
function makeLoadedHook(name: string, handlers: Record<string, Function>): LoadedHook {
  const hookName = hn(name)
  const hook = {
    meta: { name: hookName },
    ...handlers,
  } as unknown as ClooksHook
  return {
    name: hookName,
    hook,
    config: {},
    hookPath: `/test/hooks/${name}.ts`,
    configPath: '/test/.clooks/clooks.yml',
  }
}

function makeTestConfig(
  hookOverrides: Record<
    string,
    {
      parallel?: boolean
      maxFailures?: number
      onError?: import('./config/schema.js').ErrorMode
    }
  > = {},
  globalMaxFailures = 3,
  globalOnError: import('./config/schema.js').ErrorMode = 'block',
): ClooksConfig {
  const hooks = {} as Record<HookName, HookEntry>
  for (const [name, overrides] of Object.entries(hookOverrides)) {
    hooks[hn(name)] = {
      resolvedPath: `.clooks/hooks/${name}.ts`,
      config: {},
      parallel: false,
      origin: 'project',
      ...overrides,
    }
  }
  return {
    version: '1.0.0',
    global: {
      timeout: ms(5000),
      onError: globalOnError,
      maxFailures: globalMaxFailures,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
    },
    hooks,
    events: {},
  }
}

let tempDir: string

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-lifecycle-int-'))
  mkdirSync(join(tempDir, '.clooks'), { recursive: true })
  return tempDir
}

function fp(dir: string): string {
  return join(dir, '.clooks/.failures')
}

describe('lifecycle integration', () => {
  test('beforeHook blocks — handler and afterHook do not run', async () => {
    let handlerRan = false
    let afterHookRan = false

    const hook = makeLoadedHook('gate-hook', {
      beforeHook(event: any) {
        event.respond({ result: 'block', reason: 'gated' })
      },
      PreToolUse() {
        handlerRan = true
        return { result: 'allow' }
      },
      afterHook() {
        afterHookRan = true
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'gate-hook': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(lastResult?.result).toBe('block')
    expect(lastResult?.reason).toContain('gated')
    expect(handlerRan).toBe(false)
    expect(afterHookRan).toBe(false)
  })

  test('afterHook overrides result', async () => {
    const hook = makeLoadedHook('override-hook', {
      PreToolUse() {
        return { result: 'block', reason: 'original' }
      },
      afterHook(event: any) {
        if (event.type === 'PreToolUse') {
          event.respond({ result: 'allow' })
        }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'override-hook': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(lastResult?.result).toBe('allow')
  })

  test('lifecycle timeout shared across phases', async () => {
    const hook = makeLoadedHook('slow-hook', {
      async beforeHook() {
        await new Promise((r) => setTimeout(r, 60))
      },
      PreToolUse() {
        return { result: 'allow' }
      },
      async afterHook() {
        await new Promise((r) => setTimeout(r, 60))
      },
    })

    const dir = makeTempDir()
    // Use a config with hook-level timeout of 50ms
    const config = makeTestConfig({ 'slow-hook': {} })
    // Override global timeout to 50ms — beforeHook alone (60ms) exceeds budget
    config.global.timeout = ms(50)

    // The beforeHook (60ms) alone exceeds the 50ms timeout, making this deterministic
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    // Should block due to timeout error (onError: "block")
    expect(lastResult?.result).toBe('block')
    expect(lastResult?.reason).toContain('timed out')
  })

  test('afterHook throws — handler result is lost, error handled by onError', async () => {
    let handlerRan = false

    const hook = makeLoadedHook('after-throw-hook', {
      PreToolUse() {
        handlerRan = true
        return { result: 'allow' }
      },
      afterHook() {
        throw new Error('afterHook exploded')
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'after-throw-hook': {} })
    const failurePath = fp(dir)
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      failurePath,
    )

    // Handler ran but its result was lost due to afterHook throw
    expect(handlerRan).toBe(true)
    // onError: "block" → block result with error message
    expect(lastResult?.result).toBe('block')
    expect(lastResult?.reason).toContain('afterHook exploded')
  })

  test('handler throws — afterHook does not run', async () => {
    let afterHookRan = false

    const hook = makeLoadedHook('throw-hook', {
      PreToolUse() {
        throw new Error('handler boom')
      },
      afterHook() {
        afterHookRan = true
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'throw-hook': {} }, 3, 'continue')
    await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(afterHookRan).toBe(false)
  })

  test('no lifecycle methods — same behavior as before', async () => {
    const hook = makeLoadedHook('plain-hook', {
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'plain-hook': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(lastResult?.result).toBe('allow')
  })

  test('respond() called twice throws — handled by onError', async () => {
    const hook = makeLoadedHook('double-respond', {
      beforeHook(event: any) {
        event.respond({ result: 'block', reason: 'first' })
        event.respond({ result: 'block', reason: 'second' })
      },
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'double-respond': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    // Double respond throws, caught by onError: "block" -> block result
    expect(lastResult?.result).toBe('block')
    expect(lastResult?.reason).toContain('can only be called once')
  })

  test('parallel lifecycle — each hook is an atomic unit', async () => {
    let hookBHandlerRan = false

    const hookA = makeLoadedHook('block-hook', {
      beforeHook(event: any) {
        event.respond({ result: 'block', reason: 'blocked' })
      },
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const hookB = makeLoadedHook('pass-hook', {
      PreToolUse() {
        hookBHandlerRan = true
        return { result: 'skip' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({
      'block-hook': { parallel: true },
      'pass-hook': { parallel: true },
    })

    const { lastResult } = await executeHooks(
      [hookA, hookB],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    // hookA's beforeHook blocks, and the pipeline should end up with a block
    expect(lastResult?.result).toBe('block')
    // hookB's handler should have run (parallel hooks run independently)
    expect(hookBHandlerRan).toBe(true)
  })

  test('circuit breaker shared with lifecycle failures', async () => {
    const hook = makeLoadedHook('crashy-hook', {
      beforeHook() {
        throw new Error('beforeHook crash')
      },
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'crashy-hook': {} }, 3)

    // Run 3 times to hit the threshold
    // First 2 should block (under threshold)
    for (let i = 0; i < 2; i++) {
      const { lastResult } = await executeHooks(
        [hook],
        'PreToolUse',
        { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
        config,
        fp(dir),
      )
      expect(lastResult?.result).toBe('block')
      expect(lastResult?.reason).toContain('beforeHook crash')
    }

    // Third invocation — at threshold, should degrade (no block, degraded message)
    const { lastResult, degradedMessages } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )
    expect(lastResult).toBeUndefined()
    expect(degradedMessages.length).toBeGreaterThan(0)
  })

  test('beforeHook blocks with debug logging', async () => {
    const hook = makeLoadedHook('debug-gate', {
      beforeHook(event: any) {
        event.respond({ result: 'block', reason: 'debug-blocked' })
      },
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'debug-gate': {} })

    // Enable debug mode
    const origDebug = process.env.CLOOKS_DEBUG
    process.env.CLOOKS_DEBUG = 'true'
    try {
      const { debugMessages } = await executeHooks(
        [hook],
        'PreToolUse',
        { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
        config,
        fp(dir),
      )
      expect(debugMessages.some((m) => m.includes('beforeHook: blocked'))).toBe(true)
    } finally {
      if (origDebug === undefined) {
        delete process.env.CLOOKS_DEBUG
      } else {
        process.env.CLOOKS_DEBUG = origDebug
      }
    }
  })

  test('afterHook override with debug logging', async () => {
    const hook = makeLoadedHook('debug-override', {
      PreToolUse() {
        return { result: 'block', reason: 'original' }
      },
      afterHook(event: any) {
        event.respond({ result: 'allow' })
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'debug-override': {} })

    const origDebug = process.env.CLOOKS_DEBUG
    process.env.CLOOKS_DEBUG = 'true'
    try {
      const { debugMessages } = await executeHooks(
        [hook],
        'PreToolUse',
        { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
        config,
        fp(dir),
      )
      expect(debugMessages.some((m) => m.includes('afterHook: overridden result'))).toBe(true)
    } finally {
      if (origDebug === undefined) {
        delete process.env.CLOOKS_DEBUG
      } else {
        process.env.CLOOKS_DEBUG = origDebug
      }
    }
  })

  test('beforeHook does not block when respond() is not called', async () => {
    let handlerRan = false

    const hook = makeLoadedHook('noop-before', {
      beforeHook() {
        // Does nothing — does not call respond()
      },
      PreToolUse() {
        handlerRan = true
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'noop-before': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(lastResult?.result).toBe('allow')
    expect(handlerRan).toBe(true)
  })

  test('afterHook does not override when respond() is not called', async () => {
    const hook = makeLoadedHook('noop-after', {
      PreToolUse() {
        return { result: 'allow' }
      },
      afterHook() {
        // Does nothing — does not call respond()
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'noop-after': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(lastResult?.result).toBe('allow')
  })

  test('sequential pipeline: first hook beforeHook blocks, second hook does not run', async () => {
    let secondHandlerRan = false

    const hookA = makeLoadedHook('blocker', {
      beforeHook(event: any) {
        event.respond({ result: 'block', reason: 'first blocks' })
      },
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const hookB = makeLoadedHook('follower', {
      PreToolUse() {
        secondHandlerRan = true
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ blocker: {}, follower: {} })
    const { lastResult } = await executeHooks(
      [hookA, hookB],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(lastResult?.result).toBe('block')
    expect(lastResult?.reason).toContain('first blocks')
    // Second hook should NOT run because pipeline was blocked
    expect(secondHandlerRan).toBe(false)
  })

  test('beforeHook receives correct event context', async () => {
    let receivedEvent: any = null

    const hook = makeLoadedHook('inspect-before', {
      beforeHook(event: any) {
        receivedEvent = event
      },
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'inspect-before': {} })
    await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: { command: 'ls' } },
      config,
      fp(dir),
    )

    expect(receivedEvent).not.toBeNull()
    expect(receivedEvent.type).toBe('PreToolUse')
    expect(receivedEvent.meta).toBeDefined()
    expect(receivedEvent.meta.hookName).toBe('inspect-before')
    expect(typeof receivedEvent.respond).toBe('function')
  })

  test('afterHook receives handler result', async () => {
    let receivedEvent: any = null

    const hook = makeLoadedHook('inspect-after', {
      PreToolUse() {
        return { result: 'allow' }
      },
      afterHook(event: any) {
        receivedEvent = event
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'inspect-after': {} })
    await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(receivedEvent).not.toBeNull()
    expect(receivedEvent.type).toBe('PreToolUse')
    expect(receivedEvent.handlerResult).toEqual({ result: 'allow' })
    expect(receivedEvent.meta).toBeDefined()
    expect(typeof receivedEvent.respond).toBe('function')
  })

  test('beforeHook skip — handler and afterHook do not run, hook is invisible', async () => {
    let handlerRan = false
    let afterHookRan = false

    const hook = makeLoadedHook('skip-hook', {
      beforeHook(event: any) {
        event.respond({ result: 'skip' })
      },
      PreToolUse() {
        handlerRan = true
        return { result: 'allow' }
      },
      afterHook() {
        afterHookRan = true
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'skip-hook': {} })
    const failurePath = fp(dir)
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      failurePath,
    )

    expect(handlerRan).toBe(false)
    expect(afterHookRan).toBe(false)
    // skip = hook is invisible, no result
    expect(lastResult).toBeUndefined()
  })

  test('beforeHook skip — pipeline continues to next hook', async () => {
    const hookA = makeLoadedHook('skipper', {
      beforeHook(event: any) {
        event.respond({ result: 'skip' })
      },
      PreToolUse() {
        return { result: 'block', reason: 'should not reach' }
      },
    })

    const hookB = makeLoadedHook('runner', {
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ skipper: {}, runner: {} })
    const failurePath = fp(dir)
    const { lastResult } = await executeHooks(
      [hookA, hookB],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      failurePath,
    )

    // hookA skipped, hookB ran and returned allow
    expect(lastResult?.result).toBe('allow')
  })

  // --- Edge-case tests (M4 Step 2) ---

  test('respond(undefined) in afterHook is rejected with error', async () => {
    const hook = makeLoadedHook('undefined-respond', {
      PreToolUse() {
        return { result: 'allow' }
      },
      afterHook(event: any) {
        // respond(undefined) should throw — it is rejected by createRespondCallback
        event.respond(undefined as any)
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'undefined-respond': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    // Should error (onError: block)
    expect(lastResult?.result).toBe('block')
    expect(lastResult?.reason).toContain('non-null result')
  })

  test('beforeHook defined, afterHook not — handler result used', async () => {
    const hook = makeLoadedHook('before-only', {
      beforeHook() {
        // No-op — does not call respond
      },
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'before-only': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(lastResult?.result).toBe('allow')
  })

  test('afterHook defined, beforeHook not — can override result', async () => {
    const hook = makeLoadedHook('after-only', {
      PreToolUse() {
        return { result: 'block', reason: 'original' }
      },
      afterHook(event: any) {
        if (event.type === 'PreToolUse') {
          event.respond({ result: 'allow' })
        }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'after-only': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(lastResult?.result).toBe('allow')
  })

  test('both lifecycle methods defined, neither calls respond — handler result passes through', async () => {
    const hook = makeLoadedHook('noop-lifecycle', {
      beforeHook() {
        /* no-op */
      },
      PreToolUse() {
        return { result: 'allow', injectContext: 'from handler' }
      },
      afterHook() {
        /* no-op */
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'noop-lifecycle': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(lastResult?.result).toBe('allow')
    expect(lastResult?.injectContext).toContain('from handler')
  })

  test('lifecycle on observe event — afterHook override skip with injectContext is preserved', async () => {
    let afterHookCalled = false

    const hook = makeLoadedHook('observe-lifecycle', {
      SessionStart() {
        return { result: 'skip' }
      },
      afterHook(event: any) {
        afterHookCalled = true
        if (event.type === 'SessionStart') {
          // Override with skip+injectContext — the engine now collects
          // injectContext from skip results so it reaches the final output.
          event.respond({ result: 'skip', injectContext: 'added by afterHook' })
        }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'observe-lifecycle': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'SessionStart',
      { event: 'SessionStart', source: 'startup' },
      config,
      fp(dir),
    )

    // afterHook ran and its injectContext on skip is now collected
    expect(afterHookCalled).toBe(true)
    expect(lastResult).toBeDefined()
    expect(lastResult!.result).toBe('allow')
    expect(lastResult!.injectContext).toBe('added by afterHook')
  })

  test('sequential pipeline: hook A returns updatedInput, hook B beforeHook sees updated context', async () => {
    let hookBInputToolName: string | undefined

    const hookA = makeLoadedHook('updater', {
      PreToolUse() {
        return { result: 'allow', updatedInput: { command: 'echo updated' } }
      },
    })

    const hookB = makeLoadedHook('inspector', {
      beforeHook(event: any) {
        if (event.type === 'PreToolUse') {
          hookBInputToolName = (event.input as any).toolInput?.command
        }
      },
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ updater: {}, inspector: {} })
    await executeHooks(
      [hookA, hookB],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: { command: 'echo original' } },
      config,
      fp(dir),
    )

    // hookB's beforeHook should see the updated toolInput from hookA
    expect(hookBInputToolName).toBe('echo updated')
  })

  // --- Performance regression test (M4 Step 3) ---

  test('hooks without lifecycle methods have negligible overhead', async () => {
    const hook = makeLoadedHook('plain-perf', {
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'plain-perf': {} })

    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      await executeHooks(
        [hook],
        'PreToolUse',
        { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
        config,
        fp(dir),
      )
    }
    const elapsed = performance.now() - start
    const perCall = elapsed / 100

    // Should be well under 5ms per call on any reasonable machine
    expect(perCall).toBeLessThan(5)
  })
})
