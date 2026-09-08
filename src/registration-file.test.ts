import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  readRegistrationFile,
  writeRegistrationFileAtomic,
  type RegistrationFileOps,
} from './registration-file.js'

let directory: string
let path: string
beforeEach(() => {
  directory = fs.mkdtempSync(join(tmpdir(), 'clooks-atomic-'))
  path = join(directory, 'settings.json')
})
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))

describe('atomic registration files', () => {
  test('private replacement bytes are written only after opening a private temporary file', () => {
    fs.writeFileSync(path, 'private original')
    fs.chmodSync(path, 0o600)
    let opened = false
    let written = false
    writeRegistrationFileAtomic(path, 'private replacement', {
      ...fs,
      openSync(candidate, flags, mode) {
        expect(flags).toBe('wx')
        expect(mode).toBe(0o600)
        const descriptor = fs.openSync(candidate, flags, mode)
        expect(fs.fstatSync(descriptor).mode & 0o777).toBe(0o600 & ~process.umask())
        opened = true
        return descriptor
      },
      writeFileSync(descriptor, contents) {
        expect(opened).toBe(true)
        expect(fs.fstatSync(descriptor as number).mode & 0o077).toBe(0)
        fs.writeFileSync(descriptor, contents)
        written = true
      },
    })
    expect(written).toBe(true)
    expect(fs.readFileSync(path, 'utf8')).toBe('private replacement')
    expect(fs.statSync(path).mode & 0o7777).toBe(0o600)
  })

  test('replaces complete bytes and preserves permission bits', () => {
    fs.writeFileSync(path, 'old', { mode: 0o640 })
    writeRegistrationFileAtomic(path, '{"complete":true}\n')
    expect(fs.readFileSync(path, 'utf8')).toBe('{"complete":true}\n')
    expect(fs.statSync(path).mode & 0o7777).toBe(0o640)
    expect(fs.readdirSync(directory)).toEqual(['settings.json'])
  })

  test('new files use ordinary permissions filtered by umask', () => {
    writeRegistrationFileAtomic(path, '{}')
    expect(fs.statSync(path).mode & 0o777).toBe(0o666 & ~process.umask())
  })

  for (const stage of [
    'openSync',
    'writeFileSync',
    'fchmodSync',
    'closeSync',
    'renameSync',
  ] as const) {
    for (const existing of [false, true]) {
      if (stage === 'fchmodSync' && !existing) continue
      test(`${stage} failure preserves ${existing ? 'existing bytes and mode' : 'missing destination'} and retries`, () => {
        if (existing) fs.writeFileSync(path, 'original', { mode: 0o604 })
        fs.writeFileSync(join(directory, '.other-writer.tmp'), 'unrelated')
        const failure = new Error(`injected ${stage}`)
        let failed = false
        const descriptors: number[] = []
        const ops: RegistrationFileOps = {
          ...fs,
          openSync(candidate, flags, mode) {
            const descriptor = fs.openSync(candidate, flags, mode)
            descriptors.push(descriptor)
            return descriptor
          },
        }
        Object.assign(ops, {
          [stage]: (...args: unknown[]) => {
            if (!failed) {
              failed = true
              throw failure
            }
            return (fs[stage] as (...values: unknown[]) => unknown)(...args)
          },
        })
        expect(() => writeRegistrationFileAtomic(path, 'new', ops)).toThrow(failure)
        for (const descriptor of descriptors) expect(() => fs.fstatSync(descriptor)).toThrow()
        expect(fs.existsSync(path)).toBe(existing)
        if (existing) {
          expect(fs.readFileSync(path, 'utf8')).toBe('original')
          expect(fs.statSync(path).mode & 0o777).toBe(0o604)
        }
        expect(fs.readdirSync(directory).sort()).toEqual(
          existing ? ['.other-writer.tmp', 'settings.json'] : ['.other-writer.tmp'],
        )
        writeRegistrationFileAtomic(path, 'new')
        expect(fs.readFileSync(path, 'utf8')).toBe('new')
      })
    }
  }

  test('exclusive create collision does not remove another writer file', () => {
    let collided = ''
    const ops: RegistrationFileOps = {
      ...fs,
      openSync(candidate, flags, mode) {
        collided = String(candidate)
        fs.writeFileSync(candidate, 'other writer')
        return fs.openSync(candidate, flags, mode)
      },
    }
    expect(() => writeRegistrationFileAtomic(path, '{}', ops)).toThrow()
    expect(fs.readFileSync(collided, 'utf8')).toBe('other writer')
    expect(fs.existsSync(path)).toBe(false)
  })

  test('cleanup errors do not replace the write error', () => {
    const failure = new Error('original write failure')
    expect(() =>
      writeRegistrationFileAtomic(path, '{}', {
        ...fs,
        writeFileSync() {
          throw failure
        },
        unlinkSync() {
          throw new Error('cleanup failure')
        },
      }),
    ).toThrow(failure)
    expect(fs.existsSync(path)).toBe(false)
  })

  test('a partial temporary write cannot truncate the destination and closes its descriptor', () => {
    fs.writeFileSync(path, 'original', { mode: 0o640 })
    let descriptor = -1
    expect(() =>
      writeRegistrationFileAtomic(path, 'replacement', {
        ...fs,
        writeFileSync(fd) {
          descriptor = fd as number
          fs.writeFileSync(descriptor, 'prefix')
          throw new Error('partial write')
        },
      }),
    ).toThrow('partial write')
    expect(() => fs.fstatSync(descriptor)).toThrow()
    expect(fs.readFileSync(path, 'utf8')).toBe('original')
    expect(fs.statSync(path).mode & 0o777).toBe(0o640)
    expect(fs.readdirSync(directory)).toEqual(['settings.json'])
  })

  for (const dangling of [false, true]) {
    test(`rejects ${dangling ? 'dangling' : 'existing'} symlink without replacement`, () => {
      const target = join(directory, 'target')
      if (!dangling) fs.writeFileSync(target, 'target bytes')
      fs.symlinkSync(target, path)
      expect(() => writeRegistrationFileAtomic(path, '{}')).toThrow(path)
      expect(fs.readlinkSync(path)).toBe(target)
      expect(fs.existsSync(target)).toBe(!dangling)
      if (!dangling) expect(fs.readFileSync(target, 'utf8')).toBe('target bytes')
    })
  }

  test('rejects a directory destination before creating a temporary file', () => {
    fs.mkdirSync(path)
    expect(() => writeRegistrationFileAtomic(path, '{}')).toThrow(path)
    expect(fs.readdirSync(directory)).toEqual(['settings.json'])
  })
})

