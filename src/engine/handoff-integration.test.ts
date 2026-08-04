import { describe, expect, it, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { executeHooks } from './execute.js'
import { translateResult } from './translate.js'
import type { LoadedHook } from '../loader.js'
import type { ClooksHook } from '../types/hook.js'
import type { ClooksConfig, HookEntry } from '../config/schema.js'
import type { HandoffSetting } from '../config/constants.js'
import type { EventName, HookName } from '../types/branded.js'
import { hn, ms } from '../test-utils.js'
import { DEFAULT_MAX_FAILURES_MESSAGE } from '../config/constants.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clooks-handoff-int-'))
  mkdirSync(join(dir, '.clooks'), { recursive: true })
  tempDirs.push(dir)
  return dir
}

function fp(dir: string): string {
  return join(dir, '.clooks/.failures')
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- test helper, any callable shape is fine
function makeLoadedHook(name: string, handlers: Record<string, Function>): LoadedHook {
  const hookName = hn(name)
  return {
    name: hookName,
    hook: { meta: { name: hookName }, ...handlers } as unknown as ClooksHook,
    config: {},
    hookPath: `/test/hooks/${name}.ts`,
    configPath: '/test/.clooks/clooks.yml',
  }
}

function makeConfig(
  hookSpecs: Record<
    string,
    {
      parallel?: boolean
      handoff?: HandoffSetting
      events?: Partial<Record<EventName, HandoffSetting>>
    }
  >,
  globalHandoff: HandoffSetting = false,
): ClooksConfig {
  const hooks = {} as Record<HookName, HookEntry>
  for (const [name, spec] of Object.entries(hookSpecs)) {
    const entry: HookEntry = {
      resolvedPath: `.clooks/hooks/${name}.ts`,
      config: {},
      parallel: spec.parallel ?? false,
      origin: 'project',
    }
    if (spec.handoff !== undefined) entry.handoff = spec.handoff
    if (spec.events) {
      entry.events = {}
      for (const [event, handoff] of Object.entries(spec.events)) {
        entry.events[event as EventName] = { handoff: handoff as HandoffSetting }
      }
    }
    hooks[hn(name)] = entry
  }
  return {
    version: '1.0.0',
    global: {
      timeout: ms(5000),
      onError: 'block',
      maxFailures: 3,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
      handoff: globalHandoff,
    },
    hooks,
    events: {},
  }
}

async function handoffFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(join(root, '.clooks/tmp'))
    return entries.filter((e) => e.startsWith('handoff-')).sort()
  } catch {
    return []
  }
}

async function readPointedFile(root: string, pointer: string): Promise<string> {
  const match = pointer.match(/: read (\S+\.md) and follow/)
  expect(match).not.toBeNull()
  return readFile(match![1]!, 'utf8')
}

const LONG = 'follow these instructions carefully. '.repeat(100)

