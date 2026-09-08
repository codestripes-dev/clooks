import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  makeCodexGlobalEntrypointCommand,
  registerCodexClooks,
  unregisterCodexClooks,
} from './agents/codex/settings.js'
import {
  clearCodexRegistrationState,
  publishCodexReceipt,
  readCodexReceipt,
  readCodexTrackedHome,
  trackCodexHome,
} from './registration-state.js'

let root: string
let home: string
let codex: string
let receipt: string
let tracked: string
let launcher: string
let originalHome: string | undefined
let originalCodex: string | undefined
let originalRuntimeHome: string | undefined

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'clooks-registration-state-')))
  home = join(root, 'installation')
  codex = join(root, 'codex A')
  receipt = join(home, '.clooks/.global-entrypoint-active.codex')
  tracked = join(home, '.clooks/.codex-registration-home')
  launcher = join(home, '.clooks/bin/entrypoint.sh')
  fs.mkdirSync(join(home, '.clooks/bin'), { recursive: true })
  fs.mkdirSync(codex)
  fs.writeFileSync(launcher, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  originalHome = process.env.HOME
  originalCodex = process.env.CODEX_HOME
  originalRuntimeHome = process.env.CLOOKS_HOME_ROOT
  process.env.HOME = home
  process.env.CODEX_HOME = codex
  process.env.CLOOKS_HOME_ROOT = home
})

