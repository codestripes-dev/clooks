import { describe, expect, test } from 'bun:test'
import { resolveHookPath, isShortAddress, shortAddressHookName } from './resolve.js'
import { hn } from '../test-utils.js'
import { join } from 'path'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('resolveHookPath', () => {
  // --- No uses, convention-based resolution ---

  test('No uses, no slash → local hook convention', () => {
    expect(resolveHookPath(hn('my-hook'), {})).toBe('.clooks/hooks/my-hook.ts')
  })

  test('No uses, with slash → vendor hook convention', () => {
    expect(resolveHookPath(hn('acme/scanner'), {})).toBe('.clooks/vendor/acme/scanner/index.ts')
  })

  test('remote hook with multiple path segments', () => {
    expect(resolveHookPath(hn('org/repo/hook-name'), {})).toBe(
      '.clooks/vendor/org/repo/hook-name/index.ts',
    )
  })

  // --- Uses: path-like values ---

  test('Uses: path-like (./)', () => {
    expect(resolveHookPath(hn('my-alias'), { uses: './lib/hook.ts' })).toBe('./lib/hook.ts')
  })

  test('Uses: path-like (../) resolves relative path', () => {
    expect(resolveHookPath(hn('my-alias'), { uses: '../shared/hook.ts' })).toBe('../shared/hook.ts')
  })

  test('Uses: path-like (/) returns absolute path as-is', () => {
    expect(resolveHookPath(hn('my-alias'), { uses: '/absolute/hook.ts' })).toBe('/absolute/hook.ts')
  })

  test('Uses: path-like with basePath', () => {
    expect(resolveHookPath(hn('my-alias'), { uses: './lib/hook.ts' }, '/home/user/.clooks')).toBe(
      join('/home/user/.clooks', 'lib/hook.ts'),
    )
  })

  // --- Uses: hook name references ---

  test('Uses: hook name (no slash)', () => {
    expect(resolveHookPath(hn('verbose-logger'), { uses: 'log-bash-commands' })).toBe(
      '.clooks/hooks/log-bash-commands.ts',
    )
  })

  test('Uses: hook name (with slash)', () => {
    expect(resolveHookPath(hn('strict-scanner'), { uses: 'acme/security' })).toBe(
      '.clooks/vendor/acme/security/index.ts',
    )
  })

  test('Uses: hook name with basePath', () => {
    expect(resolveHookPath(hn('my-alias'), { uses: 'base-hook' }, '/home/user')).toBe(
      join('/home/user', '.clooks/hooks/base-hook.ts'),
    )
  })

  // --- basePath parameter tests ---

  test('basePath prepends to local hook path', () => {
    expect(resolveHookPath(hn('my-hook'), {}, '/home/user')).toBe(
      join('/home/user', '.clooks/hooks/my-hook.ts'),
    )
  })

  test('basePath prepends to remote hook path', () => {
    expect(resolveHookPath(hn('anthropic/scanner'), {}, '/home/user')).toBe(
      join('/home/user', '.clooks/vendor/anthropic/scanner/index.ts'),
    )
  })

  test("basePath '.' is same as default (no basePath)", () => {
    expect(resolveHookPath(hn('my-hook'), {}, '.')).toBe('.clooks/hooks/my-hook.ts')
  })
})

