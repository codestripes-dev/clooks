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
        return event.block({ reason: 'gated' })
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

  test('afterHook is observer-only — return value cannot override handler', async () => {
    let afterHookRan = false

    const hook = makeLoadedHook('observe-hook', {
      PreToolUse() {
        return { result: 'block', reason: 'original' }
      },
      afterHook(event: any) {
        afterHookRan = true
        return event.passthrough({ debugMessage: 'observed' })
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'observe-hook': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    // Handler's block result flows through unchanged regardless of afterHook
    expect(afterHookRan).toBe(true)
    expect(lastResult?.result).toBe('block')
    expect(lastResult?.reason).toContain('original')
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
    const config = makeTestConfig({ 'slow-hook': {} })
    config.global.timeout = ms(50)

    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

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

    expect(handlerRan).toBe(true)
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

  test('no lifecycle methods — handler runs unchanged', async () => {
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

  test('parallel lifecycle — each hook is an atomic unit', async () => {
    let hookBHandlerRan = false

    const hookA = makeLoadedHook('block-hook', {
      beforeHook(event: any) {
        return event.block({ reason: 'blocked' })
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

    expect(lastResult?.result).toBe('block')
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
        return event.block({ reason: 'debug-blocked' })
      },
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'debug-gate': {} })

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

  test('beforeHook void return — handler runs, result flows through', async () => {
    let handlerRan = false

    const hook = makeLoadedHook('noop-before', {
      beforeHook() {
        // void return — alias for passthrough with no breadcrumb
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

  test('beforeHook returns event.passthrough() — handler runs, result flows through', async () => {
    const hook = makeLoadedHook('passthrough-before', {
      beforeHook(event: any) {
        return event.passthrough({ debugMessage: 'gate passed' })
      },
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'passthrough-before': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(lastResult?.result).toBe('allow')
  })

  test('afterHook void return — handler result flows through unchanged', async () => {
    const hook = makeLoadedHook('noop-after', {
      PreToolUse() {
        return { result: 'allow' }
      },
      afterHook() {
        // void return
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

  test('sequential pipeline: first hook beforeHook blocks, second hook still runs (collect-all)', async () => {
    let secondHandlerRan = false

    const hookA = makeLoadedHook('blocker', {
      beforeHook(event: any) {
        return event.block({ reason: 'first blocks' })
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
    expect(secondHandlerRan).toBe(true)
  })

  test('beforeHook receives event with type, meta, and lifecycle methods', async () => {
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
    expect(typeof receivedEvent.block).toBe('function')
    expect(typeof receivedEvent.skip).toBe('function')
    expect(typeof receivedEvent.passthrough).toBe('function')
    expect(receivedEvent.respond).toBeUndefined()
  })

  test('afterHook receives event with handlerResult and only passthrough', async () => {
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
    expect(typeof receivedEvent.passthrough).toBe('function')
    // afterHook is observer-only — no decision verbs, no respond
    expect(receivedEvent.block).toBeUndefined()
    expect(receivedEvent.skip).toBeUndefined()
    expect(receivedEvent.respond).toBeUndefined()
  })

  test('beforeHook skip — handler and afterHook do not run; skip vote returned', async () => {
    let handlerRan = false
    let afterHookRan = false

    const hook = makeLoadedHook('skip-hook', {
      beforeHook(event: any) {
        return event.skip()
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
    expect(lastResult?.result).toBe('skip')
  })

  test('beforeHook skip — pipeline continues to next hook', async () => {
    const hookA = makeLoadedHook('skipper', {
      beforeHook(event: any) {
        return event.skip()
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

    expect(lastResult?.result).toBe('allow')
  })

  test('beforeHook defined, afterHook not — handler result used (void beforeHook)', async () => {
    const hook = makeLoadedHook('before-only', {
      beforeHook() {
        // void = passthrough
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

  test('both lifecycle methods defined, both void — handler result passes through', async () => {
    const hook = makeLoadedHook('noop-lifecycle', {
      beforeHook() {
        /* void */
      },
      PreToolUse() {
        return { result: 'allow', injectContext: 'from handler' }
      },
      afterHook() {
        /* void */
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

    expect(hookBInputToolName).toBe('echo updated')
  })

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

    expect(perCall).toBeLessThan(5)
  })

  test('beforeHook passthrough does not surface as final pipeline result', async () => {
    const hook = makeLoadedHook('passthrough-not-leaking', {
      beforeHook(event: any) {
        return event.passthrough({ debugMessage: 'gate passed' })
      },
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'passthrough-not-leaking': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(lastResult?.result).toBe('allow')
    expect(lastResult?.result).not.toBe('passthrough')
  })

  test('afterHook passthrough does not surface as final pipeline result', async () => {
    const hook = makeLoadedHook('after-passthrough-not-leaking', {
      PreToolUse() {
        return { result: 'allow' }
      },
      afterHook(event: any) {
        return event.passthrough({ debugMessage: 'observed' })
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'after-passthrough-not-leaking': {} })
    const { lastResult } = await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
      config,
      fp(dir),
    )

    expect(lastResult?.result).toBe('allow')
    expect(lastResult?.result).not.toBe('passthrough')
  })

  test('beforeHook returning unrecognized result discriminant warns and is treated as no-op', async () => {
    const hook = makeLoadedHook('bogus-before', {
      beforeHook() {
        return { result: 'allow' } as any
      },
      PreToolUse() {
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'bogus-before': {} })
    const stderrChunks: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: any) => {
      stderrChunks.push(String(chunk))
      return true
    }) as any
    try {
      const { lastResult } = await executeHooks(
        [hook],
        'PreToolUse',
        { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
        config,
        fp(dir),
      )
      // Handler still ran; the bogus return was treated as a no-op.
      expect(lastResult?.result).toBe('allow')
    } finally {
      process.stderr.write = origWrite
    }
    const all = stderrChunks.join('')
    expect(all).toContain('bogus-before')
    expect(all).toContain('beforeHook')
    expect(all).toContain('result=allow')
  })

  test('afterHook returning unrecognized result discriminant warns', async () => {
    const hook = makeLoadedHook('bogus-after', {
      PreToolUse() {
        return { result: 'allow' }
      },
      afterHook() {
        return { result: 'block', reason: 'cast through any' } as any
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'bogus-after': {} })
    const stderrChunks: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: any) => {
      stderrChunks.push(String(chunk))
      return true
    }) as any
    try {
      const { lastResult } = await executeHooks(
        [hook],
        'PreToolUse',
        { event: 'PreToolUse', toolName: 'Bash', toolInput: {} },
        config,
        fp(dir),
      )
      // afterHook can never override — handler's allow flows through.
      expect(lastResult?.result).toBe('allow')
    } finally {
      process.stderr.write = origWrite
    }
    const all = stderrChunks.join('')
    expect(all).toContain('bogus-after')
    expect(all).toContain('afterHook')
    expect(all).toContain('result=block')
  })
})
