import { describe, expect, test } from 'bun:test'
import { validateConfig } from './validate.js'
import { DEFAULT_MAX_FAILURES, DEFAULT_MAX_FAILURES_MESSAGE } from './constants.js'
import { hn, ms } from '../test-utils.js'

describe('validateConfig', () => {
  test('valid minimal config', () => {
    const result = validateConfig({ version: '1.0.0' })
    expect(result.version).toBe('1.0.0')
    expect(result.global).toEqual({
      timeout: ms(30000),
      onError: 'block',
      maxFailures: DEFAULT_MAX_FAILURES,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
      handoff: false,
    })
    expect(result.hooks).toEqual({})
    expect(result.events).toEqual({})
  })

  test('valid full config', () => {
    const result = validateConfig({
      version: '1.0.0',
      config: { timeout: 15000, onError: 'continue' },
      'log-bash-commands': {
        config: { logDir: '.clooks/logs' },
        timeout: 5000,
        onError: 'continue',
        parallel: true,
      },
      'no-production-writes': {},
      'anthropic/secret-scanner': {
        config: { strict: true },
        timeout: 5000,
      },
      'company-policy': {
        uses: './scripts/hooks/company-policy.ts',
      },
      PreToolUse: {
        order: ['anthropic/secret-scanner', 'no-production-writes'],
      },
    })

    expect(result.version).toBe('1.0.0')
    expect(result.global).toEqual({
      timeout: ms(15000),
      onError: 'continue',
      maxFailures: DEFAULT_MAX_FAILURES,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
      handoff: false,
    })

    expect(Object.keys(result.hooks)).toEqual([
      'log-bash-commands',
      'no-production-writes',
      'anthropic/secret-scanner',
      'company-policy',
    ])
    expect(result.hooks[hn('log-bash-commands')]!.config).toEqual({
      logDir: '.clooks/logs',
    })
    expect(result.hooks[hn('log-bash-commands')]!.parallel).toBe(true)
    expect(result.hooks[hn('log-bash-commands')]!.timeout).toBe(ms(5000))
    expect(result.hooks[hn('no-production-writes')]!.resolvedPath).toBe(
      '.clooks/hooks/no-production-writes.ts',
    )
    expect(result.hooks[hn('anthropic/secret-scanner')]!.resolvedPath).toBe(
      '.clooks/vendor/anthropic/secret-scanner/index.ts',
    )
    expect(result.hooks[hn('company-policy')]!.resolvedPath).toBe(
      './scripts/hooks/company-policy.ts',
    )
    expect(result.hooks[hn('company-policy')]!.uses).toBe('./scripts/hooks/company-policy.ts')

    expect(Object.keys(result.events)).toEqual(['PreToolUse'])
    expect(result.events['PreToolUse']!.order).toEqual([
      hn('anthropic/secret-scanner'),
      hn('no-production-writes'),
    ])
  })

  test('missing version throws', () => {
    expect(() => validateConfig({ 'my-hook': {} })).toThrow('missing required "version"')
  })

  test('non-string version throws', () => {
    expect(() => validateConfig({ version: 1 })).toThrow('must be a string')
  })

  test('invalid global timeout throws', () => {
    expect(() => validateConfig({ version: '1.0.0', config: { timeout: -1 } })).toThrow(
      'must be a positive number',
    )
  })

  test('invalid global onError throws', () => {
    expect(() => validateConfig({ version: '1.0.0', config: { onError: 'ignore' } })).toThrow(
      'must be "block" or "continue"',
    )
  })

  test('invalid hook timeout throws', () => {
    expect(() => validateConfig({ version: '1.0.0', 'my-hook': { timeout: 'fast' } })).toThrow(
      'must be a positive number',
    )
  })

  test('invalid hook onError throws', () => {
    expect(() => validateConfig({ version: '1.0.0', 'my-hook': { onError: 42 } })).toThrow(
      'must be "block", "continue", or "trace"',
    )
  })

  test('hook entry with all valid fields', () => {
    const result = validateConfig({
      version: '1.0.0',
      'my-hook': {
        config: { key: 'val' },
        uses: './custom/path.ts',
        timeout: 5000,
        onError: 'continue',
        parallel: true,
      },
    })
    const hook = result.hooks[hn('my-hook')]!
    expect(hook.resolvedPath).toBe('./custom/path.ts')
    expect(hook.uses).toBe('./custom/path.ts')
    expect(hook.config).toEqual({ key: 'val' })
    expect(hook.timeout).toBe(ms(5000))
    expect(hook.onError).toBe('continue')
    expect(hook.parallel).toBe(true)
  })

  test('event entry recognized by name', () => {
    const result = validateConfig({
      version: '1.0.0',
      a: {},
      b: {},
      PreToolUse: { order: ['a', 'b'] },
    })
    expect(result.events['PreToolUse']).toEqual({
      order: [hn('a'), hn('b')],
    })
    expect(result.hooks[hn('PreToolUse')]).toBeUndefined()
  })

  test('event entry with invalid order throws', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        PreToolUse: { order: 'not-an-array' },
      }),
    ).toThrow('must be an array of non-empty strings')
  })

  test('empty hook entry is valid', () => {
    const result = validateConfig({ version: '1.0.0', 'my-hook': {} })
    const hook = result.hooks[hn('my-hook')]!
    expect(hook.config).toEqual({})
    expect(hook.resolvedPath).toBe('.clooks/hooks/my-hook.ts')
    expect(hook.timeout).toBeUndefined()
    expect(hook.onError).toBeUndefined()
    expect(hook.parallel).toBe(false)
  })

  test('hook path resolution for local hook', () => {
    const result = validateConfig({
      version: '1.0.0',
      'my-hook': {},
    })
    expect(result.hooks[hn('my-hook')]!.resolvedPath).toBe('.clooks/hooks/my-hook.ts')
  })

  test('reserved event name goes to events, not hooks', () => {
    const result = validateConfig({
      version: '1.0.0',
      a: {},
      SessionStart: { order: ['a'] },
    })
    expect(result.events['SessionStart']).toEqual({ order: [hn('a')] })
    expect(result.hooks[hn('SessionStart')]).toBeUndefined()

    // Even with valid event-entry keys, Stop is still an event
    const result2 = validateConfig({
      version: '1.0.0',
      'hook-a': {},
      Stop: { order: ['hook-a'] },
    })
    expect(result2.events['Stop']).toEqual({ order: [hn('hook-a')] })
    expect(result2.hooks[hn('Stop')]).toBeUndefined()
  })

  // --- maxFailures / maxFailuresMessage ---

  test('global maxFailures parsed correctly', () => {
    const result = validateConfig({
      version: '1.0.0',
      config: { maxFailures: 5 },
    })
    expect(result.global.maxFailures).toBe(5)
  })

  test('global maxFailuresMessage parsed correctly', () => {
    const result = validateConfig({
      version: '1.0.0',
      config: { maxFailuresMessage: 'custom message' },
    })
    expect(result.global.maxFailuresMessage).toBe('custom message')
  })

  test('global maxFailures defaults to 3 when not specified', () => {
    const result = validateConfig({ version: '1.0.0' })
    expect(result.global.maxFailures).toBe(3)
  })

  test('global maxFailuresMessage defaults to the default message when not specified', () => {
    const result = validateConfig({ version: '1.0.0' })
    expect(result.global.maxFailuresMessage).toBe(DEFAULT_MAX_FAILURES_MESSAGE)
  })

  test('global maxFailures rejects negative numbers', () => {
    expect(() => validateConfig({ version: '1.0.0', config: { maxFailures: -1 } })).toThrow(
      'must be a non-negative integer',
    )
  })

  test('global maxFailures rejects floats', () => {
    expect(() => validateConfig({ version: '1.0.0', config: { maxFailures: 2.5 } })).toThrow(
      'must be a non-negative integer',
    )
  })

  test('global maxFailures rejects non-numbers', () => {
    expect(() => validateConfig({ version: '1.0.0', config: { maxFailures: 'three' } })).toThrow(
      'must be a non-negative integer',
    )
  })

  test('global maxFailuresMessage rejects non-strings', () => {
    expect(() => validateConfig({ version: '1.0.0', config: { maxFailuresMessage: 42 } })).toThrow(
      'must be a string',
    )
  })

  test('hook-level maxFailures parsed correctly', () => {
    const result = validateConfig({
      version: '1.0.0',
      'my-hook': { maxFailures: 10 },
    })
    expect(result.hooks[hn('my-hook')]!.maxFailures).toBe(10)
  })

  test('hook-level maxFailuresMessage parsed correctly', () => {
    const result = validateConfig({
      version: '1.0.0',
      'my-hook': { maxFailuresMessage: 'hook message' },
    })
    expect(result.hooks[hn('my-hook')]!.maxFailuresMessage).toBe('hook message')
  })

  test('hook-level maxFailures: 0 accepted (disables circuit breaker)', () => {
    const result = validateConfig({
      version: '1.0.0',
      'my-hook': { maxFailures: 0 },
    })
    expect(result.hooks[hn('my-hook')]!.maxFailures).toBe(0)
  })

  // --- ErrorMode "trace", EventEntry rejections, hook events sub-map ---

  test('ErrorMode accepts "trace" at hook level', () => {
    const result = validateConfig({
      version: '1.0.0',
      scanner: { onError: 'trace' },
    })
    expect(result.hooks[hn('scanner')]!.onError).toBe('trace')
  })

  test('"trace" rejected at global level', () => {
    expect(() => validateConfig({ version: '1.0.0', config: { onError: 'trace' } })).toThrow(
      'cannot be "trace"',
    )
  })

  test('EventEntry.onError rejected with hard error', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        PreToolUse: { onError: 'block' },
      }),
    ).toThrow('event-level onError has been removed')
  })

  test('EventEntry.timeout rejected with hard error', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        PreToolUse: { timeout: 5000 },
      }),
    ).toThrow('event-level timeout has been removed')
  })

  test('hook events sub-map validates correctly', () => {
    const result = validateConfig({
      version: '1.0.0',
      scanner: {
        events: {
          PreToolUse: { onError: 'trace' },
        },
      },
    })
    expect(result.hooks[hn('scanner')]!.events).toEqual({
      PreToolUse: { onError: 'trace' },
    })
  })

  test('hook events sub-map rejects unknown event names', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        scanner: {
          events: {
            FakeEvent: { onError: 'block' },
          },
        },
      }),
    ).toThrow('unknown event "FakeEvent"')
  })

  test('hook events sub-map rejects "trace" for non-injectable events', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        scanner: {
          events: {
            SessionEnd: { onError: 'trace' },
          },
        },
      }),
    ).toThrow('does not support additionalContext')
  })

  // --- Config-time order validation ---

  test('order entry referencing unknown hook throws at validation time', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        'my-hook': {},
        PreToolUse: { order: ['my-hook', 'nonexistent'] },
      }),
    ).toThrow('event "PreToolUse" order references unknown hook "nonexistent"')
  })

  test('order entries that are valid hook names validates successfully', () => {
    const result = validateConfig({
      version: '1.0.0',
      'hook-a': {},
      'hook-b': { parallel: true },
      PreToolUse: { order: ['hook-a', 'hook-b'] },
    })
    expect(result.events['PreToolUse']!.order).toEqual([hn('hook-a'), hn('hook-b')])
  })

  test('hook events sub-map accepts "trace" for injectable events', () => {
    const result = validateConfig({
      version: '1.0.0',
      scanner: {
        events: {
          PreToolUse: { onError: 'trace' },
          PostToolUse: { onError: 'trace' },
        },
      },
    })
    expect(result.hooks[hn('scanner')]!.events!['PreToolUse']).toEqual({ onError: 'trace' })
    expect(result.hooks[hn('scanner')]!.events!['PostToolUse']).toEqual({ onError: 'trace' })
  })

  test('path field rejected as unknown key', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        'my-hook': { path: 'scripts/hook.ts' },
      }),
    ).toThrow('unknown key "path"')
  })

  test('uses field accepted (path-like)', () => {
    const result = validateConfig({
      version: '1.0.0',
      'my-hook': { uses: './lib/hook.ts' },
    })
    expect(result.hooks[hn('my-hook')]!.resolvedPath).toBe('./lib/hook.ts')
    expect(result.hooks[hn('my-hook')]!.uses).toBe('./lib/hook.ts')
  })

  test('uses field accepted (hook name)', () => {
    const result = validateConfig({
      version: '1.0.0',
      'my-alias': { uses: 'base-hook' },
    })
    expect(result.hooks[hn('my-alias')]!.resolvedPath).toBe('.clooks/hooks/base-hook.ts')
    expect(result.hooks[hn('my-alias')]!.uses).toBe('base-hook')
  })

  test('uses field empty string rejected', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        'my-hook': { uses: '' },
      }),
    ).toThrow('must be a non-empty string')
  })

  test('uses field non-string rejected', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        'my-hook': { uses: 42 },
      }),
    ).toThrow('must be a non-empty string')
  })

  // --- Chain detection ---

  test('valid alias (target not in YAML) validates successfully', () => {
    const result = validateConfig({
      version: '1.0.0',
      'verbose-logger': { uses: 'log-bash-commands' },
    })
    expect(result.hooks[hn('verbose-logger')]!.uses).toBe('log-bash-commands')
    expect(result.hooks[hn('verbose-logger')]!.resolvedPath).toBe(
      '.clooks/hooks/log-bash-commands.ts',
    )
  })

  test('valid alias (target in YAML, no uses) validates successfully', () => {
    const result = validateConfig({
      version: '1.0.0',
      'verbose-logger': { uses: 'log-bash-commands' },
      'log-bash-commands': {},
    })
    expect(result.hooks[hn('verbose-logger')]!.uses).toBe('log-bash-commands')
  })

  test('chain rejected — alias-a uses alias-b which has uses', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        'alias-a': { uses: 'alias-b' },
        'alias-b': { uses: 'real-hook' },
      }),
    ).toThrow('Alias chains are not allowed')
  })

  test('mutual chain rejected — hook-a uses hook-b which uses hook-a', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        'hook-a': { uses: 'hook-b' },
        'hook-b': { uses: 'hook-a' },
      }),
    ).toThrow('Alias chains are not allowed')
  })

  test('short address uses skipped in chain check', () => {
    const result = validateConfig({
      version: '1.0.0',
      'my-hook': { uses: 'owner/repo:my-hook' },
      'owner/repo:my-hook': { uses: 'owner/repo:my-hook' },
    })
    expect(result.hooks[hn('my-hook')]!.uses).toBe('owner/repo:my-hook')
  })

  test('alias pointing to short address is not flagged as chain', () => {
    const result = validateConfig({
      version: '1.0.0',
      alias: { uses: 'owner/repo:target' },
    })
    expect(result.hooks[hn('alias')]!.uses).toBe('owner/repo:target')
  })

  test('path-like uses skipped in chain check', () => {
    const result = validateConfig({
      version: '1.0.0',
      'alias-a': { uses: './lib/hook.ts' },
      'alias-b': { uses: './hooks/other.ts' },
    })
    expect(result.hooks[hn('alias-a')]!.uses).toBe('./lib/hook.ts')
    expect(result.hooks[hn('alias-b')]!.uses).toBe('./hooks/other.ts')
  })

  test('self-reference allowed', () => {
    const result = validateConfig({
      version: '1.0.0',
      'my-hook': { uses: 'my-hook' },
    })
    expect(result.hooks[hn('my-hook')]!.uses).toBe('my-hook')
  })

  // --- Bare-path detection ---

  test('bare path with .ts rejected', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        'my-hook': { uses: 'scripts/hook.ts' },
      }),
    ).toThrow('doesn\'t start with "./" or "../"')
  })

  test('bare path without .ts allowed (hook name)', () => {
    const result = validateConfig({
      version: '1.0.0',
      'my-hook': { uses: 'some-hook' },
    })
    expect(result.hooks[hn('my-hook')]!.uses).toBe('some-hook')
  })

  test('path-like with .ts allowed', () => {
    const result = validateConfig({
      version: '1.0.0',
      'my-hook': { uses: './scripts/hook.ts' },
    })
    expect(result.hooks[hn('my-hook')]!.uses).toBe('./scripts/hook.ts')
  })

  test('vendor-style path with .ts rejected as bare path', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        'my-hook': { uses: 'acme/hook.ts' },
      }),
    ).toThrow('doesn\'t start with "./" or "../"')
  })

  // --- Multiple aliases ---

  test('two aliases of same hook validate successfully', () => {
    const result = validateConfig({
      version: '1.0.0',
      verbose: { uses: 'log-bash' },
      quiet: { uses: 'log-bash' },
    })
    expect(result.hooks[hn('verbose')]!.resolvedPath).toBe('.clooks/hooks/log-bash.ts')
    expect(result.hooks[hn('quiet')]!.resolvedPath).toBe('.clooks/hooks/log-bash.ts')
  })

  test('two aliases with different configs carry their own overrides', () => {
    const result = validateConfig({
      version: '1.0.0',
      verbose: { uses: 'log-bash', config: { level: 'debug' } },
      quiet: { uses: 'log-bash', config: { level: 'error' } },
    })
    expect(result.hooks[hn('verbose')]!.config).toEqual({ level: 'debug' })
    expect(result.hooks[hn('quiet')]!.config).toEqual({ level: 'error' })
  })

  // --- Per-event hook disable (enabled field) ---

  test('hook-level enabled: false is accepted and stored on entry', () => {
    const result = validateConfig({
      version: '1.0.0',
      'my-hook': { enabled: false },
    })
    expect(result.hooks[hn('my-hook')]!.enabled).toBe(false)
  })

  test('hook-level enabled: true is accepted (no-op but valid)', () => {
    const result = validateConfig({
      version: '1.0.0',
      'my-hook': { enabled: true },
    })
    expect(result.hooks[hn('my-hook')]!.enabled).toBe(true)
  })

  test('hook-level enabled: "yes" is rejected (type error)', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        'my-hook': { enabled: 'yes' },
      }),
    ).toThrow('invalid "enabled": must be a boolean')
  })

  test('per-event enabled: false is accepted and stored on override entry', () => {
    const result = validateConfig({
      version: '1.0.0',
      scanner: {
        events: {
          PreToolUse: { enabled: false },
        },
      },
    })
    expect(result.hooks[hn('scanner')]!.events!['PreToolUse']).toEqual({ enabled: false })
  })

  test('per-event enabled: true is accepted and stored on override entry', () => {
    const result = validateConfig({
      version: '1.0.0',
      scanner: {
        events: {
          PreToolUse: { enabled: true },
        },
      },
    })
    expect(result.hooks[hn('scanner')]!.events!['PreToolUse']).toEqual({ enabled: true })
  })

  test('per-event enabled: 42 is rejected (type error)', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        scanner: {
          events: {
            PreToolUse: { enabled: 42 },
          },
        },
      }),
    ).toThrow('"enabled" must be a boolean')
  })

  test('config with disabled hook in order list validates successfully', () => {
    const result = validateConfig({
      version: '1.0.0',
      'hook-a': { enabled: false },
      'hook-b': {},
      PreToolUse: { order: ['hook-a', 'hook-b'] },
    })
    expect(result.hooks[hn('hook-a')]!.enabled).toBe(false)
    expect(result.events['PreToolUse']!.order).toEqual([hn('hook-a'), hn('hook-b')])
  })

  // --- handoff ---

  test('global handoff defaults to false', () => {
    expect(validateConfig({ version: '1.0.0' }).global.handoff).toBe(false)
  })

  test('global handoff accepts true, false, and a positive integer', () => {
    expect(validateConfig({ version: '1.0.0', config: { handoff: true } }).global.handoff).toBe(
      true,
    )
    expect(validateConfig({ version: '1.0.0', config: { handoff: false } }).global.handoff).toBe(
      false,
    )
    expect(validateConfig({ version: '1.0.0', config: { handoff: 2000 } }).global.handoff).toBe(
      2000,
    )
  })

  test('hook-level handoff accepts true, false, and a positive integer', () => {
    expect(
      validateConfig({ version: '1.0.0', 'my-hook': { handoff: true } }).hooks[hn('my-hook')]!
        .handoff,
    ).toBe(true)
    expect(
      validateConfig({ version: '1.0.0', 'my-hook': { handoff: false } }).hooks[hn('my-hook')]!
        .handoff,
    ).toBe(false)
    expect(
      validateConfig({ version: '1.0.0', 'my-hook': { handoff: 500 } }).hooks[hn('my-hook')]!
        .handoff,
    ).toBe(500)
  })

  test('hook-level handoff is absent when not configured', () => {
    expect(
      validateConfig({ version: '1.0.0', 'my-hook': {} }).hooks[hn('my-hook')]!.handoff,
    ).toBeUndefined()
  })

  test('event-level handoff accepted on eligible events', () => {
    const result = validateConfig({
      version: '1.0.0',
      scanner: {
        events: {
          PreToolUse: { handoff: true },
          Stop: { handoff: 1000 },
          TaskCompleted: { handoff: false },
        },
      },
    })
    const events = result.hooks[hn('scanner')]!.events!
    expect(events['PreToolUse']).toEqual({ handoff: true })
    expect(events['Stop']).toEqual({ handoff: 1000 })
    expect(events['TaskCompleted']).toEqual({ handoff: false })
  })

  test('event-level handoff: false visible under hook-level handoff: true', () => {
    const result = validateConfig({
      version: '1.0.0',
      config: { handoff: 100 },
      scanner: {
        handoff: true,
        events: { PreToolUse: { handoff: false } },
      },
    })
    expect(result.global.handoff).toBe(100)
    const hook = result.hooks[hn('scanner')]!
    expect(hook.handoff).toBe(true)
    expect(hook.events!['PreToolUse']).toEqual({ handoff: false })
  })

  test('global handoff rejects zero, negatives, floats, and strings', () => {
    for (const bad of [0, -1, 2.5, 'yes']) {
      expect(() => validateConfig({ version: '1.0.0', config: { handoff: bad } })).toThrow(
        'global config "handoff" must be true, false, or a positive integer character threshold',
      )
    }
  })

  test('hook-level handoff rejects zero, negatives, floats, and strings', () => {
    for (const bad of [0, -1, 2.5, 'yes']) {
      expect(() => validateConfig({ version: '1.0.0', 'my-hook': { handoff: bad } })).toThrow(
        'invalid "handoff": must be true, false, or a positive integer character threshold',
      )
    }
  })

  test('event-level handoff rejects zero, negatives, floats, and strings', () => {
    for (const bad of [0, -1, 2.5, 'yes']) {
      expect(() =>
        validateConfig({
          version: '1.0.0',
          scanner: { events: { PreToolUse: { handoff: bad } } },
        }),
      ).toThrow(
        'events.PreToolUse "handoff" must be true, false, or a positive integer character threshold',
      )
    }
  })

  test('event-level handoff rejected on an ineligible event', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        scanner: { events: { SessionEnd: { handoff: true } } },
      }),
    ).toThrow('events.SessionEnd handoff cannot be enabled')

    expect(() =>
      validateConfig({
        version: '1.0.0',
        scanner: { events: { SessionEnd: { handoff: 100 } } },
      }),
    ).toThrow('events.SessionEnd handoff cannot be enabled')
  })

  test('event-level handoff: false accepted on an ineligible event', () => {
    const result = validateConfig({
      version: '1.0.0',
      scanner: { events: { SessionEnd: { handoff: false } } },
    })
    expect(result.hooks[hn('scanner')]!.events!['SessionEnd']).toEqual({ handoff: false })
  })

  // --- Unknown-key rejection ---

  test('global config rejects unknown keys', () => {
    expect(() => validateConfig({ version: '1.0.0', config: { tiemout: 5000 } })).toThrow(
      'unknown key "tiemout"',
    )
  })

  test('event entry rejects unknown keys', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        PreToolUse: { priority: 'high' },
      }),
    ).toThrow('unknown key "priority"')
  })

  test('hook entry rejects unknown keys', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        'my-hook': { tiemout: 5000 },
      }),
    ).toThrow('unknown key "tiemout"')
  })

  test('hook events sub-map entry rejects unknown keys', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        scanner: {
          events: {
            PreToolUse: { onError: 'block', timeout: 5000 },
          },
        },
      }),
    ).toThrow('unknown key "timeout"')
  })

  test('unknown-key messages list handoff as a known key', () => {
    expect(() => validateConfig({ version: '1.0.0', config: { handof: true } })).toThrow(
      'Known keys: agents, handoff, maxFailures',
    )
    expect(() => validateConfig({ version: '1.0.0', 'my-hook': { handof: true } })).toThrow(
      'Known keys: agents, config, enabled, events, handoff, maxFailures',
    )
    expect(() =>
      validateConfig({
        version: '1.0.0',
        scanner: { events: { PreToolUse: { handof: true } } },
      }),
    ).toThrow('Known keys: agents, enabled, handoff, onError')
  })

  test('hook entry rejects misspelled onError', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        'my-hook': { onEror: 'continue' },
      }),
    ).toThrow('unknown key "onEror"')
  })

  test('hook entry with only unknown keys rejects the first one', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        'my-hook': { completely: 'wrong', also: 'bad' },
      }),
    ).toThrow('unknown key')
  })

  test('event entry with hook-like key rejects it as unknown', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        Stop: { config: { key: 'val' } },
      }),
    ).toThrow('unknown key "config"')
  })

  test('event order rejects duplicate hook names', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        'hook-a': {},
        PreToolUse: { order: ['hook-a', 'hook-a'] },
      }),
    ).toThrow('duplicate hook name "hook-a"')
  })

  // --- M0: Additional validation coverage ---

  test('non-object hook entry throws', () => {
    expect(() => validateConfig({ version: '1.0.0', 'my-hook': 'just-a-string' })).toThrow(
      'entry "my-hook" must be an object',
    )
  })

  test('non-object event entry throws', () => {
    expect(() => validateConfig({ version: '1.0.0', PreToolUse: 'not-an-object' })).toThrow(
      'entry "PreToolUse" must be an object',
    )
  })

  test('non-object config field throws', () => {
    expect(() => validateConfig({ version: '1.0.0', config: 'string' })).toThrow(
      '"config" must be an object',
    )
  })

  test('non-object hook events sub-map throws', () => {
    expect(() => validateConfig({ version: '1.0.0', scanner: { events: 'string' } })).toThrow(
      'has invalid "events"',
    )
  })

  test('non-object event override in events sub-map throws', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        scanner: { events: { PreToolUse: 'not-object' } },
      }),
    ).toThrow('expected object')
  })

  test('event order with empty string throws', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        a: {},
        PreToolUse: { order: ['a', ''] },
      }),
    ).toThrow('non-empty strings')
  })

  test('event order with non-string element throws', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        a: {},
        PreToolUse: { order: ['a', 42] },
      }),
    ).toThrow('non-empty strings')
  })

  test('global timeout zero throws', () => {
    expect(() => validateConfig({ version: '1.0.0', config: { timeout: 0 } })).toThrow(
      'must be a positive number',
    )
  })

  test('global timeout non-number throws', () => {
    expect(() => validateConfig({ version: '1.0.0', config: { timeout: 'fast' } })).toThrow(
      'must be a positive number',
    )
  })

  test('hook parallel non-boolean throws', () => {
    expect(() => validateConfig({ version: '1.0.0', 'my-hook': { parallel: 'yes' } })).toThrow(
      'parallel',
    )
  })

  test('hook maxFailures negative throws', () => {
    expect(() => validateConfig({ version: '1.0.0', 'my-hook': { maxFailures: -1 } })).toThrow(
      'non-negative integer',
    )
  })

  test('hook maxFailuresMessage non-string throws', () => {
    expect(() =>
      validateConfig({ version: '1.0.0', 'my-hook': { maxFailuresMessage: 42 } }),
    ).toThrow('must be a string')
  })

  test('hook config non-object throws', () => {
    expect(() => validateConfig({ version: '1.0.0', 'my-hook': { config: 'not-object' } })).toThrow(
      'has invalid "config"',
    )
  })

  test('hook per-event onError invalid throws', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        scanner: {
          events: {
            PreToolUse: { onError: 42 },
          },
        },
      }),
    ).toThrow('"onError" must be "block", "continue", or "trace"')
  })

  test('TaskCompleted and TeammateIdle recognized as events', () => {
    const result = validateConfig({
      version: '1.0.0',
      'hook-a': {},
      TaskCompleted: { order: ['hook-a'] },
      TeammateIdle: { order: ['hook-a'] },
    })
    expect(result.events['TaskCompleted']).toBeDefined()
    expect(result.events['TeammateIdle']).toBeDefined()
    expect(result.hooks['TaskCompleted' as any]).toBeUndefined()
    expect(result.hooks['TeammateIdle' as any]).toBeUndefined()
  })

  test('TaskCreated recognized as an event', () => {
    const result = validateConfig({
      version: '1.0.0',
      'hook-a': {},
      TaskCreated: { order: ['hook-a'] },
    })
    expect(result.events['TaskCreated']).toBeDefined()
    expect(result.hooks['TaskCreated' as any]).toBeUndefined()
  })

  test('PostCompact recognized as an event', () => {
    const result = validateConfig({
      version: '1.0.0',
      'hook-a': {},
      PostCompact: { order: ['hook-a'] },
    })
    expect(result.events['PostCompact']).toBeDefined()
    expect(result.hooks['PostCompact' as any]).toBeUndefined()
  })
})