describe('handoff through executeHooks', () => {
  it('sequential group: block reason is handed off before reduction', async () => {
    const root = makeTempRoot()
    const hook = makeLoadedHook('guard', {
      PostToolUse: () => ({ result: 'block', reason: LONG }),
    })
    const config = makeConfig({ guard: { handoff: true } })

    const { lastResult } = await executeHooks([hook], 'PostToolUse', {}, config, fp(root), root)
    expect(lastResult!.reason).toContain('[clooks] Hook "guard": read ')
    expect(await readPointedFile(root, lastResult!.reason!)).toBe(LONG)
  })

  it('parallel group: injectContext is handed off per hook', async () => {
    const root = makeTempRoot()
    const hookA = makeLoadedHook('a', {
      SessionStart: () => ({ result: 'allow', injectContext: LONG }),
    })
    const hookB = makeLoadedHook('b', {
      SessionStart: () => ({ result: 'allow', injectContext: 'short' }),
    })
    const config = makeConfig(
      { a: { parallel: true, handoff: true }, b: { parallel: true, handoff: false } },
      false,
    )

    const { lastResult } = await executeHooks(
      [hookA, hookB],
      'SessionStart',
      {},
      config,
      fp(root),
      root,
    )

    const lines = lastResult!.injectContext!.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('[clooks] Hook "a": read ')
    expect(lines[1]).toBe('short')
    expect(await handoffFiles(root)).toHaveLength(1)
  })

  it('mixed policies on one event preserve execution order through reduction', async () => {
    const root = makeTempRoot()
    const hookA = makeLoadedHook('first', {
      SessionStart: () => ({ result: 'allow', injectContext: 'inline-first' }),
    })
    const hookB = makeLoadedHook('second', {
      SessionStart: () => ({ result: 'allow', injectContext: LONG }),
    })
    const hookC = makeLoadedHook('third', {
      SessionStart: () => ({ result: 'allow', injectContext: 'inline-third' }),
    })
    const config = makeConfig({ first: {}, second: { handoff: 100 }, third: {} })

    const { lastResult } = await executeHooks(
      [hookA, hookB, hookC],
      'SessionStart',
      {},
      config,
      fp(root),
      root,
    )

    const lines = lastResult!.injectContext!.split('\n')
    expect(lines[0]).toBe('inline-first')
    expect(lines[1]).toContain('[clooks] Hook "second": read ')
    expect(lines[2]).toBe('inline-third')
  })

  it('PreToolUse: deny winner reason and allow loser context both hand off', async () => {
    const root = makeTempRoot()
    const allowHook = makeLoadedHook('advisor', {
      PreToolUse: () => ({ result: 'allow', injectContext: LONG }),
    })
    const denyHook = makeLoadedHook('blocker', {
      PreToolUse: () => ({ result: 'block', reason: LONG + 'deny' }),
    })
    const config = makeConfig({ advisor: { handoff: true }, blocker: { handoff: true } })

    const { lastResult } = await executeHooks(
      [allowHook, denyHook],
      'PreToolUse',
      {},
      config,
      fp(root),
      root,
    )

    expect(lastResult!.result).toBe('block')
    expect(lastResult!.reason).toContain('[clooks] Hook "blocker": read ')
    expect(lastResult!.injectContext).toContain('[clooks] Hook "advisor": read ')
    expect(await readPointedFile(root, lastResult!.reason!)).toBe(LONG + 'deny')
    expect(await readPointedFile(root, lastResult!.injectContext!)).toBe(LONG)
  })

  it('PreToolUse: global handoff applies to every hook by default', async () => {
    const root = makeTempRoot()
    const hook = makeLoadedHook('guard', {
      PreToolUse: () => ({ result: 'block', reason: LONG }),
    })
    const config = makeConfig({ guard: {} }, 200)

    const { lastResult } = await executeHooks([hook], 'PreToolUse', {}, config, fp(root), root)
    expect(lastResult!.reason).toContain('and follow its instructions.')
  })

  it('event-level false wins over global true', async () => {
    const root = makeTempRoot()
    const hook = makeLoadedHook('guard', {
      PreToolUse: () => ({ result: 'block', reason: LONG }),
    })
    const config = makeConfig({ guard: { events: { PreToolUse: false } } }, true)

    const { lastResult } = await executeHooks([hook], 'PreToolUse', {}, config, fp(root), root)
    expect(lastResult!.reason).toBe(LONG)
    expect(await handoffFiles(root)).toHaveLength(0)
  })

  it('Stop and SubagentStop block reasons hand off', async () => {
    for (const event of ['Stop', 'SubagentStop'] as EventName[]) {
      const root = makeTempRoot()
      const hook = makeLoadedHook('keeper', {
        [event]: () => ({ result: 'block', reason: LONG }),
      })
      const config = makeConfig({ keeper: { handoff: true } })

      const { lastResult } = await executeHooks([hook], event, {}, config, fp(root), root)
      expect(lastResult!.reason).toContain('[clooks] Hook "keeper": read ')
      expect(await readPointedFile(root, lastResult!.reason!)).toBe(LONG)
    }
  })

  it('engine-generated crash block reasons are never handed off', async () => {
    const root = makeTempRoot()
    const hook = makeLoadedHook('crasher', {
      PostToolUse: () => {
        throw new Error('x'.repeat(500))
      },
    })
    const config = makeConfig({ crasher: { handoff: true } })

    const { lastResult } = await executeHooks([hook], 'PostToolUse', {}, config, fp(root), root)
    expect(lastResult!.result).toBe('block')
    expect(lastResult!.reason).toContain('Action blocked')
    expect(lastResult!.reason).not.toContain('and follow its instructions.')
    expect(await handoffFiles(root)).toHaveLength(0)
  })

  it('debug output carries the pointer and never the original payload', async () => {
    const root = makeTempRoot()
    const hook = makeLoadedHook('verbose', {
      PostToolUse: () => ({ result: 'block', reason: LONG, injectContext: LONG }),
    })
    const config = makeConfig({ verbose: { handoff: true } })

    const previous = process.env.CLOOKS_DEBUG
    process.env.CLOOKS_DEBUG = 'true'
    let debugMessages: string[]
    try {
      ;({ debugMessages } = await executeHooks([hook], 'PostToolUse', {}, config, fp(root), root))
    } finally {
      if (previous === undefined) delete process.env.CLOOKS_DEBUG
      else process.env.CLOOKS_DEBUG = previous
    }

    const joined = debugMessages.join('\n')
    expect(joined).toContain('[clooks] Hook \\"verbose\\": read ')
    expect(joined).not.toContain(LONG)
    expect(joined).not.toContain('follow these instructions carefully. follow')
  })

  it('continuation feedback reaches the model as a pointer over stderr', async () => {
    const root = makeTempRoot()
    const hook = makeLoadedHook('nudge', {
      TeammateIdle: () => ({ result: 'continue', feedback: LONG }),
    })
    const config = makeConfig({ nudge: { handoff: true } })

    const { lastResult } = await executeHooks([hook], 'TeammateIdle', {}, config, fp(root), root)
    const translated = translateResult('TeammateIdle', lastResult!)

    expect(translated.exitCode).toBe(2)
    expect(translated.stderr).toContain('[clooks] Hook "nudge": read ')
    expect(await readPointedFile(root, translated.stderr!)).toBe(LONG)
  })

  it('continuation write failure delivers the original feedback plus a warning', async () => {
    const root = makeTempRoot()
    writeFileSync(join(root, '.clooks/tmp'), 'not a directory')

    const hook = makeLoadedHook('nudge', {
      TeammateIdle: () => ({ result: 'continue', feedback: LONG }),
    })
    const config = makeConfig({ nudge: { handoff: true } })

    const warnings: string[] = []
    const spy = spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      warnings.push(String(chunk))
      return true
    })
    let translated
    try {
      const { lastResult } = await executeHooks([hook], 'TeammateIdle', {}, config, fp(root), root)
      translated = translateResult('TeammateIdle', lastResult!)
    } finally {
      spy.mockRestore()
    }

    expect(warnings.join('')).toContain('clooks: warning: handoff write failed for hook "nudge"')
    expect(translated.exitCode).toBe(2)
    expect(translated.stderr).toBe(LONG)
  })
})
