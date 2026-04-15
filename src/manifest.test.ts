import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { validateManifest, fetchManifest, loadManifestFromFile } from './manifest.js'

const validManifest = {
  version: 1,
  name: 'my-hook-pack',
  description: 'A collection of security hooks',
  author: 'someuser',
  license: 'MIT',
  repository: 'https://github.com/someuser/security-hooks',
  hooks: {
    'lint-guard': {
      path: 'hooks/lint-guard.ts',
      description: 'Blocks lint errors from being committed',
      events: ['PreToolUse'],
      tags: ['safety', 'lint'],
      configDefaults: { strict: true },
    },
    'no-bare-mv': {
      path: 'hooks/no-bare-mv.ts',
      description: 'Prevents bare mv commands',
      events: ['PreToolUse', 'PostToolUse'],
    },
  },
}

describe('validateManifest', () => {
  test('valid manifest with all fields parses correctly', () => {
    const result = validateManifest(validManifest)
    expect(result.version).toBe(1)
    expect(result.name).toBe('my-hook-pack')
    expect(result.description).toBe('A collection of security hooks')
    expect(result.author).toBe('someuser')
    expect(result.license).toBe('MIT')
    expect(result.repository).toBe('https://github.com/someuser/security-hooks')
    expect(Object.keys(result.hooks)).toHaveLength(2)
    const lintGuard = result.hooks['lint-guard']!
    expect(lintGuard.path).toBe('hooks/lint-guard.ts')
    expect(lintGuard.events).toEqual(['PreToolUse'])
    expect(lintGuard.tags).toEqual(['safety', 'lint'])
    expect(lintGuard.configDefaults).toEqual({ strict: true })
  })

  test('valid manifest with only required fields parses correctly', () => {
    const minimal = {
      version: 1,
      name: 'minimal-pack',
      hooks: {
        'my-hook': {
          path: 'hooks/my-hook.ts',
          description: 'Does something useful',
        },
      },
    }
    const result = validateManifest(minimal)
    expect(result.version).toBe(1)
    expect(result.name).toBe('minimal-pack')
    expect(result.description).toBeUndefined()
    const myHook = result.hooks['my-hook']!
    expect(myHook.events).toBeUndefined()
    expect(myHook.tags).toBeUndefined()
  })

  test('missing version throws error', () => {
    const { version: _, ...noVersion } = validManifest
    expect(() => validateManifest(noVersion)).toThrow(/version/)
  })

  test('wrong version (e.g., 2) throws error', () => {
    expect(() => validateManifest({ ...validManifest, version: 2 })).toThrow(/version/)
  })

  test('empty hooks object throws error', () => {
    expect(() => validateManifest({ ...validManifest, hooks: {} })).toThrow(/hooks/)
  })

  test('hook with missing path throws error', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my-hook': { description: 'A hook' },
      },
    }
    expect(() => validateManifest(manifest)).toThrow(/path/)
  })

  test('hook with invalid path extension throws error', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my-hook': { path: 'hooks/my-hook.md', description: 'A hook' },
      },
    }
    expect(() => validateManifest(manifest)).toThrow(/\.ts.*\.js|\.js.*\.ts|path must end/)
  })

  test('hook with missing description throws error', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my-hook': { path: 'hooks/my-hook.ts' },
      },
    }
    expect(() => validateManifest(manifest)).toThrow(/description/)
  })

  test('hook name that is a reserved event name throws error', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        // "PreToolUse" is a reserved event name and doesn't match the HOOK_NAME_PATTERN anyway
        // Use a lowercase version that would pass the pattern but is reserved:
        // Actually event names use PascalCase — they won't match [a-z][a-z0-9-]* pattern anyway
        // Let's test with a hook name that is literally an event name
        PreToolUse: { path: 'hooks/pre-tool-use.ts', description: 'A hook' },
      },
    }
    // "PreToolUse" doesn't match HOOK_NAME_PATTERN (starts uppercase), so it throws pattern error first
    expect(() => validateManifest(manifest)).toThrow(/Invalid clooks-pack\.json/)
  })

  test('hook name with uppercase characters throws error', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        MyHook: { path: 'hooks/my-hook.ts', description: 'A hook' },
      },
    }
    expect(() => validateManifest(manifest)).toThrow(/Invalid clooks-pack\.json/)
  })

  test('hook name with dots throws error', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my.hook': { path: 'hooks/my-hook.ts', description: 'A hook' },
      },
    }
    expect(() => validateManifest(manifest)).toThrow(/Invalid clooks-pack\.json/)
  })

  test('events array with unknown event name throws error', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my-hook': {
          path: 'hooks/my-hook.ts',
          description: 'A hook',
          events: ['UnknownEvent'],
        },
      },
    }
    expect(() => validateManifest(manifest)).toThrow(/unknown event/)
  })

  test('events array with valid event names passes', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my-hook': {
          path: 'hooks/my-hook.ts',
          description: 'A hook',
          events: ['PreToolUse', 'PostToolUse'],
        },
      },
    }
    const result = validateManifest(manifest)
    expect(result.hooks['my-hook']!.events).toEqual(['PreToolUse', 'PostToolUse'])
  })

  test('tags array with uppercase string throws error', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my-hook': {
          path: 'hooks/my-hook.ts',
          description: 'A hook',
          tags: ['Safety'],
        },
      },
    }
    expect(() => validateManifest(manifest)).toThrow(/lowercase/)
  })

  test('tags array with all lowercase strings passes', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my-hook': {
          path: 'hooks/my-hook.ts',
          description: 'A hook',
          tags: ['safety', 'lint', 'security'],
        },
      },
    }
    const result = validateManifest(manifest)
    expect(result.hooks['my-hook']!.tags).toEqual(['safety', 'lint', 'security'])
  })

  test('unknown top-level field in manifest is accepted (forward compatibility)', () => {
    const manifest = {
      ...validManifest,
      unknownField: 'some-value',
      anotherUnknown: 42,
    }
    expect(() => validateManifest(manifest)).not.toThrow()
    const result = validateManifest(manifest)
    expect(result.name).toBe(validManifest.name)
  })

  test('unknown field in hook entry is accepted (forward compatibility)', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my-hook': {
          path: 'hooks/my-hook.ts',
          description: 'A hook',
          unknownHookField: 'extra-data',
        },
      },
    }
    expect(() => validateManifest(manifest)).not.toThrow()
  })

  test('autoEnable: true is accepted and returned', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my-hook': {
          path: 'hooks/my-hook.ts',
          description: 'A hook',
          autoEnable: true,
        },
      },
    }
    const result = validateManifest(manifest)
    expect(result.hooks['my-hook']!.autoEnable).toBe(true)
  })

  test('autoEnable: false is accepted and returned', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my-hook': {
          path: 'hooks/my-hook.ts',
          description: 'A hook',
          autoEnable: false,
        },
      },
    }
    const result = validateManifest(manifest)
    expect(result.hooks['my-hook']!.autoEnable).toBe(false)
  })

  test('autoEnable omitted returns undefined', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my-hook': {
          path: 'hooks/my-hook.ts',
          description: 'A hook',
        },
      },
    }
    const result = validateManifest(manifest)
    expect(result.hooks['my-hook']!.autoEnable).toBeUndefined()
  })

  test('autoEnable with non-boolean string value throws error', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my-hook': {
          path: 'hooks/my-hook.ts',
          description: 'A hook',
          autoEnable: 'yes',
        },
      },
    }
    expect(() => validateManifest(manifest)).toThrow(/autoEnable.*boolean/)
  })

  test('autoEnable with number value throws error', () => {
    const manifest = {
      ...validManifest,
      hooks: {
        'my-hook': {
          path: 'hooks/my-hook.ts',
          description: 'A hook',
          autoEnable: 1,
        },
      },
    }
    expect(() => validateManifest(manifest)).toThrow(/autoEnable.*boolean/)
  })
})