describe('registration reader', () => {
  test('missing and whitespace files are distinguishable empty documents', () => {
    expect(readRegistrationFile(path)).toEqual({ settings: {}, hooks: {}, fileExisted: false })
    fs.writeFileSync(path, ' \n\t')
    expect(readRegistrationFile(path)).toEqual({ settings: {}, hooks: {}, fileExisted: true })
  })

  for (const [contents, field] of [
    ['{', 'JSON'],
    ['null', 'root'],
    ['[]', 'root'],
    ['1', 'root'],
    ['{"hooks":null}', 'hooks'],
    ['{"hooks":[]}', 'hooks'],
    ['{"hooks":{"Stop":{}}}', 'hooks.Stop'],
    ['{"hooks":{"Stop":[null]}}', 'hooks.Stop[0]'],
    ['{"hooks":{"Stop":[{"hooks":null}]}}', 'hooks.Stop[0].hooks'],
    ['{"hooks":{"Stop":[{"hooks":[[]]}]}}', 'hooks.Stop[0].hooks[0]'],
  ]) {
    test(`reader identifies ${field} in ${contents}`, () => {
      fs.writeFileSync(path, contents!)
      expect(() => readRegistrationFile(path)).toThrow(field!)
      expect(fs.readFileSync(path, 'utf8')).toBe(contents!)
    })
  }

  test('known-event reads preserve opaque unknown events; inspection rejects ambiguity', () => {
    const document = { hooks: { Stop: [], Future: { opaque: true } } }
    fs.writeFileSync(path, JSON.stringify(document))
    expect(readRegistrationFile(path, ['Stop']).settings).toEqual(document)
    expect(() => readRegistrationFile(path)).toThrow('hooks.Future')
  })

  test('reader rejects symlinks, dangling symlinks and nonregular files', () => {
    const target = join(directory, 'target')
    fs.writeFileSync(target, '{}')
    fs.symlinkSync(target, path)
    expect(() => readRegistrationFile(path)).toThrow(path)
    fs.unlinkSync(target)
    expect(() => readRegistrationFile(path)).toThrow(path)
    expect(fs.readlinkSync(path)).toBe(target)
    fs.unlinkSync(path)
    fs.mkdirSync(path)
    expect(() => readRegistrationFile(path)).toThrow(path)
  })
})
