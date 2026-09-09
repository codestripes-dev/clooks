import { describe, expect, it, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'fs'
import { chmod, lstat, readdir, stat, utimes, readFile } from 'fs/promises'
import * as fsPromises from 'node:fs/promises'
import { createHash } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  resolveHandoff,
  shouldHandoff,
  writeHandoffFile,
  buildPointer,
  applyHandoff,
  pruneHandoffFiles,
  HANDOFF_MAX_FILES,
  HANDOFF_TTL_MS,
} from './handoff.js'
import type { ClooksConfig, HookEntry } from '../config/schema.js'
import type { HandoffSetting } from '../config/constants.js'
import type { EngineResult } from './types.js'
import type { EventName, HookName } from '../types/branded.js'
import { hn, ms } from '../test-utils.js'
import { DEFAULT_MAX_FAILURES_MESSAGE } from '../config/constants.js'

const tempDirs: string[] = []

describe('handoff I/O recovery', () => {
  it('reuses matching content even when closing its descriptor reports an error', async () => {
    const root = makeTempRoot()
    const target = await writeHandoffFile(root, hn('close'), 'instructions')
    const originalOpen = fsPromises.open
    let closes = 0
    const openSpy = spyOn(fsPromises, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args)
      const close = handle.close.bind(handle)
      handle.close = async () => {
        closes++
        await close()
        throw new Error('close reported failure')
      }
      return handle
    })
    try {
      expect(await writeHandoffFile(root, hn('close'), 'instructions')).toBe(target)
      expect(closes).toBe(1)
      expect(readFileSync(target, 'utf8')).toBe('instructions')
      expect(await listHandoffFiles(root)).toHaveLength(1)
    } finally {
      openSpy.mockRestore()
    }
  })

  it('does not delete either foreign staging file when both exclusive creates collide', async () => {
    const root = makeTempRoot()
    const originalWrite = fsPromises.writeFile
    const collisions: string[] = []
    const writeSpy = spyOn(fsPromises, 'writeFile').mockImplementation(
      async (path, data, options) => {
        if (String(path).endsWith('.tmp')) {
          collisions.push(String(path))
          await originalWrite(path, 'foreign writer', { flag: 'wx' })
        }
        return originalWrite(path, data, options)
      },
    )
    try {
      await expect(writeHandoffFile(root, hn('collision'), 'instructions')).rejects.toMatchObject({
        code: 'EEXIST',
      })
      expect(collisions).toHaveLength(2)
      expect(new Set(collisions).size).toBe(2)
      for (const path of collisions) expect(readFileSync(path, 'utf8')).toBe('foreign writer')
      expect(await listHandoffFiles(root)).toEqual([])
    } finally {
      writeSpy.mockRestore()
    }
  })

  it('keeps instructions inline when partial staging write and its cleanup both fail', async () => {
    const root = makeTempRoot()
    const originalWrite = fsPromises.writeFile
    let staged: string | undefined
    const writeSpy = spyOn(fsPromises, 'writeFile').mockImplementation(
      async (path, data, options) => {
        if (String(path).endsWith('.tmp')) {
          staged = String(path)
          await originalWrite(path, 'partial', options)
          throw new Error('staging write failed')
        }
        return originalWrite(path, data, options)
      },
    )
    const unlinkSpy = spyOn(fsPromises, 'unlink').mockRejectedValue(new Error('cleanup failed'))
    const original: EngineResult = { result: 'block', reason: 'Keep these instructions inline' }
    try {
      const warnings = await captureStderr(async () => {
        expect(
          await applyHandoff(
            original,
            hn('partial'),
            'PreToolUse' as EventName,
            makeConfig({ global: true }),
            root,
          ),
        ).toEqual(original)
      })
      expect(staged).toBeDefined()
      expect(unlinkSpy).toHaveBeenCalledWith(staged!)
      expect(readFileSync(staged!, 'utf8')).toBe('partial')
      expect(await listHandoffFiles(root)).toEqual([])
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('staging write failed')
      expect(warnings[0]).toContain('delivering inline')
    } finally {
      unlinkSpy.mockRestore()
      writeSpy.mockRestore()
    }
  })

  it('preserves a target directory when publish and staging cleanup fail', async () => {
    const root = makeTempRoot()
    const target = await writeHandoffFile(root, hn('publish'), 'instructions')
    rmSync(target)
    mkdirSync(target)
    writeFileSync(join(target, 'sentinel'), 'existing contents')
    const unlinkSpy = spyOn(fsPromises, 'unlink').mockRejectedValue(new Error('cleanup failed'))
    try {
      await expect(writeHandoffFile(root, hn('publish'), 'instructions')).rejects.toBeDefined()
      expect(unlinkSpy).toHaveBeenCalledTimes(1)
      const staged = String(unlinkSpy.mock.calls[0]![0])
      expect(staged).toMatch(/\.handoff-.*\.tmp$/)
      expect(readFileSync(staged, 'utf8')).toBe('instructions')
      expect(readFileSync(join(target, 'sentinel'), 'utf8')).toBe('existing contents')
    } finally {
      unlinkSpy.mockRestore()
    }
  })
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clooks-handoff-'))
  tempDirs.push(dir)
  return dir
}