describe('fetchManifest', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('fetchManifest with mocked 200 returns parsed manifest', async () => {
    const mockManifest = {
      version: 1,
      name: 'fetched-pack',
      hooks: {
        'fetched-hook': {
          path: 'hooks/fetched-hook.ts',
          description: 'A fetched hook',
        },
      },
    }

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(mockManifest),
      } as Response),
    ) as unknown as typeof fetch

    const result = await fetchManifest('someuser', 'security-hooks')
    expect(result.name).toBe('fetched-pack')
    expect(result.hooks['fetched-hook']!.description).toBe('A fetched hook')
  })

  test('fetchManifest with mocked 404 throws descriptive error', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.reject(new Error('not json')),
      } as Response),
    ) as unknown as typeof fetch

    await expect(fetchManifest('someuser', 'nonexistent-repo')).rejects.toThrow(
      'No clooks-pack.json found',
    )
  })

  test('fetchManifest with mocked invalid JSON throws descriptive error', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      } as Response),
    ) as unknown as typeof fetch

    await expect(fetchManifest('someuser', 'bad-json-repo')).rejects.toThrow(
      'Failed to parse clooks-pack.json',
    )
  })
})

describe('loadManifestFromFile', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-manifest-file-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('reads a valid JSON file and returns a Manifest', () => {
    const filePath = join(tempDir, 'clooks-pack.json')
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        name: 'file-pack',
        hooks: {
          'file-hook': {
            path: 'hooks/file-hook.ts',
            description: 'A hook loaded from file',
          },
        },
      }),
    )

    const result = loadManifestFromFile(filePath)
    expect(result.version).toBe(1)
    expect(result.name).toBe('file-pack')
    expect(result.hooks['file-hook']!.description).toBe('A hook loaded from file')
  })

  test('throws on non-existent file', () => {
    expect(() => loadManifestFromFile(join(tempDir, 'does-not-exist.json'))).toThrow()
  })

  test('throws on invalid JSON content', () => {
    const filePath = join(tempDir, 'bad.json')
    writeFileSync(filePath, 'not valid json {{{{')
    expect(() => loadManifestFromFile(filePath)).toThrow()
  })

  test('throws on valid JSON but invalid manifest (missing required fields)', () => {
    const filePath = join(tempDir, 'incomplete.json')
    writeFileSync(filePath, JSON.stringify({ version: 1 }))
    expect(() => loadManifestFromFile(filePath)).toThrow(/name/)
  })
})
