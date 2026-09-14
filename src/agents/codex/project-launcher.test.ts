import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CODEX_PROJECT_MARKER, ensureCodexProjectId } from './project-launcher'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clooks-project-id-'))
  mkdirSync(join(root, '.clooks/bin'), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('project registration identity', () => {
  test('creates one plain ID and retains exact bytes/inode on re-init', () => {
    const first = ensureCodexProjectId(root)
    const path = join(root, CODEX_PROJECT_MARKER)
    expect(first.created).toBe(true)
    expect(first.id).toMatch(/^[a-f0-9]{32}$/)
    expect(readFileSync(path, 'utf8')).toBe(first.id + '\n')
    const before = statSync(path)
    expect(ensureCodexProjectId(root)).toEqual({ id: first.id, created: false })
    expect(statSync(path).ino).toBe(before.ino)
    expect(statSync(path).mtimeMs).toBe(before.mtimeMs)
  })
  for (const content of [
    '',
    'bad\n',
    'a'.repeat(32),
    'a'.repeat(32) + '\n\n',
    'a'.repeat(32) + '\nextra',
    'a'.repeat(32) + '\0\n',
  ]) {
    test(`refuses invalid identity without replacing it: ${JSON.stringify(content)}`, () => {
      const path = join(root, CODEX_PROJECT_MARKER)
      writeFileSync(path, content)
      expect(() => ensureCodexProjectId(root)).toThrow('invalid project ID')
      expect(readFileSync(path, 'utf8')).toBe(content)
    })
  }
  for (const kind of ['directory', 'symlink', 'dangling']) {
    test(`refuses ${kind} identity without replacing it`, () => {
      const path = join(root, CODEX_PROJECT_MARKER)
      if (kind === 'directory') mkdirSync(path)
      else {
        const target = join(root, 'target')
        if (kind === 'symlink') writeFileSync(target, 'a'.repeat(32) + '\n')
        symlinkSync(target, path)
      }
      expect(() => ensureCodexProjectId(root)).toThrow('expected a regular project ID file')
      expect(existsSync(path)).toBe(kind !== 'dangling')
    })
  }
})