function makeConfig(
  layers: {
    global?: HandoffSetting
    hooks?: Record<
      string,
      { handoff?: HandoffSetting; events?: Partial<Record<EventName, HandoffSetting>> }
    >
  } = {},
): ClooksConfig {
  const hooks = {} as Record<HookName, HookEntry>
  for (const [name, spec] of Object.entries(layers.hooks ?? {})) {
    const entry: HookEntry = {
      resolvedPath: `.clooks/hooks/${name}.ts`,
      config: {},
      parallel: false,
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
      timeout: ms(30000),
      onError: 'block',
      maxFailures: 3,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
      handoff: layers.global ?? false,
    },
    hooks,
    events: {},
  }
}

/** Runs `fn` with process.stderr.write captured, returning the written chunks. */
async function captureStderr(fn: () => Promise<unknown>): Promise<string[]> {
  const written: string[] = []
  const spy = spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk))
    return true
  })
  try {
    await fn()
  } finally {
    spy.mockRestore()
  }
  return written
}

async function listHandoffFiles(root: string): Promise<string[]> {
  const entries = await readdir(join(root, '.clooks/tmp'))
  return entries.filter((e) => e.startsWith('handoff-')).sort()
}

// --- resolveHandoff ---

describe('resolveHandoff', () => {
  it('falls back to global when no hook or event override exists', () => {
    const config = makeConfig({ global: 500, hooks: { a: {} } })
    expect(resolveHandoff(hn('a'), 'PreToolUse', config)).toBe(500)
  })

  it('hook level overrides global', () => {
    const config = makeConfig({ global: 500, hooks: { a: { handoff: true } } })
    expect(resolveHandoff(hn('a'), 'PreToolUse', config)).toBe(true)
  })

  it('event level overrides hook level', () => {
    const config = makeConfig({
      global: false,
      hooks: { a: { handoff: true, events: { PreToolUse: 100 } } },
    })
    expect(resolveHandoff(hn('a'), 'PreToolUse', config)).toBe(100)
  })

  it('event-level false overrides hook-level true', () => {
    const config = makeConfig({
      global: true,
      hooks: { a: { handoff: true, events: { PreToolUse: false } } },
    })
    expect(resolveHandoff(hn('a'), 'PreToolUse', config)).toBe(false)
  })

  it('hook-level false overrides global true', () => {
    const config = makeConfig({ global: true, hooks: { a: { handoff: false } } })
    expect(resolveHandoff(hn('a'), 'PreToolUse', config)).toBe(false)
  })

  it('event override on a different event does not leak', () => {
    const config = makeConfig({
      global: false,
      hooks: { a: { events: { SessionStart: true } } },
    })
    expect(resolveHandoff(hn('a'), 'PreToolUse', config)).toBe(false)
    expect(resolveHandoff(hn('a'), 'SessionStart', config)).toBe(true)
  })

  it('unknown hook falls back to global', () => {
    const config = makeConfig({ global: true })
    expect(resolveHandoff(hn('ghost'), 'PreToolUse', config)).toBe(true)
  })
})

// --- shouldHandoff ---

describe('shouldHandoff', () => {
  it('false never hands off', () => {
    expect(shouldHandoff(false, 'x'.repeat(10_000))).toBe(false)
  })

  it('true hands off any non-empty text', () => {
    expect(shouldHandoff(true, 'x')).toBe(true)
    expect(shouldHandoff(true, '')).toBe(false)
  })

  it('threshold boundary: length N stays inline, N+1 hands off', () => {
    expect(shouldHandoff(100, 'x'.repeat(100))).toBe(false)
    expect(shouldHandoff(100, 'x'.repeat(101))).toBe(true)
  })
})