afterEach(() => {
  mock.restore()
  for (const [key, value] of [
    ['HOME', originalHome],
    ['CODEX_HOME', originalCodex],
    ['CLOOKS_HOME_ROOT', originalRuntimeHome],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  fs.rmSync(root, { recursive: true, force: true })
})

function receiptText(codexHome = codex, checksum = '0:0', installation = home): string {
  return `clooks-codex-registration-v1\n${installation}\n${codexHome}\n${checksum}\n`
}

function recoveryText(codexHome = codex): string {
  return `clooks-codex-home-v1\n${codexHome}\n`
}

function register(): void {
  trackCodexHome(home, codex)
  registerCodexClooks(codex, makeCodexGlobalEntrypointCommand(home))
  publishCodexReceipt(home, codex)
}

describe('Codex registration state formats', () => {
  test('distinguishes missing, empty legacy receipt and invalid empty recovery', () => {
    expect(readCodexReceipt(home)).toEqual({ kind: 'missing' })
    expect(readCodexTrackedHome(home)).toEqual({ kind: 'missing' })
    fs.writeFileSync(receipt, '')
    fs.writeFileSync(tracked, '')
    expect(readCodexReceipt(home)).toEqual({ kind: 'legacy' })
    expect(readCodexTrackedHome(home).kind).toBe('invalid')
  })

  test('reads exactly versioned LF-terminated receipt and recovery records', () => {
    fs.writeFileSync(receipt, receiptText())
    fs.writeFileSync(tracked, recoveryText())
    expect(readCodexReceipt(home)).toEqual({
      kind: 'receipt',
      value: { version: 1, homeRoot: home, codexHome: codex, checksum: '0:0' },
    })
    expect(readCodexTrackedHome(home)).toEqual({ kind: 'home', codexHome: codex })
  })

  const badReceipts: Array<[string, () => string]> = [
    ['whitespace', () => ' \n'],
    ['wrong version', () => receiptText().replace('-v1', '-v2')],
    ['CRLF', () => receiptText().replaceAll('\n', '\r\n')],
    ['missing final LF', () => receiptText().slice(0, -1)],
    ['extra LF', () => receiptText() + '\n'],
    ['extra field', () => receiptText() + 'extra\n'],
    ['relative installation', () => receiptText(codex, '0:0', 'relative')],
    ['wrong installation', () => receiptText(codex, '0:0', root)],
    ['relative Codex home', () => receiptText('relative')],
    ['empty Codex home', () => receiptText('')],
    ['noncanonical path', () => receiptText(`${codex}/../codex A`)],
    ['CR in home', () => receiptText(`${codex}\r`)],
    ['NUL in home', () => receiptText(`${codex}\0`)],
    ['nonnumeric checksum', () => receiptText(codex, 'bad:3')],
    ['negative checksum', () => receiptText(codex, '-1:3')],
    ['leading zero', () => receiptText(codex, '01:3')],
    ['leading count zero', () => receiptText(codex, '1:03')],
    ['signed checksum', () => receiptText(codex, '+1:3')],
    ['checksum whitespace', () => receiptText(codex, '1:3 ')],
    ['fractional count', () => receiptText(codex, '1:3.5')],
  ]
  for (const [name, contents] of badReceipts) {
    test(`rejects ${name} receipt without altering bytes`, () => {
      const bytes = contents()
      fs.writeFileSync(receipt, bytes)
      const state = readCodexReceipt(home)
      expect(state.kind).toBe('invalid')
      if (state.kind === 'invalid') expect(state.reason).toContain(receipt)
      expect(() => trackCodexHome(home, codex)).toThrow(receipt)
      expect(() => clearCodexRegistrationState(home, codex)).toThrow(receipt)
      expect(fs.readFileSync(receipt, 'utf8')).toBe(bytes)
      expect(fs.existsSync(tracked)).toBe(false)
    })
  }

  for (const contents of [
    '',
    ' \n',
    'clooks-codex-home-v2\n/path\n',
    'clooks-codex-home-v1\nrelative\n',
    'clooks-codex-home-v1\n/path',
    'clooks-codex-home-v1\n/path\n\n',
    'clooks-codex-home-v1\r\n/path\r\n',
  ]) {
    test(`rejects malformed recovery ${JSON.stringify(contents)} without removal`, () => {
      fs.writeFileSync(tracked, contents)
      expect(readCodexTrackedHome(home).kind).toBe('invalid')
      expect(() => trackCodexHome(home, codex)).toThrow(tracked)
      expect(() => clearCodexRegistrationState(home, codex)).toThrow(tracked)
      expect(fs.readFileSync(tracked, 'utf8')).toBe(contents)
    })
  }

  test('propagates state read errors instead of reporting absence or malformed data', () => {
    fs.writeFileSync(receipt, receiptText())
    fs.writeFileSync(tracked, recoveryText())
    const read = fs.readFileSync
    const failure = Object.assign(new Error('injected read EACCES'), { code: 'EACCES' })
    spyOn(fs, 'readFileSync').mockImplementation(((
      path: fs.PathOrFileDescriptor,
      ...args: unknown[]
    ) => {
      if (path === receipt || path === tracked) throw failure
      return (read as (...values: unknown[]) => unknown)(path, ...args)
    }) as typeof fs.readFileSync)
    expect(() => readCodexReceipt(home)).toThrow(failure)
    expect(() => readCodexTrackedHome(home)).toThrow(failure)
  })

  for (const name of ['receipt', 'recovery'] as const) {
    for (const kind of ['directory', 'FIFO'] as const) {
      test.skipIf(kind === 'FIFO' && process.env.CLOOKS_E2E_DOCKER !== 'true')(
        `rejects ${name} ${kind} before reading and preserves both state paths`,
        () => {
          const path = name === 'receipt' ? receipt : tracked
          const other = name === 'receipt' ? tracked : receipt
          const otherBytes = name === 'receipt' ? recoveryText() : receiptText()
          fs.writeFileSync(other, otherBytes)
          if (kind === 'directory') {
            fs.mkdirSync(path)
            fs.writeFileSync(join(path, 'keep'), 'unrelated contents')
          } else {
            const result = Bun.spawnSync(['mkfifo', '--', path], {
              env: { PATH: '/usr/bin:/bin', HOME: home, CODEX_HOME: codex, CLOOKS_HOME_ROOT: home },
              stdin: 'ignore',
              stdout: 'pipe',
              stderr: 'pipe',
              timeout: 2000,
              killSignal: 'SIGKILL',
            })
            expect({ exitCode: result.exitCode, stderr: result.stderr.toString() }).toEqual({
              exitCode: 0,
              stderr: '',
            })
          }
          const before = fs.lstatSync(path)
          expect(kind === 'FIFO' ? before.isFIFO() : before.isDirectory()).toBe(true)
          const read = fs.readFileSync
          // A regression must fail rather than hang while opening an unread FIFO.
          const guard = spyOn(fs, 'readFileSync').mockImplementation(((
            candidate: fs.PathOrFileDescriptor,
            ...args: unknown[]
          ) => {
            if (candidate === path)
              throw new Error('Nonregular state must be rejected before reading')
            return (read as (...values: unknown[]) => unknown)(candidate, ...args)
          }) as typeof fs.readFileSync)
          const state = name === 'receipt' ? readCodexReceipt(home) : readCodexTrackedHome(home)
          expect(state.kind).toBe('invalid')
          if (state.kind === 'invalid') {
            expect(state.reason).toContain(path)
            expect(state.reason).toContain('regular file')
          }
          expect(() => trackCodexHome(home, codex)).toThrow(path)
          expect(() => clearCodexRegistrationState(home, codex)).toThrow(path)
          guard.mockRestore()
          const after = fs.lstatSync(path)
          expect(after.ino).toBe(before.ino)
          expect(kind === 'FIFO' ? after.isFIFO() : after.isDirectory()).toBe(true)
          expect(fs.readFileSync(other, 'utf8')).toBe(otherBytes)
          if (kind === 'directory') {
            expect(fs.readFileSync(join(path, 'keep'), 'utf8')).toBe('unrelated contents')
          }
        },
      )
    }
    for (const dangling of [false, true]) {
      test(`rejects ${dangling ? 'dangling' : 'existing'} ${name} symlink`, () => {
        const path = name === 'receipt' ? receipt : tracked
        const target = join(root, 'target')
        if (!dangling) fs.writeFileSync(target, name === 'receipt' ? receiptText() : recoveryText())
        fs.symlinkSync(target, path)
        expect(
          (name === 'receipt' ? readCodexReceipt(home) : readCodexTrackedHome(home)).kind,
        ).toBe('invalid')
        expect(() => trackCodexHome(home, codex)).toThrow(path)
        expect(fs.readlinkSync(path)).toBe(target)
        expect(fs.existsSync(target)).toBe(!dangling)
      })
    }
  }
})

describe('Codex state publication and recovery', () => {
  test('tracks physical identities without creating a missing Codex home', () => {
    const alias = join(root, 'alias')
    fs.symlinkSync(home, alias)
    const selected = join(root, 'not-created', 'nested')
    trackCodexHome(alias, selected)
    expect(fs.readFileSync(tracked, 'utf8')).toBe(recoveryText(selected))
    expect(fs.existsSync(join(root, 'not-created'))).toBe(false)
    expect(readCodexReceipt(alias).kind).toBe('missing')
  })

  test('uses POSIX cksum over stdin with the fixed abc newline vector', () => {
    fs.writeFileSync(join(codex, 'hooks.json'), 'abc\n')
    const spawn = spyOn(Bun, 'spawnSync')
    publishCodexReceipt(home, codex)
    expect(fs.readFileSync(receipt, 'utf8')).toBe(receiptText(codex, '1112837078:4'))
    expect(spawn).toHaveBeenCalledWith(['cksum'], {
      stdin: Buffer.from('abc\n'),
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 10_000,
      killSignal: 'SIGKILL',
    })
  })

  test('publishes after registration and refreshes stale receipt bytes', () => {
    register()
    const old = fs.readFileSync(receipt, 'utf8')
    fs.appendFileSync(join(codex, 'hooks.json'), '\n')
    publishCodexReceipt(home, codex)
    expect(fs.readFileSync(receipt, 'utf8')).not.toBe(old)
    expect(fs.readFileSync(tracked, 'utf8')).toBe(recoveryText())
  })

  test('canonicalizes installation and Codex aliases in published state', () => {
    const installationAlias = join(root, 'install-alias')
    const codexAlias = join(root, 'codex-alias')
    fs.symlinkSync(home, installationAlias)
    fs.symlinkSync(codex, codexAlias)
    trackCodexHome(installationAlias, codexAlias)
    fs.writeFileSync(join(codex, 'hooks.json'), 'abc\n')
    publishCodexReceipt(installationAlias, codexAlias)
    expect(fs.readFileSync(receipt, 'utf8')).toBe(receiptText(codex, '1112837078:4'))
    expect(readCodexReceipt(installationAlias).kind).toBe('receipt')
    expect(fs.readFileSync(tracked, 'utf8')).toBe(recoveryText())
  })

  for (const value of ['', 'relative', '/tmp/bad\npath', '/tmp/bad\rpath']) {
    test(`rejects invalid publication/tracking input ${JSON.stringify(value)}`, () => {
      expect(() => trackCodexHome(home, value)).toThrow('absolute path')
      expect(() => publishCodexReceipt(home, value)).toThrow('absolute path')
      expect(() => clearCodexRegistrationState(home, value)).toThrow('absolute path')
      expect(fs.existsSync(tracked)).toBe(false)
      expect(fs.existsSync(receipt)).toBe(false)
    })
  }

  test('conflicting identities block tracking, publication and cleanup without writes', () => {
    const other = join(root, 'B')
    fs.writeFileSync(tracked, recoveryText())
    fs.writeFileSync(receipt, receiptText(other))
    for (const operation of [trackCodexHome, publishCodexReceipt, clearCodexRegistrationState]) {
      expect(() => operation(home, codex)).toThrow('conflicting')
    }
    expect(fs.readFileSync(tracked, 'utf8')).toBe(recoveryText())
    expect(fs.readFileSync(receipt, 'utf8')).toBe(receiptText(other))
  })

  test('legacy receipt pins default home and upgrades only there', () => {
    const defaultHome = join(home, '.codex')
    fs.writeFileSync(receipt, '')
    expect(() => trackCodexHome(home, codex)).toThrow('Unhook')
    expect(fs.existsSync(tracked)).toBe(false)
    trackCodexHome(home, defaultHome)
    registerCodexClooks(defaultHome, makeCodexGlobalEntrypointCommand(home))
    publishCodexReceipt(home, defaultHome)
    const state = readCodexReceipt(home)
    expect(state.kind).toBe('receipt')
    if (state.kind === 'receipt') expect(state.value.codexHome).toBe(defaultHome)
  })

  test('recovery-write rename failure preserves old state and leaves no attempt temporary', () => {
    trackCodexHome(home, codex)
    const old = fs.readFileSync(tracked, 'utf8')
    const rename = fs.renameSync
    const fault = spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (destination === tracked) throw new Error('injected recovery rename')
      rename(source, destination)
    })
    expect(() => trackCodexHome(home, codex)).toThrow('injected recovery rename')
    expect(fs.readFileSync(tracked, 'utf8')).toBe(old)
    expect(fs.readdirSync(join(home, '.clooks')).sort()).toEqual([
      '.codex-registration-home',
      'bin',
    ])
    expect(fs.existsSync(join(codex, 'hooks.json'))).toBe(false)
    fault.mockRestore()
    trackCodexHome(home, codex)
  })

  test('receipt rename failure retains committed registration and cleanup identity for retry', () => {
    trackCodexHome(home, codex)
    registerCodexClooks(codex, makeCodexGlobalEntrypointCommand(home))
    const bytes = fs.readFileSync(join(codex, 'hooks.json'), 'utf8')
    const rename = fs.renameSync
    const fault = spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (destination === receipt) throw new Error('injected receipt rename')
      rename(source, destination)
    })
    expect(() => publishCodexReceipt(home, codex)).toThrow('injected receipt rename')
    expect(fs.existsSync(receipt)).toBe(false)
    expect(fs.readFileSync(join(codex, 'hooks.json'), 'utf8')).toBe(bytes)
    expect(fs.readFileSync(tracked, 'utf8')).toBe(recoveryText())
    expect(fs.readdirSync(join(home, '.clooks')).sort()).toEqual([
      '.codex-registration-home',
      'bin',
    ])
    expect(() => trackCodexHome(home, join(root, 'B'))).toThrow('Unhook')
    fault.mockRestore()
    publishCodexReceipt(home, codex)
    expect(readCodexReceipt(home).kind).toBe('receipt')
  })

  for (const [output, exitCode] of [
    ['', 1],
    ['0 0\n', 0],
    ['1 4 file\n', 0],
    ['01 4\n', 0],
    ['1 4\r\n', 0],
    ['1 4\nextra\n', 0],
    ['1 4', 0],
  ] as const) {
    test(`failed or malformed cksum ${JSON.stringify(output)} cannot publish new receipt`, () => {
      trackCodexHome(home, codex)
      fs.writeFileSync(join(codex, 'hooks.json'), 'abc\n')
      spyOn(Bun, 'spawnSync').mockImplementation(
        () =>
          ({
            stdout: Buffer.from(output),
            stderr: Buffer.from(''),
            exitCode,
            success: exitCode === 0,
          }) as ReturnType<typeof Bun.spawnSync>,
      )
      expect(() => publishCodexReceipt(home, codex)).toThrow('cksum')
      expect(fs.existsSync(receipt)).toBe(false)
      expect(readCodexTrackedHome(home)).toEqual({ kind: 'home', codexHome: codex })
    })
  }

  for (const outcome of ['timeout error', 'killed timeout result'] as const) {
    test(`cksum ${outcome} retains recovery and committed hooks without publishing`, () => {
      trackCodexHome(home, codex)
      registerCodexClooks(codex, makeCodexGlobalEntrypointCommand(home))
      const hooksPath = join(codex, 'hooks.json')
      const bytes = fs.readFileSync(hooksPath)
      const spawn = spyOn(Bun, 'spawnSync').mockImplementation(() => {
        if (outcome === 'timeout error') {
          throw Object.assign(new Error('cksum timed out'), { code: 'ETIMEDOUT' })
        }
        return {
          stdout: Buffer.from(`0 ${bytes.byteLength}\n`),
          stderr: Buffer.from(''),
          exitCode: 137,
          signalCode: 'SIGKILL',
          success: false,
        } as ReturnType<typeof Bun.spawnSync>
      })
      expect(() => publishCodexReceipt(home, codex)).toThrow('cksum')
      expect(spawn).toHaveBeenCalledWith(['cksum'], {
        stdin: bytes,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 10_000,
        killSignal: 'SIGKILL',
      })
      expect(fs.existsSync(receipt)).toBe(false)
      expect(fs.readFileSync(tracked, 'utf8')).toBe(recoveryText())
      expect(fs.readFileSync(hooksPath)).toEqual(bytes)
    })
  }

  test('missing checksum utility leaves an existing receipt and recovery unchanged', () => {
    register()
    const old = fs.readFileSync(receipt, 'utf8')
    spyOn(Bun, 'spawnSync').mockImplementation(() => {
      throw new Error('cksum ENOENT')
    })
    expect(() => publishCodexReceipt(home, codex)).toThrow('cksum')
    expect(fs.readFileSync(receipt, 'utf8')).toBe(old)
    expect(readCodexTrackedHome(home)).toEqual({ kind: 'home', codexHome: codex })
  })

  test('missing or nonexecutable launcher and missing or symlink hooks cannot publish', () => {
    trackCodexHome(home, codex)
    fs.writeFileSync(join(codex, 'hooks.json'), '{}\n')
    fs.unlinkSync(launcher)
    expect(() => publishCodexReceipt(home, codex)).toThrow()
    fs.writeFileSync(launcher, '#!/bin/sh\n', { mode: 0o644 })
    expect(() => publishCodexReceipt(home, codex)).toThrow()
    fs.chmodSync(launcher, 0o755)
    fs.unlinkSync(join(codex, 'hooks.json'))
    expect(() => publishCodexReceipt(home, codex)).toThrow()
    const target = join(root, 'target-hooks')
    fs.writeFileSync(target, '{}\n')
    fs.symlinkSync(target, join(codex, 'hooks.json'))
    expect(() => publishCodexReceipt(home, codex)).toThrow('regular file')
    expect(fs.existsSync(receipt)).toBe(false)
  })
})

