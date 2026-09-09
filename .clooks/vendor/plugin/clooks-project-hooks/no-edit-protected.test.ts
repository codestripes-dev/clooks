import { describe, expect, test } from 'bun:test'
import type { PreToolUseContext } from "./types"
import { hook, globToRegex, normalizePath } from "./no-edit-protected"

function makeCtx(overrides: Partial<PreToolUseContext> = {}): PreToolUseContext {
  return {
    event: 'PreToolUse',
    toolName: 'Write',
    toolInput: { filePath: '/home/user/project/test.ts', content: 'hello' },
    originalToolInput: { filePath: '/home/user/project/test.ts', content: 'hello' },
    toolUseId: 'tu-test',
    sessionId: 'test-session',
    cwd: '/home/user/project',
    permissionMode: 'default',
    transcriptPath: '/tmp/transcript.jsonl',
    allow: (opts = {}) => ({ result: 'allow', ...opts }),
    block: (opts) => ({ result: 'block', ...opts }),
    skip: (opts = {}) => ({ result: 'skip', ...opts }),
    ask: (opts) => ({ result: 'ask', ...opts }),
    defer: (opts = {}) => ({ result: 'defer', ...opts }),
    ...overrides,
  }
}

const DEFAULT_CONFIG = {
  "lock-files": true,
  "vendor-dirs": true,
  "minified-assets": true,
  rules: [],
}

// --- Section 1: globToRegex unit tests ---

describe('globToRegex', () => {
  test.each([
    // Empty pattern (produces ^$ — only matches empty string)
    ['',                     'foo.ts',                  false],

    // Exact match (no wildcards)
    ['package-lock.json',    'package-lock.json',       true],
    ['package-lock.json',    'sub/package-lock.json',   false],  // root-only
    ['yarn.lock',            'yarn.lock',               true],

    // Single * (does not cross /)
    ['src/*',                'src/foo.ts',              true],
    ['src/*',                'src/deep/foo.ts',         false],  // * stops at /
    ['*.ts',                 'foo.ts',                  true],
    ['*.ts',                 'src/foo.ts',              false],  // no leading path

    // ** (crosses /)
    ['src/**',               'src/foo.ts',              true],
    ['src/**',               'src/deep/foo.ts',         true],
    ['src/**',               'src/a/b/c/d.ts',          true],

    // **/ at start (zero or more leading dirs)
    ['**/vendor/**',         'vendor/foo.js',           true],   // ** matches zero dirs
    ['**/vendor/**',         'deep/vendor/foo.js',      true],
    ['**/vendor/**',         'a/b/vendor/c/d.ts',       true],
    ['**/vendor/**',         'vendor.ts',               false],  // no trailing /
    ['**/vendored/**',       'vendored/lib.js',         true],
    ['**/vendored/**',       'lib/vendored/pkg/a.js',   true],

    // **/*.ext (any depth, matching extension)
    ['**/*.min.js',          'app.min.js',              true],
    ['**/*.min.js',          'dist/app.min.js',         true],
    ['**/*.min.js',          'a/b/app.min.js',          true],
    ['**/*.min.js',          'app.js',                  false],  // not .min.js
    ['**/*.min.css',         'style.min.css',           true],

    // ? (single character)
    ['?.ts',                 'a.ts',                    true],
    ['?.ts',                 'ab.ts',                   false],
    ['?.ts',                 '/a.ts',                   false],  // ? doesn't match /

    // Complex patterns
    ['src/module_bindings/**',  'src/module_bindings/types.ts',       true],
    ['src/module_bindings/**',  'src/module_bindings/deep/nested.ts', true],
    ['src/module_bindings/**',  'src/other/types.ts',                 false],
    ['generated/**',           'generated/foo.ts',                    true],
    ['generated/**',           'generated/deep/bar.ts',              true],
    ['*.generated.ts',         'foo.generated.ts',                    true],
    ['*.generated.ts',         'src/foo.generated.ts',                false],  // * doesn't cross /
  ])('pattern "%s" vs path "%s" → %s', (pattern, path, expected) => {
    expect(globToRegex(pattern).test(path)).toBe(expected)
  })
})