// --- buildPointer ---

describe('buildPointer', () => {
  it('produces the exact pointer sentence', () => {
    expect(buildPointer(hn('style-guide'), '/abs/path/handoff-style-guide-3fa9c2e81b04.md')).toBe(
      '[clooks] Hook "style-guide": read /abs/path/handoff-style-guide-3fa9c2e81b04.md and follow its instructions.',
    )
  })
})

// --- writeHandoffFile ---

describe('writeHandoffFile', () => {
  it('writes a content-addressed file and returns its absolute path', async () => {
    const root = makeTempRoot()
    const text = 'long instructions'
    const path = await writeHandoffFile(root, hn('my-hook'), text)

    const digest = createHash('sha256').update(text).digest('hex').slice(0, 12)
    expect(path).toBe(join(root, '.clooks/tmp', `handoff-my-hook-${digest}.md`))
    expect(await readFile(path, 'utf8')).toBe(text)
  })

  it('creates a self-ignoring tmp directory', async () => {
    const root = makeTempRoot()
    await writeHandoffFile(root, hn('h'), 'text')
    expect(await readFile(join(root, '.clooks/tmp/.gitignore'), 'utf8')).toBe('*\n')
  })

  it('sanitizes a hostile hook name so it cannot escape the directory', async () => {
    const root = makeTempRoot()
    const path = await writeHandoffFile(root, '../../evil' as HookName, 'text')
    expect(path.startsWith(join(root, '.clooks/tmp') + '/')).toBe(true)
    expect(path).toContain('handoff-evil-')
    expect(path).not.toContain('..')
  })

  it('falls back to "hook" when the sanitized name is empty', async () => {
    const path = await writeHandoffFile(makeTempRoot(), '../..' as HookName, 'text')
    expect(path).toContain('handoff-hook-')
  })

  it('truncates a very long hook name to 40 characters', async () => {
    const path = await writeHandoffFile(makeTempRoot(), hn('a'.repeat(80)), 'text')
    expect(path).toContain(`handoff-${'a'.repeat(40)}-`)
  })

  it('dedups identical text onto one file and refreshes its mtime', async () => {
    const root = makeTempRoot()
    const text = 'the same instructions'
    const first = await writeHandoffFile(root, hn('h'), text)

    const stale = new Date(Date.now() - 60 * 60 * 1000)
    await utimes(first, stale, stale)

    const second = await writeHandoffFile(root, hn('h'), text)
    expect(second).toBe(first)
    expect(await listHandoffFiles(root)).toHaveLength(1)
    expect((await stat(first)).mtimeMs).toBeGreaterThan(stale.getTime())
  })

  it('keeps mode 0600 on the reuse path', async () => {
    const root = makeTempRoot()
    const text = 'reused instructions'
    const first = await writeHandoffFile(root, hn('h'), text)
    await chmod(first, 0o644)

    const second = await writeHandoffFile(root, hn('h'), text)
    expect(second).toBe(first)
    expect((await stat(first)).mode & 0o777).toBe(0o600)
  })

  it('replaces a symlink at the target path even when it points at matching content', async () => {
    const root = makeTempRoot()
    const outside = makeTempRoot()
    const text = 'identical content'
    const decoy = join(outside, 'decoy.md')
    writeFileSync(decoy, text)

    const digest = createHash('sha256').update(text).digest('hex').slice(0, 12)
    const target = join(root, '.clooks/tmp', `handoff-h-${digest}.md`)
    mkdirSync(join(root, '.clooks/tmp'), { recursive: true })
    symlinkSync(decoy, target)

    const path = await writeHandoffFile(root, hn('h'), text)
    expect(path).toBe(target)

    const st = await lstat(target)
    expect(st.isSymbolicLink()).toBe(false)
    expect(st.isFile()).toBe(true)
    expect(await readFile(target, 'utf8')).toBe(text)
  })

  it('atomically replaces a pre-existing file whose content differs', async () => {
    const root = makeTempRoot()
    const text = 'authoritative content'
    const digest = createHash('sha256').update(text).digest('hex').slice(0, 12)
    const target = join(root, '.clooks/tmp', `handoff-h-${digest}.md`)
    mkdirSync(join(root, '.clooks/tmp'), { recursive: true })
    writeFileSync(target, 'stale partial write')

    const path = await writeHandoffFile(root, hn('h'), text)
    expect(path).toBe(target)
    expect(await readFile(target, 'utf8')).toBe(text)
  })

  it('leaves a pre-existing symlinked .gitignore untouched', async () => {
    const root = makeTempRoot()
    const outside = makeTempRoot()
    const victim = join(outside, 'victim.txt')
    writeFileSync(victim, 'do not overwrite me')
    mkdirSync(join(root, '.clooks/tmp'), { recursive: true })
    symlinkSync(victim, join(root, '.clooks/tmp/.gitignore'))

    await writeHandoffFile(root, hn('h'), 'text')
    expect(readFileSync(victim, 'utf8')).toBe('do not overwrite me')
    expect((await lstat(join(root, '.clooks/tmp/.gitignore'))).isSymbolicLink()).toBe(true)
  })

  it('refuses a symlinked tmp directory without writing through it', async () => {
    const root = makeTempRoot()
    const outside = makeTempRoot()
    mkdirSync(join(root, '.clooks'), { recursive: true })
    symlinkSync(outside, join(root, '.clooks/tmp'))

    await expect(writeHandoffFile(root, hn('h'), 'text')).rejects.toThrow(/is a symlink/)
    expect(await readdir(outside)).toHaveLength(0)
  })

  it('refuses a symlinked .clooks parent and creates nothing at its target', async () => {
    const root = makeTempRoot()
    const outside = makeTempRoot()
    symlinkSync(outside, join(root, '.clooks'))

    await expect(writeHandoffFile(root, hn('h'), 'text')).rejects.toThrow(/is a symlink/)
    expect(await readdir(outside)).toHaveLength(0)
  })

  it('reuse path is immune to a symlink swapped in at the target', async () => {
    const root = makeTempRoot()
    const outside = makeTempRoot()
    const text = 'identical content'
    const decoy = join(outside, 'decoy.md')
    writeFileSync(decoy, text)

    // A pre-existing symlink whose content matches must still be replaced,
    // not adopted — inspectTarget opens with O_NOFOLLOW and gets ELOOP.
    const digest = createHash('sha256').update(text).digest('hex').slice(0, 12)
    const target = join(root, '.clooks/tmp', `handoff-h-${digest}.md`)
    mkdirSync(join(root, '.clooks/tmp'), { recursive: true })
    symlinkSync(decoy, target)

    await writeHandoffFile(root, hn('h'), text)
    expect((await lstat(target)).isSymbolicLink()).toBe(false)
    expect(readFileSync(decoy, 'utf8')).toBe(text)
  })

  it('cleans up the staging file when the rename fails', async () => {
    const root = makeTempRoot()
    const text = 'payload that cannot land'
    const digest = createHash('sha256').update(text).digest('hex').slice(0, 12)
    const dir = join(root, '.clooks/tmp')
    mkdirSync(join(dir, `handoff-h-${digest}.md`), { recursive: true })

    await expect(writeHandoffFile(root, hn('h'), text)).rejects.toThrow()
    const entries = await readdir(dir)
    expect(entries.filter((e) => e.startsWith('.handoff-') && e.endsWith('.tmp'))).toHaveLength(0)
  })

  it('throws when a regular file occupies the tmp directory path', async () => {
    const root = makeTempRoot()
    mkdirSync(join(root, '.clooks'), { recursive: true })
    writeFileSync(join(root, '.clooks/tmp'), 'not a directory')

    await expect(writeHandoffFile(root, hn('h'), 'text')).rejects.toThrow()
  })

  it('survives concurrent first use of the directory', async () => {
    const root = makeTempRoot()
    const paths = await Promise.all([
      writeHandoffFile(root, hn('a'), 'first text'),
      writeHandoffFile(root, hn('b'), 'second text'),
    ])
    expect(new Set(paths).size).toBe(2)

    const entries = await readdir(join(root, '.clooks/tmp'))
    expect(entries.filter((e) => e === '.gitignore')).toHaveLength(1)
    expect(await listHandoffFiles(root)).toHaveLength(2)
  })

  it('evicts nothing when a dedup write at the cap adds no file', async () => {
    const root = makeTempRoot()
    const dir = join(root, '.clooks/tmp')
    mkdirSync(dir, { recursive: true })

    const text = 'the deduped payload'
    const digest = createHash('sha256').update(text).digest('hex').slice(0, 12)
    const target = join(dir, `handoff-h-${digest}.md`)
    writeFileSync(target, text)
    for (let i = 0; i < HANDOFF_MAX_FILES - 1; i++) {
      writeFileSync(join(dir, `handoff-filler-${i}.md`), `filler ${i}`)
    }

    const path = await writeHandoffFile(root, hn('h'), text)
    expect(path).toBe(target)
    expect(await listHandoffFiles(root)).toHaveLength(HANDOFF_MAX_FILES)
  })

  it('caps the directory when a write genuinely adds a file', async () => {
    const root = makeTempRoot()
    const dir = join(root, '.clooks/tmp')
    mkdirSync(dir, { recursive: true })
    for (let i = 0; i < HANDOFF_MAX_FILES; i++) {
      writeFileSync(join(dir, `handoff-filler-${i}.md`), `filler ${i}`)
    }

    const path = await writeHandoffFile(root, hn('h'), 'a brand new payload')
    expect(await listHandoffFiles(root)).toHaveLength(HANDOFF_MAX_FILES)
    expect(await readFile(path, 'utf8')).toBe('a brand new payload')
  })

  it('leaves no staging files behind', async () => {
    const root = makeTempRoot()
    await writeHandoffFile(root, hn('h'), 'text')
    const entries = await readdir(join(root, '.clooks/tmp'))
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0)
  })
})