describe('Codex state cleanup', () => {
  test('missing state returns false and creates nothing', () => {
    expect(clearCodexRegistrationState(home, codex)).toBe(false)
    expect(fs.existsSync(tracked)).toBe(false)
    expect(fs.existsSync(receipt)).toBe(false)
  })

  test('unhooking home B preserves home A state and registration bytes', () => {
    register()
    const bytes = fs.readFileSync(join(codex, 'hooks.json'), 'utf8')
    const old = fs.readFileSync(receipt, 'utf8')
    const other = join(root, 'B')
    unregisterCodexClooks(other)
    expect(clearCodexRegistrationState(home, other)).toBe(false)
    expect(fs.readFileSync(receipt, 'utf8')).toBe(old)
    expect(fs.readFileSync(tracked, 'utf8')).toBe(recoveryText())
    expect(fs.readFileSync(join(codex, 'hooks.json'), 'utf8')).toBe(bytes)
  })

  test('clears matching state only after unhook, allowing a home switch and repeat cleanup', () => {
    register()
    expect(() => clearCodexRegistrationState(home, codex)).toThrow('hooks.SessionStart')
    unregisterCodexClooks(codex)
    expect(clearCodexRegistrationState(home, codex)).toBe(true)
    expect(clearCodexRegistrationState(home, codex)).toBe(false)
    trackCodexHome(home, join(root, 'B'))
    expect(readCodexTrackedHome(home)).toEqual({ kind: 'home', codexHome: join(root, 'B') })
  })

  test('failed registration with no hooks permits explicit matching recovery cleanup', () => {
    trackCodexHome(home, codex)
    expect(clearCodexRegistrationState(home, codex)).toBe(true)
    expect(readCodexTrackedHome(home).kind).toBe('missing')
  })

  test('failed publication A prevents switching to B until A registration is removed', () => {
    trackCodexHome(home, codex)
    registerCodexClooks(codex, makeCodexGlobalEntrypointCommand(home))
    const fault = spyOn(Bun, 'spawnSync').mockImplementation(() => {
      throw new Error('cksum unavailable')
    })
    expect(() => publishCodexReceipt(home, codex)).toThrow('cksum')
    expect(() => trackCodexHome(home, join(root, 'B'))).toThrow(codex)
    expect(readCodexTrackedHome(home)).toEqual({ kind: 'home', codexHome: codex })
    expect(() => clearCodexRegistrationState(home, codex)).toThrow('hooks.SessionStart')
    fault.mockRestore()
    unregisterCodexClooks(codex)
    clearCodexRegistrationState(home, codex)
    trackCodexHome(home, join(root, 'B'))
  })

  test('unknown-event reference surviving unhook retains identity until explicit repair', () => {
    register()
    const path = join(codex, 'hooks.json')
    const document = JSON.parse(fs.readFileSync(path, 'utf8'))
    document.hooks.FutureEvent = [
      { hooks: [{ type: 'command', command: makeCodexGlobalEntrypointCommand(home) }] },
    ]
    fs.writeFileSync(path, JSON.stringify(document))
    unregisterCodexClooks(codex)
    const bytes = fs.readFileSync(path, 'utf8')
    const old = fs.readFileSync(receipt, 'utf8')
    expect(() => clearCodexRegistrationState(home, codex)).toThrow('hooks.FutureEvent')
    expect(() => trackCodexHome(home, join(root, 'B'))).toThrow('Unhook')
    expect(fs.readFileSync(path, 'utf8')).toBe(bytes)
    expect(fs.readFileSync(receipt, 'utf8')).toBe(old)
    expect(fs.readFileSync(tracked, 'utf8')).toBe(recoveryText())
    fs.writeFileSync(path, '{}\n')
    expect(clearCodexRegistrationState(home, codex)).toBe(true)
    trackCodexHome(home, join(root, 'B'))
  })

  test('ambiguous unknown-event containers block state removal with field evidence', () => {
    trackCodexHome(home, codex)
    fs.writeFileSync(join(codex, 'hooks.json'), '{"hooks":{"FutureEvent":{"unknown":true}}}')
    expect(() => clearCodexRegistrationState(home, codex)).toThrow('hooks.FutureEvent')
    expect(fs.readFileSync(tracked, 'utf8')).toBe(recoveryText())
  })

  test('legacy receipt only clears for default home after all-event reference inspection', () => {
    fs.writeFileSync(receipt, '')
    expect(clearCodexRegistrationState(home, codex)).toBe(false)
    const defaultHome = join(home, '.codex')
    fs.mkdirSync(defaultHome)
    fs.writeFileSync(
      join(defaultHome, 'hooks.json'),
      JSON.stringify({
        hooks: {
          FutureEvent: [
            { hooks: [{ type: 'command', command: makeCodexGlobalEntrypointCommand(home) }] },
          ],
        },
      }),
    )
    expect(() => clearCodexRegistrationState(home, defaultHome)).toThrow('hooks.FutureEvent')
    expect(fs.readFileSync(receipt, 'utf8')).toBe('')
    fs.unlinkSync(join(defaultHome, 'hooks.json'))
    expect(clearCodexRegistrationState(home, defaultHome)).toBe(true)
    expect(fs.existsSync(receipt)).toBe(false)
  })

  for (const name of ['receipt', 'recovery'] as const) {
    test(`${name} cleanup failure retains identity and retry succeeds`, () => {
      register()
      unregisterCodexClooks(codex)
      const unlink = fs.unlinkSync
      const fault = spyOn(fs, 'unlinkSync').mockImplementation((path) => {
        if (path === (name === 'receipt' ? receipt : tracked))
          throw new Error('injected state unlink')
        unlink(path)
      })
      expect(() => clearCodexRegistrationState(home, codex)).toThrow('injected state unlink')
      expect(readCodexTrackedHome(home)).toEqual({ kind: 'home', codexHome: codex })
      expect(fs.existsSync(receipt)).toBe(name === 'receipt')
      expect(() => trackCodexHome(home, join(root, 'B'))).toThrow('Unhook')
      fault.mockRestore()
      expect(clearCodexRegistrationState(home, codex)).toBe(true)
      expect(fs.existsSync(tracked)).toBe(false)
      expect(fs.existsSync(receipt)).toBe(false)
    })
  }
})