// --- Section 2: normalizePath unit tests ---

describe('normalizePath', () => {
  test.each([
    // Normal case
    ['/home/user/project/src/foo.ts', '/home/user/project',  'src/foo.ts'],
    ['/home/user/project/src/foo.ts', '/home/user/project/', 'src/foo.ts'],

    // Root-level file
    ['/home/user/project/package.json', '/home/user/project', 'package.json'],

    // File outside project
    ['/tmp/other/file.ts',           '/home/user/project',   null],

    // Tricky prefix (project-other should NOT match project)
    ['/home/user/project-other/f.ts', '/home/user/project',  null],

    // Nested deeply
    ['/home/user/project/a/b/c/d.ts', '/home/user/project',  'a/b/c/d.ts'],

    // Empty cwd — guard returns null
    ['/home/user/project/foo.ts',     '',                     null],

    // filePath equals cwd (directory, not a file) — returns null
    ['/home/user/project',            '/home/user/project',   null],
  ])('normalizePath(%s, %s) → %s', (filePath, cwd, expected) => {
    expect(normalizePath(filePath, cwd)).toBe(expected)
  })
})

// --- Section 3: hook.PreToolUse integration tests ---

describe('hook.PreToolUse', () => {

  // --- Guard: skips non-target tools ---
  test.each([
    ['Read'],
    ['Bash'],
    ['Glob'],
    ['Grep'],
    ['NotebookEdit'],
  ])('skips tool %s', (toolName) => {
    const ctx = makeCtx({ toolName, toolInput: { filePath: '/home/user/project/yarn.lock' } })
    const result = hook.PreToolUse!(ctx, DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  // --- Guard: skips empty/missing filePath ---
  test('skips empty filePath', () => {
    const ctx = makeCtx({ toolInput: { filePath: '' } })
    expect(hook.PreToolUse!(ctx, DEFAULT_CONFIG)).toEqual({ result: 'skip' })
  })

  test('skips missing filePath', () => {
    const ctx = makeCtx({ toolInput: {} })
    expect(hook.PreToolUse!(ctx, DEFAULT_CONFIG)).toEqual({ result: 'skip' })
  })

  test('skips non-string filePath', () => {
    const ctx = makeCtx({ toolInput: { filePath: 123 } })
    expect(hook.PreToolUse!(ctx, DEFAULT_CONFIG)).toEqual({ result: 'skip' })
  })

  // --- Guard: skips file outside project ---
  test('skips file outside project', () => {
    const ctx = makeCtx({ toolInput: { filePath: '/tmp/other/file.ts' } })
    expect(hook.PreToolUse!(ctx, DEFAULT_CONFIG)).toEqual({ result: 'skip' })
  })

  // --- Built-in: lock-files ---
  test.each([
    ['package-lock.json'],
    ['yarn.lock'],
    ['pnpm-lock.yaml'],
    ['bun.lockb'],
    ['Gemfile.lock'],
    ['poetry.lock'],
    ['Pipfile.lock'],
    ['composer.lock'],
    ['Cargo.lock'],
    ['go.sum'],
    ['flake.lock'],
    ['pubspec.lock'],
  ])('blocks lock file %s via Write', (filename) => {
    const ctx = makeCtx({
      toolName: 'Write',
      toolInput: { filePath: `/home/user/project/${filename}` },
    })
    const result = hook.PreToolUse!(ctx, DEFAULT_CONFIG) as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[no-edit-protected]')
    expect(result.reason).toContain('lock-files')
    expect(result.reason).toContain('Do not modify')
  })

  // --- False positive: package.json is NOT a lock file ---
  test('allows package.json (not a lock file)', () => {
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/package.json' },
    })
    expect(hook.PreToolUse!(ctx, DEFAULT_CONFIG)).toEqual({ result: 'skip' })
  })

  // --- Built-in: lock-files via Edit and MultiEdit ---
  test('blocks lock file via Edit', () => {
    const ctx = makeCtx({
      toolName: 'Edit',
      toolInput: { filePath: '/home/user/project/yarn.lock' },
    })
    const result = hook.PreToolUse!(ctx, DEFAULT_CONFIG) as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[no-edit-protected]')
    expect(result.reason).toContain('lock-files')
  })

  test('blocks lock file via MultiEdit', () => {
    const ctx = makeCtx({
      toolName: 'MultiEdit',
      toolInput: { filePath: '/home/user/project/pnpm-lock.yaml' },
    })
    const result = hook.PreToolUse!(ctx, DEFAULT_CONFIG) as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[no-edit-protected]')
    expect(result.reason).toContain('lock-files')
  })

  // --- Built-in: vendor-dirs ---
  test.each([
    ['vendor/foo.js'],
    ['deep/vendor/foo.js'],
    ['lib/vendored/pkg.ts'],
  ])('blocks vendor path %s', (path) => {
    const ctx = makeCtx({
      toolInput: { filePath: `/home/user/project/${path}` },
    })
    const result = hook.PreToolUse!(ctx, DEFAULT_CONFIG) as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('vendor')
  })

  // --- False positive: vendor.ts is NOT a vendor dir ---
  test('allows vendor.ts (file named vendor, not dir)', () => {
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/vendor.ts' },
    })
    expect(hook.PreToolUse!(ctx, DEFAULT_CONFIG)).toEqual({ result: 'skip' })
  })

  // --- Built-in: minified-assets ---
  test.each([
    ['dist/app.min.js'],
    ['assets/style.min.css'],
    ['lib/module.min.mjs'],
    ['deep/nested/app.min.js'],
  ])('blocks minified asset %s', (path) => {
    const ctx = makeCtx({
      toolInput: { filePath: `/home/user/project/${path}` },
    })
    const result = hook.PreToolUse!(ctx, DEFAULT_CONFIG) as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('minified')
  })

  // --- False positive: app.js is NOT a minified asset ---
  test('allows app.js (not .min.js)', () => {
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/dist/app.js' },
    })
    expect(hook.PreToolUse!(ctx, DEFAULT_CONFIG)).toEqual({ result: 'skip' })
  })

  // --- Config: disable built-in rules ---
  test('lock-files disabled via config', () => {
    const config = { ...DEFAULT_CONFIG, "lock-files": false }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/yarn.lock' },
    })
    expect(hook.PreToolUse!(ctx, config)).toEqual({ result: 'skip' })
  })

  test('vendor-dirs disabled via config', () => {
    const config = { ...DEFAULT_CONFIG, "vendor-dirs": false }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/vendor/foo.js' },
    })
    expect(hook.PreToolUse!(ctx, config)).toEqual({ result: 'skip' })
  })

  test('minified-assets disabled via config', () => {
    const config = { ...DEFAULT_CONFIG, "minified-assets": false }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/dist/app.min.js' },
    })
    expect(hook.PreToolUse!(ctx, config)).toEqual({ result: 'skip' })
  })

  // --- Custom rules ---
  test('custom rule blocks matching path', () => {
    const config = {
      ...DEFAULT_CONFIG,
      rules: [{
        pattern: 'src/module_bindings/**',
        message: "Auto-generated. Run 'bun run spacetime:generate' instead.",
      }],
    }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/src/module_bindings/types.ts' },
    })
    const result = hook.PreToolUse!(ctx, config) as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('spacetime:generate')
    expect(result.reason).toContain('src/module_bindings/**')
  })

  test('custom rule allows non-matching path', () => {
    const config = {
      ...DEFAULT_CONFIG,
      rules: [{
        pattern: 'src/module_bindings/**',
        message: "Auto-generated.",
      }],
    }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/src/utils/helper.ts' },
    })
    expect(hook.PreToolUse!(ctx, config)).toEqual({ result: 'skip' })
  })

  // --- Custom rules with except ---
  test('except pattern allows otherwise-blocked path', () => {
    const config = {
      ...DEFAULT_CONFIG,
      rules: [{
        pattern: 'generated/**',
        message: "Generated file. Run 'make codegen' to regenerate.",
        except: ['generated/overrides.ts'],
      }],
    }
    // Blocked: generated/foo.ts
    const ctxBlocked = makeCtx({
      toolInput: { filePath: '/home/user/project/generated/foo.ts' },
    })
    const resultBlocked = hook.PreToolUse!(ctxBlocked, config) as Record<string, unknown>
    expect(resultBlocked.result).toBe('block')

    // Allowed: generated/overrides.ts (excepted)
    const ctxAllowed = makeCtx({
      toolInput: { filePath: '/home/user/project/generated/overrides.ts' },
    })
    expect(hook.PreToolUse!(ctxAllowed, config)).toEqual({ result: 'skip' })
  })

  // --- Built-in rules checked before custom rules ---
  test('built-in rules take precedence over custom rules', () => {
    const config = {
      ...DEFAULT_CONFIG,
      rules: [{
        pattern: 'yarn.lock',
        message: 'Custom message for yarn.lock',
      }],
    }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/yarn.lock' },
    })
    const result = hook.PreToolUse!(ctx, config) as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('lock-files')  // built-in, not custom
  })

  // --- Multiple custom rules: first match wins ---
  test('first matching custom rule wins', () => {
    const config = {
      ...DEFAULT_CONFIG,
      rules: [
        { pattern: 'generated/**', message: 'First rule' },
        { pattern: 'generated/**', message: 'Second rule' },
      ],
    }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/generated/foo.ts' },
    })
    const result = hook.PreToolUse!(ctx, config) as Record<string, unknown>
    expect(result.reason).toContain('First rule')
  })

  // --- Empty rules array: hook is a noop for custom rules ---
  test('empty rules array means no custom blocking', () => {
    const config = {
      "lock-files": false,
      "vendor-dirs": false,
      "minified-assets": false,
      rules: [],
    }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/anything.ts' },
    })
    expect(hook.PreToolUse!(ctx, config)).toEqual({ result: 'skip' })
  })

  // --- Block message format ---
  test('block message includes hook name, rule, and guidance', () => {
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/yarn.lock' },
    })
    const result = hook.PreToolUse!(ctx, DEFAULT_CONFIG) as Record<string, unknown>
    const reason = result.reason as string
    expect(reason).toContain('[no-edit-protected]')
    expect(reason).toContain('Blocked: yarn.lock')
    expect(reason).toContain('Rule: lock-files')
  })

  // --- debugMessage format ---
  test('debugMessage follows convention', () => {
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/yarn.lock' },
    })
    const result = hook.PreToolUse!(ctx, DEFAULT_CONFIG) as Record<string, unknown>
    expect(result.debugMessage).toContain('no-edit-protected:')
    expect(result.debugMessage).toContain('lock-files')
  })

  // --- New file in protected directory (FEAT-0051 Decisions: "New files | Blocked") ---
  test('blocks Write of new file in protected directory', () => {
    const config = {
      ...DEFAULT_CONFIG,
      rules: [{
        pattern: 'generated/**',
        message: "Generated file. Run 'make codegen' to regenerate.",
      }],
    }
    // A file that doesn't exist yet — Write creates it. The directory is protected.
    const ctx = makeCtx({
      toolName: 'Write',
      toolInput: { filePath: '/home/user/project/generated/brand-new-helper.ts' },
    })
    const result = hook.PreToolUse!(ctx, config) as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('generated/**')
  })

  // --- False positive: except pattern exempts path matching rule pattern ---
  test('false positive: except pattern exempts path that matches rule', () => {
    const config = {
      ...DEFAULT_CONFIG,
      rules: [{
        pattern: 'generated/**',
        message: "Generated file.",
        except: ['generated/overrides.ts'],
      }],
    }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/generated/overrides.ts' },
    })
    // This path matches the rule pattern but is excluded by except — deliberately allowed
    expect(hook.PreToolUse!(ctx, config)).toEqual({ result: 'skip' })
  })

  // --- except with glob pattern (not just literal) ---
  test('except supports glob patterns', () => {
    const config = {
      ...DEFAULT_CONFIG,
      rules: [{
        pattern: 'generated/**',
        message: "Generated file.",
        except: ['generated/*.override.ts'],
      }],
    }
    // Excepted by glob pattern
    const ctxExcepted = makeCtx({
      toolInput: { filePath: '/home/user/project/generated/config.override.ts' },
    })
    expect(hook.PreToolUse!(ctxExcepted, config)).toEqual({ result: 'skip' })

    // Not excepted — still blocked
    const ctxBlocked = makeCtx({
      toolInput: { filePath: '/home/user/project/generated/config.ts' },
    })
    const result = hook.PreToolUse!(ctxBlocked, config) as Record<string, unknown>
    expect(result.result).toBe('block')
  })

  // --- Non-matching except pattern does not prevent blocking ---
  // Note: globToRegex escapes all regex-special characters, so `[` becomes `\[`
  // producing a valid regex that simply doesn't match. The try/catch in the except
  // handler is defense-in-depth for future glob matcher changes.
  test('non-matching except pattern does not prevent blocking', () => {
    const config = {
      ...DEFAULT_CONFIG,
      rules: [{
        pattern: 'generated/**',
        message: "Generated file.",
        except: ['[invalid-glob'],
      }],
    }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/generated/foo.ts' },
    })
    const result = hook.PreToolUse!(ctx, config) as Record<string, unknown>
    expect(result.result).toBe('block')
  })

  // --- Design boundary: except is not supported on built-in rules ---
  // Built-in rules use boolean toggles, not per-rule except arrays.
  // To add exceptions to a built-in, disable it and recreate as a custom rule.
  test('design boundary: disable built-in + custom rule with except is the correct workaround', () => {
    const config = {
      ...DEFAULT_CONFIG,
      "lock-files": false,  // disable built-in
      rules: [{
        pattern: 'package-lock.json',
        message: "Lock file \u2014 use npm install.",
        // except not needed here, but tests the disable+custom-rule pattern
      }],
    }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/package-lock.json' },
    })
    const result = hook.PreToolUse!(ctx, config) as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('package-lock.json')  // custom rule, not built-in
    expect(result.reason).not.toContain('lock-files')
  })

  // --- Edge case: filePath equals cwd (directory path) ---
  test('skips when filePath equals cwd (directory path, not a file)', () => {
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project' },
    })
    expect(hook.PreToolUse!(ctx, DEFAULT_CONFIG)).toEqual({ result: 'skip' })
  })

  // --- Defensive: config.rules undefined/null ---
  test('skips gracefully when config.rules is undefined', () => {
    const config = { "lock-files": false, "vendor-dirs": false, "minified-assets": false }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/src/anything.ts' },
    })
    expect(hook.PreToolUse!(ctx, config as any)).toEqual({ result: 'skip' })
  })

  test('skips gracefully when config.rules is null', () => {
    const config = { ...DEFAULT_CONFIG, rules: null }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/src/anything.ts' },
    })
    expect(hook.PreToolUse!(ctx, config as any)).toEqual({ result: 'skip' })
  })

  // --- Boundary: except is NOT a global allowlist ---
  // False positive guard: except only applies when the main pattern also matches.
  // A path matching only the except pattern is unaffected by the rule.
  test('except does not allowlist a path outside the main pattern scope', () => {
    const config = {
      ...DEFAULT_CONFIG,
      rules: [{
        pattern: 'generated/**',
        message: "Generated file.",
        except: ['src/overrides.ts'],
      }],
    }
    const ctx = makeCtx({
      toolInput: { filePath: '/home/user/project/src/overrides.ts' },
    })
    expect(hook.PreToolUse!(ctx, config)).toEqual({ result: 'skip' })
  })
})