// --- applyHandoff ---

describe('applyHandoff', () => {
  it('returns the identical object with handoff disabled (no I/O)', async () => {
    const root = makeTempRoot()
    const config = makeConfig({ global: false, hooks: { h: {} } })
    const result: EngineResult = { result: 'block', reason: 'x'.repeat(5000) }

    const out = await applyHandoff(result, hn('h'), 'PreToolUse', config, root)
    expect(out).toBe(result)
    await expect(readdir(join(root, '.clooks/tmp'))).rejects.toThrow()
  })

  it('hands off a PreToolUse block reason', async () => {
    const root = makeTempRoot()
    const config = makeConfig({ hooks: { h: { handoff: true } } })
    const reason = 'remediation guide '.repeat(200)

    const out = await applyHandoff({ result: 'block', reason }, hn('h'), 'PreToolUse', config, root)
    expect(out.reason).toContain('[clooks] Hook "h": read ')
    expect(out.reason).toContain(' and follow its instructions.')
    expect(out.result).toBe('block')

    const files = await listHandoffFiles(root)
    expect(files).toHaveLength(1)
    expect(await readFile(join(root, '.clooks/tmp', files[0]!), 'utf8')).toBe(reason)
  })

  it('never hands off an ask reason', async () => {
    const root = makeTempRoot()
    const config = makeConfig({ hooks: { h: { handoff: true } } })
    const reason = 'please confirm '.repeat(200)

    const out = await applyHandoff({ result: 'ask', reason }, hn('h'), 'PreToolUse', config, root)
    expect(out.reason).toBe(reason)
    await expect(readdir(join(root, '.clooks/tmp'))).rejects.toThrow()
  })

  it('never hands off a UserPromptSubmit block reason but does hand off its injectContext', async () => {
    const root = makeTempRoot()
    const config = makeConfig({ hooks: { h: { handoff: true } } })
    const reason = 'your prompt was erased '.repeat(100)
    const injectContext = 'background material '.repeat(100)

    const out = await applyHandoff(
      { result: 'block', reason, injectContext },
      hn('h'),
      'UserPromptSubmit',
      config,
      root,
    )
    expect(out.reason).toBe(reason)
    expect(out.injectContext).toContain('and follow its instructions.')
    expect(await listHandoffFiles(root)).toHaveLength(1)
  })

  it('hands off block reasons on PostToolUse, Stop and SubagentStop', async () => {
    const config = makeConfig({ hooks: { h: { handoff: true } } })
    for (const event of ['PostToolUse', 'Stop', 'SubagentStop'] as EventName[]) {
      const root = makeTempRoot()
      const out = await applyHandoff(
        { result: 'block', reason: 'why you must continue '.repeat(100) },
        hn('h'),
        event,
        config,
        root,
      )
      expect(out.reason).toContain('and follow its instructions.')
    }
  })

  it('does not hand off a block reason on an event with no model-facing reason', async () => {
    const root = makeTempRoot()
    const config = makeConfig({ hooks: { h: { handoff: true } } })
    const reason = 'denied '.repeat(300)

    const out = await applyHandoff(
      { result: 'block', reason },
      hn('h'),
      'PermissionRequest',
      config,
      root,
    )
    expect(out.reason).toBe(reason)
  })

  it('hands off continuation feedback', async () => {
    const root = makeTempRoot()
    const config = makeConfig({ hooks: { h: { handoff: true } } })
    const feedback = 'here is what to do next '.repeat(100)

    const out = await applyHandoff(
      { result: 'continue', feedback },
      hn('h'),
      'TeammateIdle',
      config,
      root,
    )
    expect(out.feedback).toContain('and follow its instructions.')
    expect(out.result).toBe('continue')
  })

  it('applies the threshold per payload', async () => {
    const root = makeTempRoot()
    const config = makeConfig({ hooks: { h: { handoff: 100 } } })
    const shortReason = 'x'.repeat(100)
    const longContext = 'y'.repeat(101)

    const out = await applyHandoff(
      { result: 'block', reason: shortReason, injectContext: longContext },
      hn('h'),
      'PreToolUse',
      config,
      root,
    )
    expect(out.reason).toBe(shortReason)
    expect(out.injectContext).toContain('and follow its instructions.')
    expect(await listHandoffFiles(root)).toHaveLength(1)
  })

  it('hands off both payloads independently when both qualify', async () => {
    const root = makeTempRoot()
    const config = makeConfig({ hooks: { h: { handoff: true } } })
    const reason = 'reason text'
    const injectContext = 'context text'

    const out = await applyHandoff(
      { result: 'block', reason, injectContext },
      hn('h'),
      'PreToolUse',
      config,
      root,
    )
    expect(out.reason).toContain('and follow its instructions.')
    expect(out.injectContext).toContain('and follow its instructions.')
    expect(out.reason).not.toBe(out.injectContext)
    expect(await listHandoffFiles(root)).toHaveLength(2)
  })

  it('honours an event-level false over a hook-level true', async () => {
    const root = makeTempRoot()
    const config = makeConfig({
      hooks: { h: { handoff: true, events: { PreToolUse: false } } },
    })
    const result: EngineResult = { result: 'block', reason: 'long '.repeat(500) }

    expect(await applyHandoff(result, hn('h'), 'PreToolUse', config, root)).toBe(result)
  })

  it('delivers inline and warns on stderr when the write fails', async () => {
    const root = makeTempRoot()
    mkdirSync(join(root, '.clooks'), { recursive: true })
    writeFileSync(join(root, '.clooks/tmp'), 'not a directory')

    const config = makeConfig({ hooks: { h: { handoff: true } } })
    const reason = 'the real deny reason'
    const warnings: string[] = []
    const spy = spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      warnings.push(String(chunk))
      return true
    })
    try {
      const out = await applyHandoff(
        { result: 'block', reason },
        hn('h'),
        'PreToolUse',
        config,
        root,
      )
      expect(out.result).toBe('block')
      expect(out.reason).toBe(reason)
    } finally {
      spy.mockRestore()
    }

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('clooks: warning: handoff write failed for hook "h"')
    expect(warnings[0]).toContain('delivering inline')
  })

  it('leaves non-eligible fields untouched', async () => {
    const root = makeTempRoot()
    const config = makeConfig({ hooks: { h: { handoff: true } } })
    const sessionTitle = 'title '.repeat(200)

    const out = await applyHandoff(
      { result: 'allow', sessionTitle },
      hn('h'),
      'UserPromptSubmit',
      config,
      root,
    )
    expect(out.sessionTitle).toBe(sessionTitle)
  })
})

