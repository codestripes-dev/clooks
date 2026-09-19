// Unit tests for the `createHarnessContext` wrapper used by `clooks test`.
//
// Verifies that the harness-flavored defaults match the documented contract
// (sessionId, cwd, transcriptPath, parallel, signal) and that decision
// methods are still attached.
//
// `createContext`'s own defaults are explicitly NOT exercised here — they
// belong to `src/engine/context-methods.test.ts` and `src/types/claude-code.test.ts`.

import { describe, test, expect } from 'bun:test'
import { createContext, createHarnessContext } from './create-context.js'
import type { AgentId } from '../types/index.js'

for (const [name, create] of Object.entries({ createContext, createHarnessContext })) {
  describe(`${name} agent identity`, () => {
    test('defaults omitted and undefined agent to Claude regardless of environment', () => {
      const previous = process.env.CLOOKS_AGENT
      try {
        process.env.CLOOKS_AGENT = 'codex'
        expect(create('UserPromptSubmit', { prompt: 'hi' }).agent).toBe('claude-code')
        expect(create('UserPromptSubmit', { prompt: 'hi', agent: undefined }).agent).toBe(
          'claude-code',
        )
      } finally {
        if (previous === undefined) delete process.env.CLOOKS_AGENT
        else process.env.CLOOKS_AGENT = previous
      }
    })

    test.each(['claude-code', 'codex'] as AgentId[])('preserves explicit %s', (agent) => {
      const ctx = create('UserPromptSubmit', { prompt: 'hi', agent })
      expect(ctx.agent).toBe(agent)
      expect(ctx.skip()).toEqual({ result: 'skip' })
    })

    for (const invalid of [null, '', 'unknown', 0, false, {}, []]) {
      test(`rejects explicit ${JSON.stringify(invalid)}`, () => {
        expect(() =>
          create('UserPromptSubmit', { prompt: 'hi', agent: invalid as AgentId }),
        ).toThrow('agent must be "claude-code" or "codex"')
      })
    }
  })
}

describe('createHarnessContext — base defaults', () => {
  test('helpers default to an immutable no-I/O false implementation', () => {
    const previous = process.env.HOME
    try {
      process.env.HOME = '/definitely/not/a/testing/home'
      const ctx = createHarnessContext('UserPromptSubmit', { prompt: 'hi' })
      expect(ctx.helpers.belongsToPlugin('/anything')).toBe(false)
      expect(Object.isFrozen(ctx.helpers)).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
    }
  })

  test('applies the harness-spec sessionId default', () => {
    const ctx = createHarnessContext('UserPromptSubmit', { prompt: 'hi' })
    expect(ctx.sessionId).toBe('test-session-0000000000000000')
  })

  test('cwd default is process.cwd()', () => {
    const ctx = createHarnessContext('UserPromptSubmit', { prompt: 'hi' })
    expect(ctx.cwd).toBe(process.cwd())
  })

  test('transcriptPath default is /tmp/clooks-test-transcript.jsonl', () => {
    const ctx = createHarnessContext('UserPromptSubmit', { prompt: 'hi' })
    expect(ctx.transcriptPath).toBe('/tmp/clooks-test-transcript.jsonl')
  })

  test('parallel default is false', () => {
    const ctx = createHarnessContext('UserPromptSubmit', { prompt: 'hi' })
    expect(ctx.parallel).toBe(false)
  })

  test('signal is a real, never-aborted AbortSignal', () => {
    const ctx = createHarnessContext('UserPromptSubmit', { prompt: 'hi' })
    expect(ctx.signal).toBeInstanceOf(AbortSignal)
    expect(ctx.signal.aborted).toBe(false)
  })

  test('event field is pinned to the requested literal', () => {
    const ctx = createHarnessContext('UserPromptSubmit', { prompt: 'hi' })
    expect(ctx.event).toBe('UserPromptSubmit')
  })
})

describe('createHarnessContext — payload override surface', () => {
  test('accepts and freezes an explicit testing helper', () => {
    const helper = {
      seen: [] as string[],
      belongsToPlugin(path: string) {
        this.seen.push(path)
        return path === '/plugin/file.ts'
      },
    }
    const ctx = createHarnessContext('UserPromptSubmit', {
      prompt: 'hi',
      helpers: helper,
    })
    expect(ctx.helpers.belongsToPlugin('/plugin/file.ts')).toBe(true)
    expect(ctx.helpers.belongsToPlugin('/project/file.ts')).toBe(false)
    expect(helper.seen).toEqual(['/plugin/file.ts', '/project/file.ts'])
    expect(Object.isFrozen(ctx.helpers)).toBe(true)
  })

  test("caller's sessionId override beats the harness default", () => {
    const ctx = createHarnessContext('UserPromptSubmit', {
      prompt: 'hi',
      sessionId: 'custom-session-id',
    })
    expect(ctx.sessionId).toBe('custom-session-id')
  })

  test("caller's cwd override beats process.cwd()", () => {
    const ctx = createHarnessContext('UserPromptSubmit', {
      prompt: 'hi',
      cwd: '/some/explicit/path',
    })
    expect(ctx.cwd).toBe('/some/explicit/path')
  })

  test('caller can override parallel', () => {
    const ctx = createHarnessContext('UserPromptSubmit', {
      prompt: 'hi',
      parallel: true,
    })
    expect(ctx.parallel).toBe(true)
  })
})

describe('createHarnessContext — decision methods attached', () => {
  test('PreToolUse exposes allow / ask / block / defer / skip', () => {
    const ctx = createHarnessContext('PreToolUse', {
      toolName: 'Bash',
      toolInput: { command: 'echo' },
      originalToolInput: { command: 'echo' },
      toolUseId: 'tu_0001',
    })
    // Cast through unknown so the DU-narrowed type doesn't reject the runtime probe.
    const methods = ctx as unknown as Record<string, unknown>
    expect(typeof methods.allow).toBe('function')
    expect(typeof methods.ask).toBe('function')
    expect(typeof methods.block).toBe('function')
    expect(typeof methods.defer).toBe('function')
    expect(typeof methods.skip).toBe('function')
  })

  test('UserPromptSubmit exposes allow / block / skip', () => {
    const ctx = createHarnessContext('UserPromptSubmit', { prompt: 'hi' })
    const methods = ctx as unknown as Record<string, unknown>
    expect(typeof methods.allow).toBe('function')
    expect(typeof methods.block).toBe('function')
    expect(typeof methods.skip).toBe('function')
  })

  test('decision methods return the documented result shape', () => {
    const ctx = createHarnessContext('UserPromptSubmit', { prompt: 'hi' })
    expect(ctx.allow()).toEqual({ result: 'allow' })
    expect(ctx.skip()).toEqual({ result: 'skip' })
    expect(ctx.block({ reason: 'no' })).toEqual({ result: 'block', reason: 'no' })
  })

  test('WorktreeCreate exposes success / failure', () => {
    const ctx = createHarnessContext('WorktreeCreate', { name: 'feature-branch' })
    const methods = ctx as unknown as Record<string, unknown>
    expect(typeof methods.success).toBe('function')
    expect(typeof methods.failure).toBe('function')
  })
})
