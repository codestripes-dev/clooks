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
import { createHash } from 'node:crypto'
import {
  CODEX_PAIRED_PROJECT_LAUNCHER,
  CODEX_PROJECT_LAUNCHER,
  CODEX_PROJECT_MARKER,
  CODEX_PROJECT_RUNTIME_ADVISORY_LAUNCHER,
  ensureCodexProjectId,
} from './project-launcher'

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

describe('project locator compatibility', () => {
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

  test('pins historical runtime locator bytes independently of source constants', () => {
    expect(sha256(CODEX_PROJECT_LAUNCHER)).toBe(
      'da0a3e03cbbcfc59105157c4c38cf224520a5c8c164a98345641bd9cf0834b01',
    )
    expect(sha256(CODEX_PAIRED_PROJECT_LAUNCHER)).toBe(
      'dfeaa230cdfd96e2b1fb36a0d7e135f34d7a3a0ff5531b7670c6d6a0ff21faa1',
    )
  })

  test('keeps the advisory locator silent, guarded and separately labelled', () => {
    expect(sha256(CODEX_PROJECT_RUNTIME_ADVISORY_LAUNCHER)).toBe(
      '493b178251ffad90667a015de5027d17703b784b599616f88e45c32eaabaa53f',
    )
    expect(CODEX_PROJECT_RUNTIME_ADVISORY_LAUNCHER).toContain(
      'advisory="$found/.clooks/bin/runtime-advisory.sh"',
    )
    expect(CODEX_PROJECT_RUNTIME_ADVISORY_LAUNCHER).toContain(
      '[ -f "$advisory" ] && [ -r "$advisory" ] || exit 0',
    )
    expect(CODEX_PROJECT_RUNTIME_ADVISORY_LAUNCHER).not.toContain("printf '[clooks]")
  })
})