describe('validateConfig agents', () => {
  test('accepted at global, hook, and per-event positions', () => {
    const result = validateConfig({
      version: '1.0.0',
      config: { agents: ['claude-code'] },
      scanner: {
        agents: ['codex'],
        events: { PreToolUse: { agents: ['claude-code', 'codex'] } },
      },
    })

    expect(result.global.agents).toEqual(['claude-code'])
    expect(result.hooks[hn('scanner')]!.agents).toEqual(['codex'])
    expect(result.hooks[hn('scanner')]!.events!.PreToolUse!.agents).toEqual([
      'claude-code',
      'codex',
    ])
  })

  test('omitted agents stays undefined at every position', () => {
    const result = validateConfig({
      version: '1.0.0',
      scanner: { events: { PreToolUse: { enabled: false } } },
    })

    expect(result.global.agents).toBeUndefined()
    expect(result.hooks[hn('scanner')]!.agents).toBeUndefined()
    expect(result.hooks[hn('scanner')]!.events!.PreToolUse!.agents).toBeUndefined()
  })

  test('unknown agent ids are preserved verbatim', () => {
    const result = validateConfig({
      version: '1.0.0',
      config: { agents: ['cursor'] },
      scanner: {
        agents: ['windsurf', 'codex'],
        events: { PreToolUse: { agents: ['some-future-agent'] } },
      },
    })

    expect(result.global.agents).toEqual(['cursor'])
    expect(result.hooks[hn('scanner')]!.agents).toEqual(['windsurf', 'codex'])
    expect(result.hooks[hn('scanner')]!.events!.PreToolUse!.agents).toEqual(['some-future-agent'])
  })

  const invalid: [label: string, value: unknown][] = [
    ['empty array', []],
    ['non-array string', 'claude-code'],
    ['non-array object', { 'claude-code': true }],
    ['non-string element', ['claude-code', 7]],
    ['empty-string element', ['']],
  ]

  for (const [label, value] of invalid) {
    test(`global config rejects ${label}`, () => {
      expect(() => validateConfig({ version: '1.0.0', config: { agents: value } })).toThrow(
        'clooks: global config "agents" must be a non-empty array of agent id strings',
      )
    })

    test(`hook entry rejects ${label}`, () => {
      expect(() => validateConfig({ version: '1.0.0', scanner: { agents: value } })).toThrow(
        'clooks: hook "scanner" has invalid "agents": must be a non-empty array of agent id strings',
      )
    })

    test(`per-event override rejects ${label}`, () => {
      expect(() =>
        validateConfig({
          version: '1.0.0',
          scanner: { events: { PreToolUse: { agents: value } } },
        }),
      ).toThrow(
        'clooks: hook "scanner" events.PreToolUse "agents" must be a non-empty array of agent id strings',
      )
    })
  }

  test('top-level event entry rejects agents as an unknown key', () => {
    expect(() =>
      validateConfig({
        version: '1.0.0',
        PreToolUse: { agents: ['claude-code'] },
      }),
    ).toThrow('event "PreToolUse" has unknown key "agents". Known keys: order')
  })
})