describe('isShortAddress', () => {
  test('valid: owner/repo:hook', () => {
    expect(isShortAddress('owner/repo:hook')).toBe(true)
  })

  test('valid: org/repo:hook-name', () => {
    expect(isShortAddress('org/repo:hook-name')).toBe(true)
  })

  test('rejects path-like: ./some/path:file', () => {
    expect(isShortAddress('./some/path:file')).toBe(false)
  })

  test('rejects plain names: plain-hook-name', () => {
    expect(isShortAddress('plain-hook-name')).toBe(false)
  })

  test('rejects names without slash before colon: hook:name', () => {
    expect(isShortAddress('hook:name')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(isShortAddress('')).toBe(false)
  })

  test('rejects multiple colons: a/b:c:d', () => {
    expect(isShortAddress('a/b:c:d')).toBe(false)
  })

  test('rejects colon without slash: noSlash:hook', () => {
    expect(isShortAddress('noSlash:hook')).toBe(false)
  })
})

describe('shortAddressHookName', () => {
  test('extracts hook name from valid short address', () => {
    expect(shortAddressHookName('owner/repo:hook-name')).toBe('hook-name')
  })

  test('returns empty string for address without colon', () => {
    expect(shortAddressHookName('no-colon')).toBe('')
  })
})

describe('resolveHookPath — short address resolution', () => {
  test('Short address resolves to .ts path', () => {
    expect(resolveHookPath(hn('alias'), { uses: 'someuser/hooks:lint-guard' })).toBe(
      '.clooks/vendor/github.com/someuser/hooks/lint-guard.ts',
    )
  })

  test('Short address resolves to .ts path with basePath', () => {
    expect(resolveHookPath(hn('alias'), { uses: 'someuser/hooks:lint-guard' }, '/home/user')).toBe(
      join('/home/user', '.clooks/vendor/github.com/someuser/hooks/lint-guard.ts'),
    )
  })

  test('Short address resolves to .js when only .js exists', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'clooks-resolve-'))
    try {
      const jsDir = join(tmp, '.clooks', 'vendor', 'github.com', 'someuser', 'hooks')
      mkdirSync(jsDir, { recursive: true })
      writeFileSync(join(jsDir, 'lint-guard.js'), '// js hook')

      const result = resolveHookPath(hn('alias'), { uses: 'someuser/hooks:lint-guard' }, tmp)
      expect(result).toBe(join(tmp, '.clooks/vendor/github.com/someuser/hooks/lint-guard.js'))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('Short address prefers .ts when both .ts and .js exist', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'clooks-resolve-'))
    try {
      const dir = join(tmp, '.clooks', 'vendor', 'github.com', 'someuser', 'hooks')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'lint-guard.ts'), '// ts hook')
      writeFileSync(join(dir, 'lint-guard.js'), '// js hook')

      const result = resolveHookPath(hn('alias'), { uses: 'someuser/hooks:lint-guard' }, tmp)
      expect(result).toBe(join(tmp, '.clooks/vendor/github.com/someuser/hooks/lint-guard.ts'))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('Short address resolves to .ts (default) when neither file exists', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'clooks-resolve-'))
    try {
      const result = resolveHookPath(hn('alias'), { uses: 'someuser/hooks:lint-guard' }, tmp)
      expect(result).toBe(join(tmp, '.clooks/vendor/github.com/someuser/hooks/lint-guard.ts'))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('Short address is NOT triggered for path-like values', () => {
    // isPathLike takes priority — ./some/path:file should NOT go through short address
    expect(resolveHookPath(hn('alias'), { uses: './some/path:file' })).toBe('./some/path:file')
  })
})

describe('path resolution — absolute and traversal paths', () => {
  test('absolute path with basePath returns absolute path as-is', () => {
    expect(resolveHookPath(hn('my-hook'), { uses: '/etc/hooks/my-hook.ts' }, '/home/user')).toBe(
      '/etc/hooks/my-hook.ts',
    )
  })

  test('traversal path with basePath joins normally', () => {
    expect(
      resolveHookPath(hn('my-hook'), { uses: '../../shared/hook.ts' }, '/home/user/.clooks'),
    ).toBe(join('/home/user/.clooks', '../../shared/hook.ts'))
  })

  test('relative path within basePath', () => {
    expect(resolveHookPath(hn('my-hook'), { uses: './hooks/my-hook.ts' }, '/home/user')).toBe(
      join('/home/user', 'hooks/my-hook.ts'),
    )
  })

  test('relative path without basePath', () => {
    expect(resolveHookPath(hn('my-hook'), { uses: './scripts/hook.ts' })).toBe('./scripts/hook.ts')
  })

  test("bare '..' without basePath", () => {
    expect(resolveHookPath(hn('my-hook'), { uses: '..' })).toBe('..')
  })
})