// --- pruneHandoffFiles ---

describe('pruneHandoffFiles', () => {
  const STALE_MTIME = new Date(Date.now() - HANDOFF_TTL_MS - 60_000)
  const FRESH_MTIME = new Date()

  async function age(path: string, mtime: Date): Promise<void> {
    await utimes(path, mtime, mtime)
  }

  it('deletes a stale handoff file', async () => {
    const root = makeTempRoot()
    const dir = join(root, '.clooks/tmp')
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'handoff-h-abc123456789.md')
    writeFileSync(target, 'stale content')
    await age(target, STALE_MTIME)

    await pruneHandoffFiles(root)

    await expect(lstat(target)).rejects.toThrow()
  })

  it('keeps a fresh handoff file', async () => {
    const root = makeTempRoot()
    const dir = join(root, '.clooks/tmp')
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'handoff-h-abc123456789.md')
    writeFileSync(target, 'fresh content')
    await age(target, FRESH_MTIME)

    await pruneHandoffFiles(root)

    const st = await stat(target)
    expect(st.isFile()).toBe(true)
  })

  it('keeps a stale file that does not match the handoff or staging pattern', async () => {
    const root = makeTempRoot()
    const dir = join(root, '.clooks/tmp')
    mkdirSync(dir, { recursive: true })
    const target = join(dir, '.gitignore')
    writeFileSync(target, '*\n')
    await age(target, STALE_MTIME)

    await pruneHandoffFiles(root)

    const st = await stat(target)
    expect(st.isFile()).toBe(true)
  })

  it('keeps a symlink named like a stale handoff file', async () => {
    const root = makeTempRoot()
    const dir = join(root, '.clooks/tmp')
    mkdirSync(dir, { recursive: true })
    const real = join(dir, 'real-target.md')
    writeFileSync(real, 'real content')
    await age(real, STALE_MTIME)
    const link = join(dir, 'handoff-h-deadbeef0000.md')
    symlinkSync(real, link)
    await age(link, STALE_MTIME)

    await pruneHandoffFiles(root)

    const st = await lstat(link)
    expect(st.isSymbolicLink()).toBe(true)
  })

  it('deletes a stale leaked staging file', async () => {
    const root = makeTempRoot()
    const dir = join(root, '.clooks/tmp')
    mkdirSync(dir, { recursive: true })
    const staging = join(dir, '.handoff-1234-deadbeefcafebabe.tmp')
    writeFileSync(staging, 'partial write')
    await age(staging, STALE_MTIME)

    await pruneHandoffFiles(root)

    await expect(lstat(staging)).rejects.toThrow()
  })

  it('keeps a fresh staging file', async () => {
    const root = makeTempRoot()
    const dir = join(root, '.clooks/tmp')
    mkdirSync(dir, { recursive: true })
    const staging = join(dir, '.handoff-1234-deadbeefcafebabe.tmp')
    writeFileSync(staging, 'partial write')
    await age(staging, FRESH_MTIME)

    await pruneHandoffFiles(root)

    const st = await stat(staging)
    expect(st.isFile()).toBe(true)
  })

  it('is a silent no-op when the directory does not exist', async () => {
    const root = makeTempRoot()

    await expect(pruneHandoffFiles(root)).resolves.toBeUndefined()
  })

  it('deletes nothing outside the project when tmp is a symlink', async () => {
    const root = makeTempRoot()
    const outside = makeTempRoot()
    const victim = join(outside, 'handoff-h-abc123456789.md')
    writeFileSync(victim, 'someone else’s file')
    await age(victim, STALE_MTIME)
    mkdirSync(join(root, '.clooks'), { recursive: true })
    symlinkSync(outside, join(root, '.clooks/tmp'))

    const warnings = await captureStderr(() => pruneHandoffFiles(root))

    expect((await stat(victim)).isFile()).toBe(true)
    expect(warnings.join('')).toContain('handoff prune skipped')
  })

  it('deletes nothing outside the project when the .clooks parent is a symlink', async () => {
    const root = makeTempRoot()
    const outside = makeTempRoot()
    mkdirSync(join(outside, 'tmp'), { recursive: true })
    const victim = join(outside, 'tmp/handoff-h-abc123456789.md')
    writeFileSync(victim, 'someone else’s file')
    await age(victim, STALE_MTIME)
    symlinkSync(outside, join(root, '.clooks'))

    const warnings = await captureStderr(() => pruneHandoffFiles(root))

    expect((await stat(victim)).isFile()).toBe(true)
    expect(warnings.join('')).toContain('handoff prune skipped')
  })

  it('warns once and does not throw when tmp is a regular file', async () => {
    const root = makeTempRoot()
    mkdirSync(join(root, '.clooks'), { recursive: true })
    writeFileSync(join(root, '.clooks/tmp'), 'not a directory')

    const warnings = await captureStderr(() => pruneHandoffFiles(root))

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('handoff prune failed')
  })
})
