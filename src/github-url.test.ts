import { describe, test, expect } from 'bun:test'
import { parseGitHubBlobUrl, toRawUrl, classifyGitHubInput } from './github-url.js'
import type { GitHubBlobInfo } from './github-url.js'

describe('parseGitHubBlobUrl', () => {
  test('parses a standard blob URL', () => {
    const result = parseGitHubBlobUrl('https://github.com/someuser/hooks/blob/main/lint-guard.ts')
    expect(result).toEqual<GitHubBlobInfo>({
      owner: 'someuser',
      repo: 'hooks',
      ref: 'main',
      path: 'lint-guard.ts',
      filename: 'lint-guard.ts',
      filenameStem: 'lint-guard',
    })
  })

  test('parses a nested path', () => {
    const result = parseGitHubBlobUrl(
      'https://github.com/someuser/hooks/blob/main/src/hooks/lint-guard.ts',
    )
    expect(result).toEqual<GitHubBlobInfo>({
      owner: 'someuser',
      repo: 'hooks',
      ref: 'main',
      path: 'src/hooks/lint-guard.ts',
      filename: 'lint-guard.ts',
      filenameStem: 'lint-guard',
    })
  })

  test('parses a SHA ref', () => {
    const result = parseGitHubBlobUrl(
      'https://github.com/someuser/hooks/blob/abc1234567890/lint-guard.ts',
    )
    expect(result.ref).toBe('abc1234567890')
    expect(result.owner).toBe('someuser')
    expect(result.repo).toBe('hooks')
    expect(result.path).toBe('lint-guard.ts')
    expect(result.filename).toBe('lint-guard.ts')
    expect(result.filenameStem).toBe('lint-guard')
  })

  test('parses a tag ref', () => {
    const result = parseGitHubBlobUrl('https://github.com/someuser/hooks/blob/v1.0.0/lint-guard.ts')
    expect(result.ref).toBe('v1.0.0')
    expect(result.path).toBe('lint-guard.ts')
    expect(result.filenameStem).toBe('lint-guard')
  })

  test('parses a .js file', () => {
    const result = parseGitHubBlobUrl(
      'https://github.com/someuser/hooks/blob/main/dist/lint-guard.js',
    )
    expect(result).toEqual<GitHubBlobInfo>({
      owner: 'someuser',
      repo: 'hooks',
      ref: 'main',
      path: 'dist/lint-guard.js',
      filename: 'lint-guard.js',
      filenameStem: 'lint-guard',
    })
  })

  test('strips query string before parsing', () => {
    const result = parseGitHubBlobUrl(
      'https://github.com/someuser/hooks/blob/main/lint-guard.ts?foo=bar',
    )
    expect(result.path).toBe('lint-guard.ts')
    expect(result.filename).toBe('lint-guard.ts')
  })

  test('strips fragment before parsing', () => {
    const result = parseGitHubBlobUrl(
      'https://github.com/someuser/hooks/blob/main/lint-guard.ts#L10',
    )
    expect(result.path).toBe('lint-guard.ts')
    expect(result.filename).toBe('lint-guard.ts')
  })

  test('throws for a non-GitHub URL', () => {
    expect(() =>
      parseGitHubBlobUrl('https://gitlab.com/someuser/hooks/blob/main/lint-guard.ts'),
    ).toThrow(/github\.com/)
  })

  test('throws for a /tree/ URL instead of /blob/', () => {
    expect(() =>
      parseGitHubBlobUrl('https://github.com/someuser/hooks/tree/main/lint-guard.ts'),
    ).toThrow(/blob/)
  })

  test('throws for a /raw/ URL instead of /blob/', () => {
    expect(() =>
      parseGitHubBlobUrl('https://github.com/someuser/hooks/raw/main/lint-guard.ts'),
    ).toThrow(/blob/)
  })

  test('throws when the path segment is entirely missing', () => {
    // Only owner/repo/blob/ref — no file path
    expect(() => parseGitHubBlobUrl('https://github.com/someuser/hooks/blob/main')).toThrow(
      /path is missing/,
    )
  })

  test('throws when ref is empty (blob segment present but ref is empty)', () => {
    expect(() => parseGitHubBlobUrl('https://github.com/someuser/hooks/blob/')).toThrow(
      /ref is missing/,
    )
  })

  test('throws for an http:// URL', () => {
    expect(() =>
      parseGitHubBlobUrl('http://github.com/someuser/hooks/blob/main/lint-guard.ts'),
    ).toThrow(/Only HTTPS/)
  })

  test('throws when owner is missing', () => {
    expect(() => parseGitHubBlobUrl('https://github.com/')).toThrow(/owner is missing/)
  })

  test('throws when repo is missing', () => {
    // Only the owner is present — no repo segment, so the URL triggers "expected /blob/ segment"
    expect(() => parseGitHubBlobUrl('https://github.com/someuser')).toThrow(/blob/)
  })

  test('throws for a .md file', () => {
    expect(() =>
      parseGitHubBlobUrl('https://github.com/someuser/hooks/blob/main/README.md'),
    ).toThrow(/\.ts.*\.js|\.js.*\.ts/)
  })

  test('throws for an empty string', () => {
    expect(() => parseGitHubBlobUrl('')).toThrow()
  })

  test('throws for garbage input', () => {
    expect(() => parseGitHubBlobUrl('not a url at all %%%')).toThrow()
  })
})

describe('toRawUrl', () => {
  test('produces correct raw URL for a top-level file', () => {
    const info: GitHubBlobInfo = {
      owner: 'someuser',
      repo: 'hooks',
      ref: 'main',
      path: 'lint-guard.ts',
      filename: 'lint-guard.ts',
      filenameStem: 'lint-guard',
    }
    expect(toRawUrl(info)).toBe(
      'https://raw.githubusercontent.com/someuser/hooks/main/lint-guard.ts',
    )
  })

  test('produces correct raw URL for a nested path', () => {
    const info: GitHubBlobInfo = {
      owner: 'someuser',
      repo: 'hooks',
      ref: 'main',
      path: 'src/hooks/lint-guard.ts',
      filename: 'lint-guard.ts',
      filenameStem: 'lint-guard',
    }
    expect(toRawUrl(info)).toBe(
      'https://raw.githubusercontent.com/someuser/hooks/main/src/hooks/lint-guard.ts',
    )
  })

  test('produces correct raw URL for a SHA ref', () => {
    const info: GitHubBlobInfo = {
      owner: 'someuser',
      repo: 'hooks',
      ref: 'abc1234567890',
      path: 'lint-guard.ts',
      filename: 'lint-guard.ts',
      filenameStem: 'lint-guard',
    }
    expect(toRawUrl(info)).toBe(
      'https://raw.githubusercontent.com/someuser/hooks/abc1234567890/lint-guard.ts',
    )
  })

  test('produces correct raw URL for a tag ref', () => {
    const info: GitHubBlobInfo = {
      owner: 'someuser',
      repo: 'hooks',
      ref: 'v1.0.0',
      path: 'lint-guard.ts',
      filename: 'lint-guard.ts',
      filenameStem: 'lint-guard',
    }
    expect(toRawUrl(info)).toBe(
      'https://raw.githubusercontent.com/someuser/hooks/v1.0.0/lint-guard.ts',
    )
  })

  test('produces correct raw URL for a .js file', () => {
    const info = parseGitHubBlobUrl(
      'https://github.com/someuser/hooks/blob/main/dist/lint-guard.js',
    )
    expect(toRawUrl(info)).toBe(
      'https://raw.githubusercontent.com/someuser/hooks/main/dist/lint-guard.js',
    )
  })

  test('round-trips through parseGitHubBlobUrl for query-string URL', () => {
    const info = parseGitHubBlobUrl(
      'https://github.com/someuser/hooks/blob/main/lint-guard.ts?foo=bar',
    )
    expect(toRawUrl(info)).toBe(
      'https://raw.githubusercontent.com/someuser/hooks/main/lint-guard.ts',
    )
  })
})

describe('classifyGitHubInput', () => {
  test('blob URL is classified as blob with correct GitHubBlobInfo', () => {
    const result = classifyGitHubInput('https://github.com/someuser/hooks/blob/main/lint-guard.ts')
    expect(result.type).toBe('blob')
    if (result.type === 'blob') {
      expect(result.info.owner).toBe('someuser')
      expect(result.info.repo).toBe('hooks')
      expect(result.info.ref).toBe('main')
      expect(result.info.path).toBe('lint-guard.ts')
      expect(result.info.filename).toBe('lint-guard.ts')
      expect(result.info.filenameStem).toBe('lint-guard')
    }
  })

  test('repo URL is classified as repo with correct owner/repo', () => {
    const result = classifyGitHubInput('https://github.com/someuser/security-hooks')
    expect(result.type).toBe('repo')
    if (result.type === 'repo') {
      expect(result.info.owner).toBe('someuser')
      expect(result.info.repo).toBe('security-hooks')
    }
  })

  test('repo URL with trailing path is classified as repo', () => {
    const result = classifyGitHubInput('https://github.com/someuser/security-hooks/tree/main')
    expect(result.type).toBe('repo')
    if (result.type === 'repo') {
      expect(result.info.owner).toBe('someuser')
      expect(result.info.repo).toBe('security-hooks')
    }
  })

  test('shorthand owner/repo is classified as repo with expanded URL', () => {
    const result = classifyGitHubInput('someuser/security-hooks')
    expect(result.type).toBe('repo')
    if (result.type === 'repo') {
      expect(result.info.owner).toBe('someuser')
      expect(result.info.repo).toBe('security-hooks')
      expect(result.info.url).toBe('https://github.com/someuser/security-hooks')
    }
  })

  test('invalid input (not a URL, not a shorthand) throws', () => {
    expect(() => classifyGitHubInput('not-valid-at-all')).toThrow(
      'Expected a GitHub URL or owner/repo shorthand',
    )
  })

  test('non-GitHub URL throws', () => {
    expect(() => classifyGitHubInput('https://gitlab.com/someuser/security-hooks')).toThrow(
      'Expected a GitHub URL or owner/repo shorthand',
    )
  })

  test('shorthand with leading dot throws', () => {
    expect(() => classifyGitHubInput('./local/path')).toThrow(
      'Expected a GitHub URL or owner/repo shorthand',
    )
  })

  test('repo URL with trailing slash is handled correctly', () => {
    const result = classifyGitHubInput('https://github.com/someuser/security-hooks/')
    expect(result.type).toBe('repo')
    if (result.type === 'repo') {
      expect(result.info.owner).toBe('someuser')
      expect(result.info.repo).toBe('security-hooks')
      expect(result.info.url).toBe('https://github.com/someuser/security-hooks')
    }
  })
})
