import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PreToolUseContext, AgentId } from './types'
import {
  classifyPath,
  DEFAULT_ALLOWLIST,
  expandGlob,
  extractTargets,
  findProjectRoot,
  getSegments,
  hasEscapeHatch,
  hasGlobChars,
  hasRecursiveFlag,
  hasVariableExpansion,
  hook,
  resolveTilde,
  sanitize,
  stripEnvPrefix,
  SYSTEM_TOP_LEVEL,
  type VerdictTag,
} from './no-rm-rf'

// ---------------------------------------------------------------------------
// Test helpers + fixtures
// ---------------------------------------------------------------------------

type Config = {
  [key: string]: boolean | string[] | undefined
  extraAllowlist?: string[]
  strictMode?: boolean
}

const DEFAULT_CONFIG: Config = {
  'rm-rf-no-project-root': true,
  'rm-rf-no-preserve-root': true,
  'rm-rf-unresolved-var': true,
  'rm-rf-globstar': true,
  'rm-rf-dangerous-glob-unbypassable': true,
  'rm-rf-expansion-error': true,
  'rm-rf-home': true,
  'rm-rf-root': true,
  'rm-rf-project-root': true,
  'rm-rf-escape': true,
  'rm-rf-strict': true,
  extraAllowlist: [],
  strictMode: false,
}

function withConfig(overrides: Partial<Config>): Config {
  return { ...DEFAULT_CONFIG, ...overrides }
}

function makeCtx(
  command: unknown,
  toolName = 'Bash',
  cwd = '/tmp',
  agent: AgentId = 'codex',
): PreToolUseContext {
  return {
    event: 'PreToolUse',
    agent,
    toolName,
    toolInput: { command },
    originalToolInput: { command },
    toolUseId: 'tu-test',
    sessionId: 'test-session',
    cwd,
    permissionMode: 'default',
    transcriptPath: '/tmp/transcript.jsonl',
    allow: (opts = {}) => ({ result: 'allow', ...opts }),
    block: (opts) => ({ result: 'block', ...opts }),
    skip: (opts = {}) => ({ result: 'skip', ...opts }),
    ask: (opts) => ({ result: 'ask', ...opts }),
    defer: (opts = {}) => ({ result: 'defer', ...opts }),
  } as unknown as PreToolUseContext
}

// Fixture root under /tmp so findProjectRoot's git step fails and the walk-up
// branch decides. Scoped per-pid so concurrent runs don't collide. We use
// node:fs APIs only — NEVER shell out to rm -rf during cleanup.
const FIXTURE_ROOT = join(tmpdir(), `clooks-no-rm-rf-m2-${process.pid}`)

const TMP_IS_IN_GIT_REPO = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: tmpdir(),
}).status === 0
const describeIfTmpOutsideGit = TMP_IS_IN_GIT_REPO ? describe.skip : describe

if (TMP_IS_IN_GIT_REPO) {
  console.warn(
    '[no-rm-rf.test.ts] WARNING: tmpdir() is inside a git repo; integration tests are being skipped. ' +
    'Run in an environment where /tmp is outside any git tree to get full coverage.'
  )
}

/** Create a clooks-enabled project fixture and return its absolute path. */
function mkProject(subdir: string): string {
  const proj = join(FIXTURE_ROOT, subdir)
  mkdirSync(join(proj, '.clooks'), { recursive: true })
  writeFileSync(join(proj, '.clooks', 'clooks.yml'), 'hooks: []\n')
  return proj
}

// ---------------------------------------------------------------------------
// SECTION 1 — Helper unit tests (extends M1 with expandGlob cases)
// ---------------------------------------------------------------------------

describe('sanitize', () => {
  test.each<[string, string, string]>([
    ['strips single-quoted content entirely', "rm -rf 'foo && bar'", 'rm -rf '],
    ['preserves double-quoted content for var detection', 'rm -rf "$HOME/dist"', 'rm -rf $HOME/dist'],
    ['strips end-of-line comments', 'rm -rf foo # cleanup', 'rm -rf foo '],
    ['strips quote chars but keeps spaces inside double quotes', 'rm -rf "/tmp with space"', 'rm -rf /tmp with space'],
    ['passes plain commands through', 'rm -rf build', 'rm -rf build'],
    ['single-quote strip runs before double-quote peel', `rm -rf '"nested"'`, 'rm -rf '],
  ])('%s', (_label, input, expected) => {
    expect(sanitize(input)).toBe(expected)
  })
})

describe('getSegments', () => {
  test.each<[string, string, string[]]>([
    ['splits on &&',      'rm -rf a && rm -rf b', ['rm -rf a', 'rm -rf b']],
    ['splits on ;',       'rm -rf a; ls',         ['rm -rf a', 'ls']],
    ['splits on |',       'echo foo | rm -rf /',  ['echo foo', 'rm -rf /']],
    ['splits on ||',      'rm -rf a || echo ok',  ['rm -rf a', 'echo ok']],
    ['single segment',    'rm -rf a',             ['rm -rf a']],
    ['drops empties',     'rm -rf a ;; ls',       ['rm -rf a', 'ls']],
  ])('%s', (_label, input, expected) => {
    expect(getSegments(input)).toEqual(expected)
  })
})

describe('stripEnvPrefix', () => {
  test.each<[string, string, { prefix: string[]; rest: string }]>([
    ['single env prefix',   'ALLOW_DESTRUCTIVE_RM=true rm -rf x', { prefix: ['ALLOW_DESTRUCTIVE_RM=true'], rest: 'rm -rf x' }],
    ['multiple env prefix', 'A=1 B=2 rm -rf x',                   { prefix: ['A=1', 'B=2'],                rest: 'rm -rf x' }],
    ['no prefix',           'rm -rf x',                            { prefix: [],                            rest: 'rm -rf x' }],
    ['empty value prefix',  'FOO= rm -rf x',                       { prefix: ['FOO='],                      rest: 'rm -rf x' }],
  ])('%s', (_label, input, expected) => {
    expect(stripEnvPrefix(input)).toEqual(expected)
  })
})

describe('hasEscapeHatch', () => {
  test.each<[string, string[], boolean]>([
    ['exact literal match',            ['ALLOW_DESTRUCTIVE_RM=true'],       true],
    ['lowercase does not match',       ['allow_destructive_rm=true'],       false],
    ['empty prefix',                   [],                                   false],
    ['ALLOW_DESTRUCTIVE_RM=false',     ['ALLOW_DESTRUCTIVE_RM=false'],       false],
    ['mixed with other vars',          ['FOO=1', 'ALLOW_DESTRUCTIVE_RM=true'], true],
    ['wrong key',                      ['ALLOW_DESTRUCTIVE_GIT=true'],       false],
  ])('%s', (_label, input, expected) => {
    expect(hasEscapeHatch(input)).toBe(expected)
  })
})

describe('hasRecursiveFlag', () => {
  test.each<[string, string, boolean]>([
    ['short -rf flag',                      'rm -rf x',            true],
    ['short -r flag',                       'rm -r x',             true],
    ['short -R flag (uppercase)',           'rm -R x',             true],
    ['combined -fr flag order',             'rm -fr x',            true],
    ['combined -Rf mixed case',             'rm -Rf x',            true],
    ['combined -fR mixed case',             'rm -fR x',            true],
    ['long --recursive flag',               'rm --recursive x',    true],
    ['combined -rfv with verbose',          'rm -rfv x',           true],
    ['combined -rfI with interactive',      'rm -rfI x',           true],
    ['combined -vfr with verbose first',    'rm -vfr x',           true],
    ['no flags, bare rm',                   'rm x',                false],
    ['force-only -f, no recursion',         'rm -f x',             false],
    ['verbose-only -v, no recursion',       'rm -v x',             false],
    ['non-rm command (echo)',               'echo r',              false],
    ['fully-qualified /usr/bin/rm with -rf', '/usr/bin/rm -rf x',  true],
    ['fully-qualified /bin/rm with -r',     '/bin/rm -r y',        true],
    ['relative ./rm with -R',               './rm -R z',           true],
    ['vim false positive with -rf',         'vim -rf file.txt',    false],
    // End-of-options regression: recursive flag detected BEFORE `--` still wins;
    // tokens that look like flags AFTER `--` are targets, not flags.
    ['end-of-options: -rf before -- still detected', 'rm -rf -- file',       true],
    ['end-of-options: -r after -- is a target, not a flag', 'rm -- -r',     false],
  ])('%s', (_label, input, expected) => {
    expect(hasRecursiveFlag(input)).toBe(expected)
  })
})

describe('extractTargets', () => {
  test.each<[string, string, string[]]>([
    ['multi-arg with tilde',              'rm -rf /tmp/build ~',              ['/tmp/build', '~']],
    ['multiple bare-name targets',        'rm -rf build dist node_modules',   ['build', 'dist', 'node_modules']],
    ['long flag --verbose skipped',       'rm -r --verbose a b',              ['a', 'b']],
    ['no targets after flags',            'rm -rf',                           []],
    ['fully-qualified /usr/bin/rm path',  '/usr/bin/rm -rf x',                ['x']],
    ['fully-qualified /bin/rm path',      '/bin/rm -rf y',                    ['y']],
    ['relative ./rm path',                './rm -rf z',                       ['z']],
    ['vim false positive yields no targets', 'vim -rf file.txt',              []],
    ['combined long flags --force --recursive', 'rm --force --recursive a',   ['a']],
    // End-of-options `--` regression tests (FAIL-OPEN fix): tokens after `--`
    // must be treated as literal targets even when they start with `-`.
    ['end-of-options: single dash-prefixed target', 'rm -rf -- --filename',   ['--filename']],
    ['end-of-options: multiple dash-prefixed targets', 'rm -rf -- -dir1 -dir2', ['-dir1', '-dir2']],
    ['end-of-options: second -- is literal target', 'rm -rf -- -- file.txt',  ['--', 'file.txt']],
    ['end-of-options: mixed before and after',    'rm -rf file1 -- file2',    ['file1', 'file2']],
  ])('%s', (_label, input, expected) => {
    expect(extractTargets(input)).toEqual(expected)
  })
})

describe('hasVariableExpansion', () => {
  test.each<[string, boolean]>([
    ['$HOME',          true],
    ['${BUILD}',       true],
    ['${VAR:-default}', true],
    ['$(find)',        true],
    ['`cmd`',          true],
    ['$1',             true],
    ['$#',             true],
    ['/tmp',           false],
    ['~user',          false],
    ['~',              false],
    ['node_modules',   false],
  ])('%s', (input, expected) => {
    expect(hasVariableExpansion(input)).toBe(expected)
  })
})

describe('hasGlobChars', () => {
  test.each<[string, boolean]>([
    ['*.log',       true],
    ['src/*',       true],
    ['[abc].ts',    true],
    ['foo?bar',     true],
    ['/tmp/build',  false],
    ['node_modules', false],
    ['~',           false],
  ])('%s', (input, expected) => {
    expect(hasGlobChars(input)).toBe(expected)
  })
})

describe('resolveTilde', () => {
  const HOME = '/home/alice'
  const savedOldPwd = process.env.OLDPWD
  const savedCwd = process.cwd()

  test.each<[string, string, string]>([
    ['bare tilde',          '~',           HOME],
    ['tilde slash path',    '~/build',     `${HOME}/build`],
    ['unknown user literal','~bob/src',    '~bob/src'],
    ['absolute path',       '/tmp',        '/tmp'],
    ['relative path',       'build/dist',  'build/dist'],
  ])('%s', (_label, input, expected) => {
    expect(resolveTilde(input, HOME)).toBe(expected)
  })

  test('~+ expands to cwd', () => {
    expect(resolveTilde('~+', HOME)).toBe(process.cwd())
    expect(resolveTilde('~+/x', HOME)).toBe(`${process.cwd()}/x`)
  })

  test('~- expands to OLDPWD when set', () => {
    process.env.OLDPWD = '/tmp/previous'
    try {
      expect(resolveTilde('~-', HOME)).toBe('/tmp/previous')
      expect(resolveTilde('~-/x', HOME)).toBe('/tmp/previous/x')
    } finally {
      if (savedOldPwd === undefined) delete process.env.OLDPWD
      else process.env.OLDPWD = savedOldPwd
    }
  })

  test('~- falls back to home when OLDPWD is unset', () => {
    const original = process.env.OLDPWD
    delete process.env.OLDPWD
    try {
      expect(resolveTilde('~-', HOME)).toBe(HOME)
    } finally {
      if (original !== undefined) process.env.OLDPWD = original
    }
  })

  test('resolveTilde is pure wrt cwd', () => {
    expect(process.cwd()).toBe(savedCwd)
  })
})

describeIfTmpOutsideGit('findProjectRoot (walk-up fallback)', () => {
  const FR_ROOT = join(tmpdir(), `clooks-no-rm-rf-m1-${process.pid}`)
  const PROJECT_DIR = join(FR_ROOT, 'findProjectRoot', 'proj')
  const NESTED_DIR = join(PROJECT_DIR, 'src', 'a', 'b')
  const ORPHAN_DIR = join(FR_ROOT, 'findProjectRoot', 'orphan')

  beforeAll(() => {
    mkdirSync(join(PROJECT_DIR, '.clooks'), { recursive: true })
    writeFileSync(join(PROJECT_DIR, '.clooks', 'clooks.yml'), 'hooks: []\n')
    mkdirSync(NESTED_DIR, { recursive: true })
    mkdirSync(ORPHAN_DIR, { recursive: true })
  })

  afterAll(() => {
    rmSync(FR_ROOT, { recursive: true, force: true })
  })

  test('returns the directory containing .clooks/clooks.yml when called at its root', () => {
    expect(findProjectRoot(PROJECT_DIR)).toBe(PROJECT_DIR)
  })

  test('walks up from a nested directory to find .clooks/clooks.yml', () => {
    expect(findProjectRoot(NESTED_DIR)).toBe(PROJECT_DIR)
  })

  test('returns null on a directory with no .clooks/clooks.yml marker outside any git tree', () => {
    expect(findProjectRoot(ORPHAN_DIR)).toBeNull()
  })

  test('returns null when called on tmpdir() itself', () => {
    expect(findProjectRoot(tmpdir())).toBeNull()
  })
})

describe('classifyPath', () => {
  const HOME = '/home/alice'
  const PROJECT = '/proj'
  const withAllowlist = (extras: string[]) => new Set<string>([...DEFAULT_ALLOWLIST, ...extras])

  test.each<[string, string, VerdictTag]>([
    ['home exact',                  '/home/alice',                  'home'],
    ['home subpath',                '/home/alice/build',            'home'],
    ['home with trailing slash',    '/home/alice/',                 'home'],
    ['other user home (regex)',     '/home/bob/src',                'home'],
    ['other user home exact (no subtree)', '/home/bob',             'home'],
    ['Users regex (macOS)',         '/Users/carol/dev',             'home'],
    ['macOS user home exact',       '/Users/carol',                 'home'],
    ['literal tilde passthrough',   '~bob/src',                     'home'],
    ['literal tilde alone',         '~',                            'home'],
    ['filesystem root',             '/',                            'root'],
    ['system top level /etc',       '/etc',                         'root'],
    ['system subpath /etc/foo',     '/etc/foo',                     'root'],
    ['system top level /usr',       '/usr/bin',                     'root'],
    ['project-root exact',          '/proj',                        'project-root'],
    ['escape outside project',      '/other',                       'escape'],
    ['strict inside project',       '/proj/src',                    'strict'],
    ['allow node_modules',          '/proj/node_modules',           'allow'],
    ['allow nested under allowlist','/proj/node_modules/foo/bar',   'allow'],
    ['allow dist',                  '/proj/dist',                   'allow'],
    ['allow venv',                  '/proj/venv',                   'allow'],
    ['allow .venv',                 '/proj/.venv',                  'allow'],
  ])('%s → %s', (_label, input, expected) => {
    expect(classifyPath(input, PROJECT, HOME, withAllowlist([]))).toBe(expected)
  })

  test('extraAllowlist grants allow for custom dirs', () => {
    expect(classifyPath('/proj/generated', PROJECT, HOME, withAllowlist(['generated']))).toBe('allow')
    expect(classifyPath('/proj/generated', PROJECT, HOME, withAllowlist([]))).toBe('strict')
  })

  // Project-in-home / project-in-system ordering: project-root containment MUST
  // win over home/system-top-level when the project itself lives under one of
  // those paths. Common case: a project in /home/<user>/ or under /tmp.
  test.each<[string, string, string, string, VerdictTag]>([
    ['project inside home — node_modules classifies as allow',
      '/home/alice/myrepo/node_modules', '/home/alice/myrepo', '/home/alice', 'allow'],
    ['project inside home — src classifies as strict',
      '/home/alice/myrepo/src',          '/home/alice/myrepo', '/home/alice', 'strict'],
    ['project inside home — project root itself classifies as project-root',
      '/home/alice/myrepo',              '/home/alice/myrepo', '/home/alice', 'project-root'],
    ['project under /tmp — build classifies as allow',
      '/tmp/myproj/build',               '/tmp/myproj',        '/home/alice', 'allow'],
    ['project under /tmp — src classifies as strict',
      '/tmp/myproj/src',                 '/tmp/myproj',        '/home/alice', 'strict'],
  ])('%s', (_label, path, projectRoot, home, expected) => {
    expect(classifyPath(path, projectRoot, home, withAllowlist([]))).toBe(expected)
  })

  test('default allowlist contains venv + .venv', () => {
    expect(DEFAULT_ALLOWLIST).toContain('venv')
    expect(DEFAULT_ALLOWLIST).toContain('.venv')
  })

  test('SYSTEM_TOP_LEVEL contains canonical system dirs', () => {
    expect(SYSTEM_TOP_LEVEL.has('/etc')).toBe(true)
    expect(SYSTEM_TOP_LEVEL.has('/usr')).toBe(true)
    expect(SYSTEM_TOP_LEVEL.has('/home')).toBe(true)
  })
})

describeIfTmpOutsideGit('expandGlob', () => {
  const ROOT = join(FIXTURE_ROOT, 'expandGlob')

  beforeAll(() => {
    mkdirSync(ROOT, { recursive: true })
    mkdirSync(join(ROOT, 'plain'), { recursive: true })
    writeFileSync(join(ROOT, 'plain', 'a.tmp'), '')
    writeFileSync(join(ROOT, 'plain', 'b.tmp'), '')
    writeFileSync(join(ROOT, 'plain', 'c.keep'), '')
  })

  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  test('returns matches for a simple glob', () => {
    const result = expandGlob('plain/*.tmp', ROOT)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.paths.length).toBe(2)
      expect(result.paths.every(p => p.endsWith('.tmp'))).toBe(true)
    }
  })

  test('returns empty matches for non-matching glob', () => {
    const result = expandGlob('plain/*.nonexistent', ROOT)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.paths).toEqual([])
  })

  test('returns empty (not error) when scan parent does not exist', () => {
    const result = expandGlob('no-such-dir/*', ROOT)
    // Either Bun.Glob throws or audit returns empty; we don't strictly enforce
    // a particular ok state here — just that the hook doesn't crash.
    if (!result.ok) expect(typeof result.errno === 'string').toBe(true)
  })

  test('returns ELOOP_GUARD when a matching entry is a symlink', () => {
    // Create a harmless-target symlink INSIDE the fixture. NEVER point at /etc
    // or any real system path — the hook checks lstat().isSymbolicLink() only,
    // so target identity is irrelevant to the assertion.
    const symlinkRoot = join(FIXTURE_ROOT, 'eloop-unit')
    mkdirSync(symlinkRoot, { recursive: true })
    const target = join(symlinkRoot, 'sandbox-target')
    mkdirSync(target, { recursive: true })
    const link = join(symlinkRoot, 'sym')
    symlinkSync(target, link)
    try {
      const result = expandGlob('sym', symlinkRoot)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errno).toBe('ELOOP_GUARD')
        expect(result.failedPath).toBe(link)
      }
    } finally {
      rmSync(symlinkRoot, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// SECTION 2 — Per-rule tests
// ---------------------------------------------------------------------------

describeIfTmpOutsideGit('rule: rm-rf-no-project-root', () => {
  const ORPHAN = join(FIXTURE_ROOT, 'orphan-no-root')

  beforeAll(() => {
    mkdirSync(ORPHAN, { recursive: true })
  })

  afterAll(() => {
    rmSync(ORPHAN, { recursive: true, force: true })
  })

  test('blocks rm -rf in a cwd with no project root', () => {
    const result = hook.PreToolUse!(makeCtx('rm -rf build', 'Bash', ORPHAN), DEFAULT_CONFIG) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-no-project-root]')
    expect(result.reason).toContain(ORPHAN)
  })

  test('escape hatch bypasses rm-rf-no-project-root', () => {
    const result = hook.PreToolUse!(makeCtx('ALLOW_DESTRUCTIVE_RM=true rm -rf build', 'Bash', ORPHAN), DEFAULT_CONFIG)
    expect(result.result).toBe('skip')
  })

  test('disabling rm-rf-no-project-root via config skips', () => {
    const cfg = withConfig({ 'rm-rf-no-project-root': false })
    const result = hook.PreToolUse!(makeCtx('rm -rf build', 'Bash', ORPHAN), cfg)
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('rule: rm-rf-no-preserve-root', () => {
  let proj: string
  const ORIGINAL_HOME = process.env.HOME
  beforeAll(() => {
    proj = mkProject('proj-no-preserve-root')
    process.env.HOME = '/home/alice'
  })
  afterAll(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.HOME
    else process.env.HOME = ORIGINAL_HOME
    rmSync(proj, { recursive: true, force: true })
  })

  test('blocks --no-preserve-root unbypassably', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf --no-preserve-root /', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-no-preserve-root]')
    expect(result.reason).toContain('disables GNU rm')
  })

  test('escape hatch does NOT bypass --no-preserve-root', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_RM=true rm -rf --no-preserve-root /', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-no-preserve-root]')
  })

  test('does NOT false-positive on --no-progress', () => {
    // Hypothetical: some rm variant with --no-progress. Our regex must require
    // exact --no-preserve-root. Use a token that starts with --no-p.
    const result = hook.PreToolUse!(
      makeCtx('rm -rf --no-progress build', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    // build is inside project, not allowlisted → strict ask (or allow if build
    // is in the allowlist — which it IS by default). So either ask or allow.
    expect(result.result).not.toBe('block')
  })

  test('allows plain rm with no --no-preserve-root', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf node_modules', 'Bash', proj),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })

  test('regression (CR-1): disabling rule 2 does NOT fail open on other targets in same segment', () => {
    // When rm-rf-no-preserve-root is disabled in config, the --no-preserve-root
    // flag must NOT short-circuit the segment — downstream classification of ~
    // must still fire and produce a block on rm-rf-home.
    const cfg = withConfig({ 'rm-rf-no-preserve-root': false })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf --no-preserve-root ~', 'Bash', proj),
      cfg,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-home]')
  })

  test('disabling rm-rf-no-preserve-root via config returns skip on isolated trigger', () => {
    // With rule 2 off, `--no-preserve-root` alone is no longer blocked.
    // node_modules is allowlisted by default, so classification produces no
    // entries — the whole command returns skip. (Using `/` as the target would
    // still fire rule 8, so we pick node_modules to isolate rule 2.)
    const cfg = withConfig({ 'rm-rf-no-preserve-root': false })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf --no-preserve-root node_modules', 'Bash', proj),
      cfg,
    )
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('rule: rm-rf-unresolved-var', () => {
  let proj: string
  beforeAll(() => { proj = mkProject('proj-unresolved-var') })
  afterAll(() => { rmSync(proj, { recursive: true, force: true }) })

  test('blocks rm -rf $BUILD/x', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf $BUILD/x', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-unresolved-var]')
    expect(result.reason).toContain('contains a shell variable')
  })

  test('blocks "$HOME/build" (double-quoted preserves $)', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf "$HOME/build"', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-unresolved-var]')
  })

  test('escape hatch bypasses rm-rf-unresolved-var', () => {
    // With escape, the $BUILD token is skipped by the rule — result may still
    // block/ask on other targets. Use a single bare-var target with no follow-on
    // classification.
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_RM=true rm -rf $BUILD/x', 'Bash', proj),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })

  test('blocks subshell $(cmd)', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf $(find .)', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
  })

  test('blocks backtick', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf `cmd`', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
  })

  test('disabling rm-rf-unresolved-var via config returns skip on a var-only trigger', () => {
    // When rule 3 is off, the target token still has an unresolved variable
    // and the handler `continue`s past classification for that target (the
    // hook never attempts to resolve vars itself). No other entries produced
    // → skip.
    const cfg = withConfig({ 'rm-rf-unresolved-var': false })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf $FOO/node_modules', 'Bash', proj),
      cfg,
    )
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('rule: rm-rf-globstar', () => {
  let proj: string
  beforeAll(() => { proj = mkProject('proj-globstar') })
  afterAll(() => { rmSync(proj, { recursive: true, force: true }) })

  test('blocks rm -rf src/**/*', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf src/**/*', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-globstar]')
    expect(result.reason).toContain("bash's globstar")
  })

  test('blocks bare **/*', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf **/*', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-globstar]')
  })

  test('escape hatch bypasses rm-rf-globstar', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_RM=true rm -rf src/**/*', 'Bash', proj),
      DEFAULT_CONFIG,
    )
    // Token is skipped for this rule; no other target, so no classification entries.
    expect(result.result).toBe('skip')
  })

  test('disabling rm-rf-globstar via config returns skip on a globstar-only trigger', () => {
    // With rule 4 off, the `**`-containing target `continue`s past
    // classification (the handler does not attempt to expand globstars). No
    // classification entries → skip.
    const cfg = withConfig({ 'rm-rf-globstar': false })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf build/**/*', 'Bash', proj),
      cfg,
    )
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('rule: rm-rf-dangerous-glob-unbypassable', () => {
  let proj: string
  beforeAll(() => { proj = mkProject('proj-dangerous-glob') })
  afterAll(() => { rmSync(proj, { recursive: true, force: true }) })

  test('blocks .*', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf .*', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-dangerous-glob-unbypassable]')
    expect(result.reason).toContain('.*')
    expect(result.reason).toContain('matches `..`')
  })

  test('blocks /*', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf /*', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-dangerous-glob-unbypassable]')
  })

  test('escape hatch does NOT bypass dangerous glob', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_RM=true rm -rf .*', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-dangerous-glob-unbypassable]')
  })

  test('disabling rm-rf-dangerous-glob-unbypassable via config returns skip on .*', () => {
    // Documentation says this should never be disabled. But if a user does,
    // the handler `continue`s past the rule without falling through to
    // expansion (no Bun.Glob scan of `.*` — safety of the implementation).
    // Result: skip, nothing else classifies.
    const cfg = withConfig({ 'rm-rf-dangerous-glob-unbypassable': false })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf .*', 'Bash', proj),
      cfg,
    )
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('rule: rm-rf-expansion-error (EACCES)', () => {
  let proj: string
  let locked: string
  beforeEach(() => {
    proj = mkProject('proj-eacces')
    locked = join(proj, 'locked')
    mkdirSync(locked, { recursive: true })
    writeFileSync(join(locked, 'x.tmp'), '')
    chmodSync(locked, 0o000)
  })
  afterEach(() => {
    // Restore permissions BEFORE rmSync so cleanup doesn't hang.
    try { chmodSync(locked, 0o755) } catch { /* ignore */ }
    rmSync(proj, { recursive: true, force: true })
  })

  test('blocks with EACCES expansion error', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf locked/*.tmp', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-expansion-error]')
    expect(result.reason).toContain('EACCES')
  })

  test('escape hatch bypasses expansion-error', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_RM=true rm -rf locked/*.tmp', 'Bash', proj),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })

  test('disabling rm-rf-expansion-error via config returns skip on EACCES', () => {
    // With rule 6 off, the expansion failure is silently swallowed and the
    // handler `continue`s past (no classification entry produced). Result: skip.
    // This is the documented fail-open path — the rule is intentionally
    // fail-closed by default.
    const cfg = withConfig({ 'rm-rf-expansion-error': false })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf locked/*.tmp', 'Bash', proj),
      cfg,
    )
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('rule: rm-rf-expansion-error (ELOOP_GUARD symlink regression)', () => {
  // CRITICAL REGRESSION TEST: verifies the symlink-audit pass catches symlinks
  // that Bun.Glob would silently drop. The symlink points to a HARMLESS path
  // INSIDE the fixture (not /etc or any real system path) — the hook only
  // checks lstat().isSymbolicLink(), not the target.
  let proj: string
  let build: string
  let elsewhere: string
  beforeEach(() => {
    proj = mkProject('proj-eloop-guard')
    build = join(proj, 'build')
    mkdirSync(build, { recursive: true })
    writeFileSync(join(build, 'legit.o'), '')
    // Create a harmless sandbox target and symlink to it. NOT /etc.
    elsewhere = join(proj, 'elsewhere')
    mkdirSync(elsewhere, { recursive: true })
    symlinkSync(elsewhere, join(build, 'cache'))
  })
  afterEach(() => {
    rmSync(proj, { recursive: true, force: true })
  })

  test('blocks rm -rf build/* citing the symlink as ELOOP_GUARD', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf build/*', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-expansion-error]')
    expect(result.reason).toContain('ELOOP_GUARD')
    expect(result.reason).toContain(join(build, 'cache'))
  })

  test('escape hatch bypasses ELOOP_GUARD', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_RM=true rm -rf build/*', 'Bash', proj),
      DEFAULT_CONFIG,
    )
    // With escape hatch, expansion-error (flag-bypassable) is skipped. The
    // token is not expanded, so no classification contribution. No aggregated
    // entries → skip.
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('rule: rm-rf-home', () => {
  let proj: string
  const ORIGINAL_HOME = process.env.HOME
  beforeAll(() => {
    proj = mkProject('proj-home')
    process.env.HOME = '/home/alice'
  })
  afterAll(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.HOME
    else process.env.HOME = ORIGINAL_HOME
    rmSync(proj, { recursive: true, force: true })
  })

  test('blocks rm -rf ~ with resolved home path in reason', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf ~', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-home]')
    expect(result.reason).toContain('/home/alice')
    expect(result.reason).toContain('recursively delete your entire home')
  })

  test('blocks rm -rf /home/bob (other-user home)', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf /home/bob', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-home]')
  })

  test('blocks rm -rf ~bob (other-user tilde form)', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf ~bob/projects', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-home]')
  })

  test('escape hatch does NOT bypass rm-rf-home', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_RM=true rm -rf ~', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-home]')
  })

  test('disabling rm-rf-home via config returns skip', () => {
    const cfg = withConfig({ 'rm-rf-home': false })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf ~', 'Bash', proj),
      cfg,
    )
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('rule: rm-rf-root', () => {
  let proj: string
  beforeAll(() => { proj = mkProject('proj-root') })
  afterAll(() => { rmSync(proj, { recursive: true, force: true }) })

  test('blocks rm -rf /etc', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf /etc', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-root]')
    expect(result.reason).toContain('targets a system directory')
  })

  test('blocks rm -rf /', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf /', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-root]')
  })

  test('blocks rm -rf /usr/local', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf /usr/local', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
  })

  test('escape hatch does NOT bypass rm-rf-root', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_RM=true rm -rf /etc', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-root]')
  })

  test('disabling rm-rf-root via config returns skip on /etc', () => {
    // With rule 8 off, classification still tags the path as 'root' but
    // shouldApply returns false, so no entry is pushed. Result: skip.
    const cfg = withConfig({ 'rm-rf-root': false })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf /etc', 'Bash', proj),
      cfg,
    )
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('rule: rm-rf-project-root', () => {
  let proj: string
  beforeAll(() => { proj = mkProject('proj-root-self') })
  afterAll(() => { rmSync(proj, { recursive: true, force: true }) })

  for (const agent of ['claude-code', 'codex'] as const) {
    test(`asks on rm -rf . at project root for ${agent}`, () => {
      const result = hook.PreToolUse!(
        makeCtx('rm -rf .', 'Bash', proj, agent),
        DEFAULT_CONFIG,
      ) as { result: string; debugMessage?: string; question?: string; reason?: string }
      expect(result.result).toBe('ask')
      expect(result.question).toBe('Delete this project and its contents?')
      expect(result.reason).toBe(`This deletes the entire project at ${proj}, including its Git metadata.`)
      expect(result.debugMessage).toContain('rm-rf-project-root')
    })
  }

  test('strictMode promotes rm-rf-project-root ask → block', () => {
    const cfg = withConfig({ strictMode: true })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf .', 'Bash', proj),
      cfg,
    ) as { result: string; question?: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.question).toBeUndefined()
    expect(result.reason).toContain('[rm-rf-project-root]')
  })

  test('ALLOW_DESTRUCTIVE_RM=true does NOT bypass project-root (ask rule)', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_RM=true rm -rf .', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; debugMessage?: string; question?: string; reason?: string }
    expect(result.result).toBe('ask')
    expect(result.question).toBe('Delete this project and its contents?')
    expect(result.reason).toBe(`This deletes the entire project at ${proj}, including its Git metadata.`)
    expect(result.debugMessage).toContain('rm-rf-project-root')
  })

  test('disabling rm-rf-project-root via config returns skip on rm -rf .', () => {
    const cfg = withConfig({ 'rm-rf-project-root': false })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf .', 'Bash', proj),
      cfg,
    )
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('rule: rm-rf-escape', () => {
  let proj: string
  let sub: string
  beforeAll(() => {
    proj = mkProject('proj-escape')
    sub = join(proj, 'sub')
    mkdirSync(sub, { recursive: true })
  })
  afterAll(() => { rmSync(proj, { recursive: true, force: true }) })

  test('blocks escape (../ outside project root)', () => {
    // Use a single step up (../ from proj root goes to fixture root, which is
    // under /tmp). Since /tmp is a SYSTEM_TOP_LEVEL, classification may pick
    // rm-rf-root OR rm-rf-escape depending on ordering — both are correct
    // fail-closed verdicts for "path outside the project". Assert block + one
    // of the two reason prefixes.
    const result = hook.PreToolUse!(
      makeCtx('rm -rf ../../other', 'Bash', sub),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(
      result.reason?.includes('[rm-rf-escape]') ||
      result.reason?.includes('[rm-rf-root]'),
    ).toBe(true)
    // Anchor on the canonical body: at least one of the two reasons fires.
    expect(
      result.reason?.includes('outside the project root') ||
      result.reason?.includes('targets a system directory'),
    ).toBe(true)
  })

  test('classifyPath returns escape for a path outside project and outside system tops', () => {
    // Direct unit-style assertion on classifyPath with synthetic paths that
    // sidestep the /tmp-under-system-top issue.
    const tag = classifyPath('/other', '/proj', '/home/alice', new Set<string>(DEFAULT_ALLOWLIST))
    expect(tag).toBe('escape')
  })

  test('escape hatch bypasses rm-rf-escape', () => {
    // Use an absolute target that is not under any SYSTEM_TOP_LEVEL so it
    // classifies as escape (not root). /workspace is not in the protected
    // top-level set, so with escape hatch the rule-10 deny is bypassed → skip.
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_RM=true rm -rf /workspace/other', 'Bash', sub),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })

  test('disabling rm-rf-escape via config returns skip on a genuine escape target', () => {
    // Use /workspace/other (not under any SYSTEM_TOP_LEVEL) so classification
    // produces 'escape', not 'root'. With rule 10 off, no entry is pushed →
    // skip. Using ../ here would hit /tmp (a system top-level) and fire rule 8
    // instead, making this assertion unreliable.
    const cfg = withConfig({ 'rm-rf-escape': false })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf /workspace/other', 'Bash', sub),
      cfg,
    )
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('rule: rm-rf-strict', () => {
  let proj: string
  beforeAll(() => {
    proj = mkProject('proj-strict')
    mkdirSync(join(proj, 'src'), { recursive: true })
  })
  afterAll(() => { rmSync(proj, { recursive: true, force: true }) })

  for (const agent of ['claude-code', 'codex'] as const) {
    test(`asks on rm -rf src inside project for ${agent}`, () => {
      const result = hook.PreToolUse!(
        makeCtx('rm -rf src', 'Bash', proj, agent),
        DEFAULT_CONFIG,
      ) as { result: string; debugMessage?: string; question?: string; reason?: string }
      expect(result.result).toBe('ask')
      expect(result.question).toBe('Delete this path and its contents?')
      expect(result.reason).toBe(`"${join(proj, 'src')}" is not on the cleanup allowlist.`)
      expect(result.debugMessage).toContain('rm-rf-strict')
    })
  }

  test('extraAllowlist grants allow (skip) for src', () => {
    const cfg = withConfig({ extraAllowlist: ['src'] })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf src', 'Bash', proj),
      cfg,
    ) as { result: string; question?: string }
    expect(result.result).toBe('skip')
    expect(result.question).toBeUndefined()
  })

  test('strictMode promotes rm-rf-strict ask → block', () => {
    const cfg = withConfig({ strictMode: true })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf src', 'Bash', proj),
      cfg,
    ) as { result: string; question?: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.question).toBeUndefined()
    expect(result.reason).toContain('[rm-rf-strict]')
  })

  test('ALLOW_DESTRUCTIVE_RM=true does NOT bypass rm-rf-strict', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_RM=true rm -rf src', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; debugMessage?: string; question?: string; reason?: string }
    expect(result.result).toBe('ask')
    expect(result.question).toBe('Delete this path and its contents?')
    expect(result.reason).toBe(`"${join(proj, 'src')}" is not on the cleanup allowlist.`)
    expect(result.debugMessage).toContain('rm-rf-strict')
  })

  test('disabling rm-rf-strict via config returns skip on rm -rf src', () => {
    const cfg = withConfig({ 'rm-rf-strict': false })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf src', 'Bash', proj),
      cfg,
    )
    expect(result.result).toBe('skip')
  })
})

// ---------------------------------------------------------------------------
// SECTION 3 — Pipeline / integration tests
// ---------------------------------------------------------------------------

describeIfTmpOutsideGit('pipeline: multi-arg mixed verdict', () => {
  let proj: string
  const ORIGINAL_HOME = process.env.HOME
  beforeAll(() => {
    proj = mkProject('pipeline-mixed')
    process.env.HOME = '/home/alice'
  })
  afterAll(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.HOME
    else process.env.HOME = ORIGINAL_HOME
    rmSync(proj, { recursive: true, force: true })
  })

  test('rm -rf /tmp/build ~ blocks on home', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf /tmp/build ~', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-home]')
    // /tmp/build is under /tmp (SYSTEM_TOP_LEVEL) → rm-rf-root also fires.
    expect(result.reason).toContain('[rm-rf-root]')
  })

  test('unbypassable deny wins over ask (home + strict in same command)', () => {
    // ensure src/ exists inside the project so it classifies to strict (ask).
    mkdirSync(join(proj, 'src'), { recursive: true })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf ~ src', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; question?: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.question).toBeUndefined()
    expect(result.reason).toContain('[rm-rf-home]')
    expect(result.reason).toContain('[rm-rf-strict]')
  })

  test('multiple strict targets use a plural question and retain each target', () => {
    mkdirSync(join(proj, 'src'), { recursive: true })
    mkdirSync(join(proj, 'docs'), { recursive: true })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf src docs', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; debugMessage?: string; question?: string; reason?: string }
    expect(result.result).toBe('ask')
    expect(result.question).toBe('Delete the selected paths and their contents?')
    expect(result.reason).toBe(
      `"${join(proj, 'src')}" is not on the cleanup allowlist.\n` +
      `"${join(proj, 'docs')}" is not on the cleanup allowlist.`,
    )
    expect(result.debugMessage?.match(/rm-rf-strict/g)).toHaveLength(2)
  })

  test('project root plus another target uses the combined bounded question', () => {
    mkdirSync(join(proj, 'src'), { recursive: true })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf . src', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; debugMessage?: string; question?: string; reason?: string }
    expect(result.result).toBe('ask')
    expect(result.question).toBe('Delete the selected paths and their contents?')
    expect(result.reason).toBe(
      `This deletes the entire project at ${proj}, including its Git metadata.\n` +
      `"${join(proj, 'src')}" is not on the cleanup allowlist.`,
    )
    expect(result.debugMessage).toContain('rm-rf-project-root')
    expect(result.debugMessage).toContain('rm-rf-strict')
  })

  test('cd /tmp && rm -rf ~ blocks on home (per-segment split)', () => {
    const result = hook.PreToolUse!(
      makeCtx('cd /tmp && rm -rf ~', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-home]')
  })

  test('echo foo | rm -rf ~ blocks on home (pipe split)', () => {
    const result = hook.PreToolUse!(
      makeCtx('echo foo | rm -rf ~', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-home]')
  })

  test('escape hatch does NOT beat unbypassable rm-rf-root', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_RM=true rm -rf /etc build', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-root]')
  })
})

describeIfTmpOutsideGit('pipeline: allowlist happy path', () => {
  let proj: string
  beforeAll(() => { proj = mkProject('pipeline-allow') })
  afterAll(() => { rmSync(proj, { recursive: true, force: true }) })

  test('rm -rf node_modules dist .cache → skip', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf node_modules dist .cache', 'Bash', proj),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })

  test('extraAllowlist grants allow for custom dir', () => {
    const cfg = withConfig({ extraAllowlist: ['fixtures'] })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf fixtures', 'Bash', proj),
      cfg,
    )
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('pipeline: glob expansion', () => {
  let proj: string
  beforeEach(() => {
    proj = mkProject('pipeline-glob')
  })
  afterEach(() => {
    rmSync(proj, { recursive: true, force: true })
  })

  test('glob expanding to allowlisted-only → skip', () => {
    // Create /proj/build/ with only .o files. build is allowlisted by default.
    const build = join(proj, 'build')
    mkdirSync(build, { recursive: true })
    writeFileSync(join(build, 'a.o'), '')
    writeFileSync(join(build, 'b.o'), '')
    const result = hook.PreToolUse!(
      makeCtx('rm -rf build/*', 'Bash', proj),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })

  test('glob expanding to mixed (node_modules + src) → ask on src', () => {
    // Note: Bun.Glob.scanSync returns files only, not directories. Use a
    // file-matching pattern (*/*) that traverses both node_modules and src.
    mkdirSync(join(proj, 'node_modules'), { recursive: true })
    mkdirSync(join(proj, 'src'), { recursive: true })
    writeFileSync(join(proj, 'node_modules', 'a.txt'), '')
    writeFileSync(join(proj, 'src', 'a.txt'), '')
    const result = hook.PreToolUse!(
      makeCtx('rm -rf */*', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; debugMessage?: string; reason?: string }
    expect(result.result).toBe('ask')
    expect(result.reason).toBe(`"${join(proj, 'src', 'a.txt')}" is not on the cleanup allowlist.`)
    expect(result.debugMessage).toContain('rm-rf-strict')
  })

  test('empty match set → skip (nothing to classify)', () => {
    const build = join(proj, 'build')
    mkdirSync(build, { recursive: true })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf build/*.nonexistent', 'Bash', proj),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })

  test('regression (CR-2): rm -rf * in project with only subdirectories does NOT fail-open', () => {
    // Bun.Glob.scanSync defaults to onlyFiles:true, which would silently drop
    // directory matches and make the classifier see zero targets (→ skip).
    // With onlyFiles:false, the src/ directory matches the glob and classifies
    // as strict → ask. Assertion: NOT skip.
    mkdirSync(join(proj, 'src'), { recursive: true })
    mkdirSync(join(proj, 'lib'), { recursive: true })
    const result = hook.PreToolUse!(
      makeCtx('rm -rf *', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; debugMessage?: string; reason?: string }
    expect(result.result).toBe('ask')
    expect(result.debugMessage).toContain('rm-rf-strict')
  })

  test('brace expansion {src,build}/* → ask on src', () => {
    // Bun.Glob matches files only, so use the /* form to descend into both
    // branches of the brace expansion.
    mkdirSync(join(proj, 'src'), { recursive: true })
    mkdirSync(join(proj, 'build'), { recursive: true })
    writeFileSync(join(proj, 'src', 'a.txt'), '')
    writeFileSync(join(proj, 'build', 'a.txt'), '')
    const result = hook.PreToolUse!(
      makeCtx('rm -rf {src,build}/*', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; debugMessage?: string; reason?: string }
    expect(result.result).toBe('ask')
    expect(result.debugMessage).toContain('rm-rf-strict')
  })
})

describeIfTmpOutsideGit('pipeline: quote-aware tokenization', () => {
  let proj: string
  beforeAll(() => { proj = mkProject('pipeline-quotes') })
  afterAll(() => { rmSync(proj, { recursive: true, force: true }) })

  test('rm -rf "$HOME/build" → block on unresolved-var', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf "$HOME/build"', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-unresolved-var]')
  })

  test('rm -rf $HOME/build (unquoted) → block on unresolved-var', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -rf $HOME/build', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-unresolved-var]')
  })

  test(`rm -rf '$HOME/build' → skip (single-quote content stripped)`, () => {
    const result = hook.PreToolUse!(
      makeCtx(`rm -rf '$HOME/build'`, 'Bash', proj),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })

  test(`echo 'foo "$HOME"' → skip (not an rm command)`, () => {
    const result = hook.PreToolUse!(
      makeCtx(`echo 'foo "$HOME"'`, 'Bash', proj),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('pipeline: flag-order variants', () => {
  let proj: string
  const ORIGINAL_HOME = process.env.HOME
  beforeAll(() => {
    proj = mkProject('pipeline-flags')
    process.env.HOME = '/home/alice'
  })
  afterAll(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.HOME
    else process.env.HOME = ORIGINAL_HOME
    rmSync(proj, { recursive: true, force: true })
  })

  test.each<[string, string]>([
    ['rm -fr ~',        'rm -fr ~'],
    ['rm -Rf ~',        'rm -Rf ~'],
    ['rm -fR ~',        'rm -fR ~'],
    ['rm -rfv ~',       'rm -rfv ~'],
    ['rm --recursive ~','rm --recursive ~'],
  ])('%s blocks on home', (_label, cmd) => {
    const result = hook.PreToolUse!(
      makeCtx(cmd, 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-home]')
  })

  test('rm x (no recursion) → skip', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm x', 'Bash', proj),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })

  test('rm -f x (force no recursion) → skip', () => {
    const result = hook.PreToolUse!(
      makeCtx('rm -f x', 'Bash', proj),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })
})

// ---------------------------------------------------------------------------
// Pipeline regression tests for QA fail-open findings:
//   Fix 1: `rm -rf -- --filename` silently allowed (end-of-options handling)
//   Fix 2: `VAR="a b" rm -rf ...` silently allowed (quoted-env prefix)
// ---------------------------------------------------------------------------

describeIfTmpOutsideGit('pipeline: end-of-options `--` handling (Fix 1 regression)', () => {
  let proj: string
  const ORIGINAL_HOME = process.env.HOME
  beforeAll(() => {
    proj = mkProject('pipeline-end-of-options')
    process.env.HOME = '/home/alice'
  })
  afterAll(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.HOME
    else process.env.HOME = ORIGINAL_HOME
    rmSync(proj, { recursive: true, force: true })
  })

  test('rm -rf -- ~ blocks on home (end-of-options does not hide the target)', () => {
    // Before Fix 1: extractTargets skipped `--` AND `~` (because `~` is after
    // `--`, but we never switched into end-of-options mode). So targets was
    // [] and the hook fell through to skip. After the fix, `~` is treated as
    // a literal target and classifies to home.
    const result = hook.PreToolUse!(
      makeCtx('rm -rf -- ~', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-home]')
  })
})

describeIfTmpOutsideGit('pipeline: quoted-env prefix (Fix 2 regression)', () => {
  let proj: string
  const ORIGINAL_HOME = process.env.HOME
  beforeAll(() => {
    proj = mkProject('pipeline-quoted-env')
    process.env.HOME = '/home/alice'
  })
  afterAll(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.HOME
    else process.env.HOME = ORIGINAL_HOME
    rmSync(proj, { recursive: true, force: true })
  })

  test('VAR="a b" rm -rf ~ blocks on home', () => {
    // Fix 2: sanitize strips the double-quotes, leaving `VAR=a b rm -rf ~`.
    // stripEnvPrefix's regex only peels `VAR=a` (the leftover `b` isn't a
    // valid env-assignment token), leaving rest = `b rm -rf ~`. The handler
    // now runs recursive-flag detection + extractTargets on the FULL segment
    // (not on `rest`), so the rm invocation is found regardless of whether
    // the env prefix got malformed by quote stripping. Target `~` classifies
    // as home → block.
    const result = hook.PreToolUse!(
      makeCtx('VAR="a b" rm -rf ~', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-home]')
  })

  test('VAR="a b c" rm -rf /etc blocks on root (multi-space value)', () => {
    const result = hook.PreToolUse!(
      makeCtx('VAR="a b c" rm -rf /etc', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-root]')
  })

  test('NORMAL=val rm -rf ~ still blocks (non-pathological env prefix)', () => {
    // Sanity: the non-quoted env-prefix path must still produce a block.
    const result = hook.PreToolUse!(
      makeCtx('NORMAL=val rm -rf ~', 'Bash', proj),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-home]')
  })
})

describe('pipeline: basic guards', () => {
  test('non-Bash tool → skip', () => {
    const result = hook.PreToolUse!(makeCtx('rm -rf /', 'Read'), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('empty command → skip', () => {
    const result = hook.PreToolUse!(makeCtx(''), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('non-rm Bash command → skip', () => {
    const result = hook.PreToolUse!(makeCtx('ls -la'), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('non-recursive rm → skip', () => {
    const result = hook.PreToolUse!(makeCtx('rm file.txt'), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })
})

// ---------------------------------------------------------------------------
// SECTION: pipeline short-circuit
// Proves that non-rm Bash commands return 'skip' before findProjectRoot is
// called. The first two tests work regardless of tmpdir's git status (they
// assert skip, which short-circuits before findProjectRoot). The third is a
// negative control that exercises rule 1 and therefore needs tmpdir outside
// any git repo — gated behind describeIfTmpOutsideGit.
// ---------------------------------------------------------------------------

describe('pipeline: short-circuit (no findProjectRoot call on non-rm commands)', () => {
  test('echo hello in orphan cwd returns skip (no rule 1 block)', () => {
    // cwd has no git repo and no .clooks/clooks.yml — findProjectRoot would
    // return null and rule 1 would fire a block. The short-circuit prevents
    // the call entirely, so the hook returns skip without hitting rule 1.
    const orphanCwd = tmpdir()
    const result = hook.PreToolUse!(
      makeCtx('echo hello', 'Bash', orphanCwd),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })

  test('non-recursive rm in orphan cwd returns skip (no rule 1 block)', () => {
    const orphanCwd = tmpdir()
    const result = hook.PreToolUse!(
      makeCtx('rm file.txt', 'Bash', orphanCwd),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })
})

describeIfTmpOutsideGit('pipeline: short-circuit negative control', () => {
  test('recursive rm in orphan cwd still blocks via rule 1', () => {
    // Negative control: confirms findProjectRoot IS called when the segment
    // actually has a recursive rm, so rule 1 fires.
    const orphanCwd = tmpdir()
    const result = hook.PreToolUse!(
      makeCtx('rm -rf foo', 'Bash', orphanCwd),
      DEFAULT_CONFIG,
    ) as { result: string; reason?: string }
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[rm-rf-no-project-root]')
  })
})

// ---------------------------------------------------------------------------
// Compiled-binary smoke test — SKIPPED per plan §2.6 (brittle spawn path).
// The helper + handler tests provide full correctness coverage. Surprise noted
// in the ExecPlan: integration path not verified automatically.
// ---------------------------------------------------------------------------

test.skip('compiled-binary smoke — SKIPPED: brittle spawn path, see plan §2.6', () => {
  // Intentionally blank. Documenting via test.skip so the skip shows in output.
})

// ---------------------------------------------------------------------------
// SECTION — Integration matrix
//
// Broad, shallow sweep of (command, expected verdict) rows driven through
// hook.PreToolUse against a single deterministic fixture. Complementary to
// the per-rule describe blocks above, which probe isolated failure modes in
// depth. This matrix verifies that the full pipeline holds together across
// many input shapes.
//
// SAFETY: this block never executes shell commands. It only constructs
// strings and feeds them to PreToolUse. The hook reads strings and returns
// verdict objects. Fixture operations use node:fs only, scoped to
// /tmp/clooks-no-rm-rf-matrix-<pid>/.
// ---------------------------------------------------------------------------

type MatrixExpected =
  | { verdict: 'skip' }
  | { verdict: 'block'; rule: string }
  | { verdict: 'ask'; rule: string }
  | { verdict: 'block'; rules: string[] }
  | { verdict: 'ask'; rules: string[] }

type MatrixCase = {
  label: string
  command: unknown
  toolName?: string
  config?: Config
  expected: MatrixExpected
}

describeIfTmpOutsideGit('integration matrix: real pipeline, deterministic fixture', () => {
  let FIXTURE_MATRIX_ROOT: string
  let proj: string
  const ORIGINAL_HOME = process.env.HOME

  beforeAll(() => {
    FIXTURE_MATRIX_ROOT = join(tmpdir(), `clooks-no-rm-rf-matrix-${process.pid}`)
    // Node-fs cleanup; NEVER shell out.
    rmSync(FIXTURE_MATRIX_ROOT, { recursive: true, force: true })

    proj = join(FIXTURE_MATRIX_ROOT, 'proj')

    // Project marker so findProjectRoot returns proj via the .clooks walk-up.
    mkdirSync(join(proj, '.clooks'), { recursive: true })
    writeFileSync(join(proj, '.clooks', 'clooks.yml'), '')

    // Allowlisted directories with content.
    mkdirSync(join(proj, 'node_modules', 'some-dep'), { recursive: true })
    writeFileSync(join(proj, 'node_modules', 'some-dep', 'package.json'), '{}')

    mkdirSync(join(proj, 'dist'), { recursive: true })
    writeFileSync(join(proj, 'dist', 'bundle.js'), '// bundle')

    mkdirSync(join(proj, '.cache'), { recursive: true })
    writeFileSync(join(proj, '.cache', 'cache-entry'), 'cache')

    mkdirSync(join(proj, 'build', 'sub'), { recursive: true })
    writeFileSync(join(proj, 'build', 'a.o'), 'obj')
    writeFileSync(join(proj, 'build', 'b.o'), 'obj')
    writeFileSync(join(proj, 'build', 'sub', 'nested.o'), 'obj')

    // Non-allowlisted project dirs.
    mkdirSync(join(proj, 'src'), { recursive: true })
    writeFileSync(join(proj, 'src', 'index.ts'), 'export {}')
    writeFileSync(join(proj, 'src', 'util.ts'), 'export {}')

    mkdirSync(join(proj, 'fixtures'), { recursive: true })
    writeFileSync(join(proj, 'fixtures', 'sample.json'), '{}')

    mkdirSync(join(proj, 'sub', 'deeper'), { recursive: true })

    // Sibling harmless directory outside proj, inside fixture root.
    mkdirSync(join(FIXTURE_MATRIX_ROOT, 'elsewhere'), { recursive: true })
    writeFileSync(join(FIXTURE_MATRIX_ROOT, 'elsewhere', 'harmless.txt'), 'ok')

    // Deterministic HOME so tilde/home rules are stable regardless of runner.
    process.env.HOME = '/home/alice'
  })

  afterAll(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.HOME
    else process.env.HOME = ORIGINAL_HOME
    rmSync(FIXTURE_MATRIX_ROOT, { recursive: true, force: true })
  })

  const CASES: MatrixCase[] = [
    // --- Bucket 1 — non-rm / non-recursive (skip) ---
    { label: 'b1: echo hello', command: 'echo hello', expected: { verdict: 'skip' } },
    { label: 'b1: ls -la', command: 'ls -la', expected: { verdict: 'skip' } },
    { label: 'b1: cat README.md', command: 'cat README.md', expected: { verdict: 'skip' } },
    { label: 'b1: grep foo bar', command: 'grep foo bar', expected: { verdict: 'skip' } },
    { label: 'b1: pwd', command: 'pwd', expected: { verdict: 'skip' } },
    { label: 'b1: true', command: 'true', expected: { verdict: 'skip' } },
    { label: 'b1: false', command: 'false', expected: { verdict: 'skip' } },
    { label: 'b1: rm file.txt (non-recursive)', command: 'rm file.txt', expected: { verdict: 'skip' } },
    { label: 'b1: rm -f file.txt', command: 'rm -f file.txt', expected: { verdict: 'skip' } },
    { label: 'b1: rm *.log (non-recursive glob)', command: 'rm *.log', expected: { verdict: 'skip' } },
    { label: 'b1: rm -i file.txt', command: 'rm -i file.txt', expected: { verdict: 'skip' } },
    { label: 'b1: empty string', command: '', expected: { verdict: 'skip' } },
    { label: 'b1: rm alone', command: 'rm', expected: { verdict: 'skip' } },

    // --- Bucket 3 — rule 2 (no-preserve-root) ---
    {
      // Rule 2 is fatal for the segment — classification is skipped, so rule 8
      // does NOT fire even though `/` would normally be root.
      label: 'b3: --no-preserve-root / (rule 2 short-circuits classification)',
      command: 'rm -rf --no-preserve-root /',
      expected: { verdict: 'block', rule: 'rm-rf-no-preserve-root' },
    },
    {
      label: 'b3: --no-preserve-root /etc (rule 2 short-circuits classification)',
      command: 'rm -rf --no-preserve-root /etc',
      expected: { verdict: 'block', rule: 'rm-rf-no-preserve-root' },
    },
    {
      label: 'b3: --no-preserve-root node_modules (rule 2 fatal, stops classification)',
      command: 'rm -rf --no-preserve-root node_modules',
      expected: { verdict: 'block', rule: 'rm-rf-no-preserve-root' },
    },
    {
      label: 'b3: --no-preserve-root is unbypassable even with ALLOW_DESTRUCTIVE_RM=true',
      command: 'ALLOW_DESTRUCTIVE_RM=true rm -rf --no-preserve-root node_modules',
      expected: { verdict: 'block', rule: 'rm-rf-no-preserve-root' },
    },
    {
      label: 'b3: --no-progress build (false-positive guard; allowlisted)',
      command: 'rm -rf --no-progress build',
      expected: { verdict: 'skip' },
    },

    // --- Bucket 4 — rule 3 (unresolved-var) ---
    { label: 'b4: $FOO', command: 'rm -rf $FOO', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b4: ${FOO}', command: 'rm -rf ${FOO}', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b4: ${FOO:-default}', command: 'rm -rf ${FOO:-default}', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b4: $(find .)', command: 'rm -rf $(find .)', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b4: backtick find', command: 'rm -rf `find .`', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b4: $HOME/build unquoted', command: 'rm -rf $HOME/build', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b4: "$HOME/build" double-quoted preserves $', command: 'rm -rf "$HOME/build"', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b4: ALLOW_DESTRUCTIVE_RM=true $FOO — flag bypasses rule 3', command: 'ALLOW_DESTRUCTIVE_RM=true rm -rf $FOO', expected: { verdict: 'skip' } },

    // --- Bucket 5 — rule 4 (globstar) ---
    { label: 'b5: **/*', command: 'rm -rf **/*', expected: { verdict: 'block', rule: 'rm-rf-globstar' } },
    { label: 'b5: src/**/*.ts', command: 'rm -rf src/**/*.ts', expected: { verdict: 'block', rule: 'rm-rf-globstar' } },
    { label: 'b5: build/**', command: 'rm -rf build/**', expected: { verdict: 'block', rule: 'rm-rf-globstar' } },

    // --- Bucket 6 — rule 5 (dangerous-glob-unbypassable) ---
    { label: 'b6: .*', command: 'rm -rf .*', expected: { verdict: 'block', rule: 'rm-rf-dangerous-glob-unbypassable' } },
    { label: 'b6: /*', command: 'rm -rf /*', expected: { verdict: 'block', rule: 'rm-rf-dangerous-glob-unbypassable' } },
    {
      label: 'b6: ALLOW_DESTRUCTIVE_RM=true .* — unbypassable',
      command: 'ALLOW_DESTRUCTIVE_RM=true rm -rf .*',
      expected: { verdict: 'block', rule: 'rm-rf-dangerous-glob-unbypassable' },
    },
    {
      // .dotfile is a literal target; no glob metacharacters — classified as strict inside proj.
      label: 'b6: .dotfile (literal) does NOT trigger rule 5',
      command: 'rm -rf .dotfile',
      expected: { verdict: 'ask', rule: 'rm-rf-strict' },
    },

    // --- Bucket 8 — rule 7 (home) ---
    { label: 'b8: ~', command: 'rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b8: ~/', command: 'rm -rf ~/', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b8: ~/Documents', command: 'rm -rf ~/Documents', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b8: /home/alice', command: 'rm -rf /home/alice', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b8: /home/alice/', command: 'rm -rf /home/alice/', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b8: /home/alice/Documents', command: 'rm -rf /home/alice/Documents', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b8: /home/bob (other user home)', command: 'rm -rf /home/bob', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b8: /Users/carol (macOS)', command: 'rm -rf /Users/carol', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b8: ~bob (literal ~user)', command: 'rm -rf ~bob', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    {
      label: 'b8: ALLOW_DESTRUCTIVE_RM=true ~ — unbypassable',
      command: 'ALLOW_DESTRUCTIVE_RM=true rm -rf ~',
      expected: { verdict: 'block', rule: 'rm-rf-home' },
    },

    // --- Bucket 9 — rule 8 (root) ---
    { label: 'b9: /', command: 'rm -rf /', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b9: /etc', command: 'rm -rf /etc', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b9: /etc/', command: 'rm -rf /etc/', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b9: /etc/foo', command: 'rm -rf /etc/foo', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b9: /usr', command: 'rm -rf /usr', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b9: /bin', command: 'rm -rf /bin', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b9: /sbin', command: 'rm -rf /sbin', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b9: /var', command: 'rm -rf /var', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b9: /tmp (top-level, not our fixture subdir)', command: 'rm -rf /tmp', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b9: /boot', command: 'rm -rf /boot', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b9: /System (macOS)', command: 'rm -rf /System', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    {
      label: 'b9: ALLOW_DESTRUCTIVE_RM=true /etc — unbypassable',
      command: 'ALLOW_DESTRUCTIVE_RM=true rm -rf /etc',
      expected: { verdict: 'block', rule: 'rm-rf-root' },
    },

    // --- Bucket 10 — rule 9 (project-root) ---
    { label: 'b10: . at proj root', command: 'rm -rf .', expected: { verdict: 'ask', rule: 'rm-rf-project-root' } },
    { label: 'b10: ./ at proj root', command: 'rm -rf ./', expected: { verdict: 'ask', rule: 'rm-rf-project-root' } },
    {
      label: 'b10: . with strictMode promotes to block',
      command: 'rm -rf .',
      config: withConfig({ strictMode: true }),
      expected: { verdict: 'block', rule: 'rm-rf-project-root' },
    },
    {
      label: 'b10: ALLOW_DESTRUCTIVE_RM=true . — still ask (unbypassable)',
      command: 'ALLOW_DESTRUCTIVE_RM=true rm -rf .',
      expected: { verdict: 'ask', rule: 'rm-rf-project-root' },
    },

    // --- Bucket 11 — rule 10 (escape) ---
    { label: 'b11: /workspace/other (not a SYSTEM_TOP_LEVEL)', command: 'rm -rf /workspace/other', expected: { verdict: 'block', rule: 'rm-rf-escape' } },
    {
      label: 'b11: ALLOW_DESTRUCTIVE_RM=true /workspace/other — escape is bypassable',
      command: 'ALLOW_DESTRUCTIVE_RM=true rm -rf /workspace/other',
      expected: { verdict: 'skip' },
    },

    // --- Bucket 12 — rule 11 (strict) ---
    { label: 'b12: src/', command: 'rm -rf src/', expected: { verdict: 'ask', rule: 'rm-rf-strict' } },
    { label: 'b12: src', command: 'rm -rf src', expected: { verdict: 'ask', rule: 'rm-rf-strict' } },
    { label: 'b12: fixtures/ (not in default allowlist)', command: 'rm -rf fixtures/', expected: { verdict: 'ask', rule: 'rm-rf-strict' } },
    {
      label: 'b12: fixtures/ with extraAllowlist covers it',
      command: 'rm -rf fixtures/',
      config: withConfig({ extraAllowlist: ['fixtures'] }),
      expected: { verdict: 'skip' },
    },
    {
      label: 'b12: src/ with strictMode promotes strict to block',
      command: 'rm -rf src/',
      config: withConfig({ strictMode: true }),
      expected: { verdict: 'block', rule: 'rm-rf-strict' },
    },
    {
      label: 'b12: ALLOW_DESTRUCTIVE_RM=true src/ — still ask (unbypassable)',
      command: 'ALLOW_DESTRUCTIVE_RM=true rm -rf src/',
      expected: { verdict: 'ask', rule: 'rm-rf-strict' },
    },

    // --- Bucket 13 — allowlist happy path ---
    { label: 'b13: node_modules', command: 'rm -rf node_modules', expected: { verdict: 'skip' } },
    { label: 'b13: node_modules/', command: 'rm -rf node_modules/', expected: { verdict: 'skip' } },
    { label: 'b13: node_modules dist', command: 'rm -rf node_modules dist', expected: { verdict: 'skip' } },
    { label: 'b13: dist .cache build', command: 'rm -rf dist .cache build', expected: { verdict: 'skip' } },
    { label: 'b13: node_modules dist .cache build out coverage', command: 'rm -rf node_modules dist .cache build out coverage', expected: { verdict: 'skip' } },
    { label: 'b13: build/a.o (file inside allowlisted dir)', command: 'rm -rf build/a.o', expected: { verdict: 'skip' } },
    { label: 'b13: build/* (glob, all inside allowlisted dir)', command: 'rm -rf build/*', expected: { verdict: 'skip' } },

    // --- Bucket 14 — glob expansion ---
    { label: 'b14: build/* expands to files under build/', command: 'rm -rf build/*', expected: { verdict: 'skip' } },
    { label: 'b14: build/*.o', command: 'rm -rf build/*.o', expected: { verdict: 'skip' } },
    {
      // Note: hasGlobChars matches only *?[. The {...} brace form is NOT
      // brace-expanded by this hook — it is treated as a single literal
      // target `{src,build}/`, which resolves inside proj and classifies as
      // strict (first segment `{src,build}` is not in the allowlist).
      label: 'b14: {src,build}/ treated as literal, classifies as strict',
      command: 'rm -rf {src,build}/',
      expected: { verdict: 'ask', rule: 'rm-rf-strict' },
    },
    { label: 'b14: src/*.ts expands to src files → strict', command: 'rm -rf src/*.ts', expected: { verdict: 'ask', rule: 'rm-rf-strict' } },
    { label: 'b14: build/nonexistent-*.xyz empty match → skip', command: 'rm -rf build/nonexistent-*.xyz', expected: { verdict: 'skip' } },
    { label: 'b14: node_modules/* all allow → skip', command: 'rm -rf node_modules/*', expected: { verdict: 'skip' } },
    {
      // {node_modules,dist}/ is literal here (no brace expansion in hook),
      // firstSegment is `{node_modules,dist}` which is not allowlisted.
      label: 'b14: {node_modules,dist}/ literal, first segment not allowlisted → strict',
      command: 'rm -rf {node_modules,dist}/',
      expected: { verdict: 'ask', rule: 'rm-rf-strict' },
    },

    // --- Bucket 15 — segment split / compound ---
    { label: 'b15: cd /tmp && rm -rf ~', command: 'cd /tmp && rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b15: rm -rf node_modules; rm -rf ~', command: 'rm -rf node_modules; rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b15: rm -rf node_modules && rm -rf dist', command: 'rm -rf node_modules && rm -rf dist', expected: { verdict: 'skip' } },
    { label: 'b15: echo start | rm -rf /etc', command: 'echo start | rm -rf /etc', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b15: rm -rf src || rm -rf dist', command: 'rm -rf src || rm -rf dist', expected: { verdict: 'ask', rule: 'rm-rf-strict' } },
    { label: 'b15: true; rm -rf ~', command: 'true; rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    {
      label: 'b15: rm -rf ~ ; rm -rf /etc — aggregates home + root',
      command: 'rm -rf ~ ; rm -rf /etc',
      expected: { verdict: 'block', rules: ['rm-rf-home', 'rm-rf-root'] },
    },
    {
      label: 'b15: rm -rf /etc && rm -rf ~ — aggregates root + home',
      command: 'rm -rf /etc && rm -rf ~',
      expected: { verdict: 'block', rules: ['rm-rf-root', 'rm-rf-home'] },
    },

    // --- Bucket 16 — multi-target aggregation ---
    {
      label: 'b16: rm -rf /tmp/build ~ — root + home',
      command: 'rm -rf /tmp/build ~',
      expected: { verdict: 'block', rules: ['rm-rf-root', 'rm-rf-home'] },
    },
    {
      label: 'b16: rm -rf ~ src — home (block) wins over strict (ask)',
      command: 'rm -rf ~ src',
      expected: { verdict: 'block', rules: ['rm-rf-home', 'rm-rf-strict'] },
    },
    {
      label: 'b16: rm -rf /etc src build — root beats strict, build is allow',
      command: 'rm -rf /etc src build',
      expected: { verdict: 'block', rules: ['rm-rf-root', 'rm-rf-strict'] },
    },
    {
      label: 'b16: ALLOW_DESTRUCTIVE_RM=true /etc build — root is unbypassable',
      command: 'ALLOW_DESTRUCTIVE_RM=true rm -rf /etc build',
      expected: { verdict: 'block', rule: 'rm-rf-root' },
    },
    {
      label: 'b16: ALLOW_DESTRUCTIVE_RM=true /workspace/other build — escape bypassed, build allow',
      command: 'ALLOW_DESTRUCTIVE_RM=true rm -rf /workspace/other build',
      expected: { verdict: 'skip' },
    },
    {
      label: 'b16: rm -rf . src — both ask (project-root + strict)',
      command: 'rm -rf . src',
      expected: { verdict: 'ask', rules: ['rm-rf-project-root', 'rm-rf-strict'] },
    },
    {
      label: 'b16: rm -rf node_modules src dist — only src triggers ask',
      command: 'rm -rf node_modules src dist',
      expected: { verdict: 'ask', rule: 'rm-rf-strict' },
    },
    {
      label: 'b16: rm -rf ~bob src/ — home block wins; strict also fires',
      command: 'rm -rf ~bob src/',
      expected: { verdict: 'block', rules: ['rm-rf-home', 'rm-rf-strict'] },
    },
    {
      label: 'b16: rm -rf ${UNSET} /etc — unresolved-var + root',
      command: 'rm -rf ${UNSET} /etc',
      expected: { verdict: 'block', rules: ['rm-rf-unresolved-var', 'rm-rf-root'] },
    },

    // --- Bucket 17 — flag-order variants ---
    { label: 'b17: -fr ~', command: 'rm -fr ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b17: -Rf ~', command: 'rm -Rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b17: -fR ~', command: 'rm -fR ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b17: -rfv ~', command: 'rm -rfv ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b17: -rfI ~', command: 'rm -rfI ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b17: --recursive ~', command: 'rm --recursive ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b17: -vfr ~', command: 'rm -vfr ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b17: -r -f ~', command: 'rm -r -f ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },

    // --- Bucket 18 — absolute rm path ---
    { label: 'b18: /usr/bin/rm -rf ~', command: '/usr/bin/rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b18: /bin/rm -rf /etc', command: '/bin/rm -rf /etc', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b18: ./rm -rf ~', command: './rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b18: /usr/local/bin/rm -rf ~', command: '/usr/local/bin/rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b18: rmdir is not rm', command: 'rmdir ~', expected: { verdict: 'skip' } },

    // --- Bucket 19 — end-of-options `--` ---
    {
      label: 'b19: rm -rf -- --filename (after --, --filename is target → strict)',
      command: 'rm -rf -- --filename',
      expected: { verdict: 'ask', rule: 'rm-rf-strict' },
    },
    {
      // Note: the hook's resolveTilde expands any token starting with `~`,
      // independent of shell end-of-options semantics. The shell would not
      // expand ~ after --, but the hook does. Documented caveat.
      label: 'b19: rm -rf -- ~ (hook resolveTilde is shell-agnostic)',
      command: 'rm -rf -- ~',
      expected: { verdict: 'block', rule: 'rm-rf-home' },
    },
    { label: 'b19: rm -rf -- /etc', command: 'rm -rf -- /etc', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    {
      label: 'b19: rm -rf file.txt -- -dir (both strict)',
      command: 'rm -rf file.txt -- -dir',
      expected: { verdict: 'ask', rule: 'rm-rf-strict' },
    },
    {
      label: 'b19: rm -rf -- -- file.txt (second -- becomes literal target)',
      command: 'rm -rf -- -- file.txt',
      expected: { verdict: 'ask', rule: 'rm-rf-strict' },
    },
    { label: 'b19: rm -rf -- node_modules (allowlist past --)', command: 'rm -rf -- node_modules', expected: { verdict: 'skip' } },

    // --- Bucket 20 — quoting ---
    {
      label: 'b20: "~" — double quotes stripped, ~ expanded',
      command: 'rm -rf "~"',
      expected: { verdict: 'block', rule: 'rm-rf-home' },
    },
    {
      label: "b20: '~' — single quotes strip content entirely → no target",
      command: "rm -rf '~'",
      expected: { verdict: 'skip' },
    },
    {
      label: 'b20: "$HOME/dist" preserves $',
      command: 'rm -rf "$HOME/dist"',
      expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' },
    },
    {
      label: "b20: '$HOME/dist' single-quoted → no target → skip",
      command: "rm -rf '$HOME/dist'",
      expected: { verdict: 'skip' },
    },
    {
      label: 'b20: "/etc" double-quoted preserved',
      command: 'rm -rf "/etc"',
      expected: { verdict: 'block', rule: 'rm-rf-root' },
    },
    {
      // "build with spaces" → sanitize removes quotes, yielding three tokens:
      // `build`, `with`, `spaces`. Known tokenization limitation. `build` is
      // allowlisted, `with` and `spaces` are strict → ask rule 11.
      label: 'b20: "build with spaces" tokenizes into 3 targets; strict wins',
      command: 'rm -rf "build with spaces"',
      expected: { verdict: 'ask', rule: 'rm-rf-strict' },
    },

    // --- Bucket 21 — env prefix ---
    {
      label: 'b21: ALLOW_DESTRUCTIVE_RM=true ~ (unbypassable)',
      command: 'ALLOW_DESTRUCTIVE_RM=true rm -rf ~',
      expected: { verdict: 'block', rule: 'rm-rf-home' },
    },
    { label: 'b21: FOO=bar rm -rf node_modules (unrelated env prefix)', command: 'FOO=bar rm -rf node_modules', expected: { verdict: 'skip' } },
    {
      label: 'b21: ALLOW_DESTRUCTIVE_RM=false $FOO (wrong value)',
      command: 'ALLOW_DESTRUCTIVE_RM=false rm -rf $FOO',
      expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' },
    },
    {
      label: 'b21: A=1 B=2 rm -rf ~',
      command: 'A=1 B=2 rm -rf ~',
      expected: { verdict: 'block', rule: 'rm-rf-home' },
    },
    {
      // sanitize strips quotes: VAR=a b rm -rf ~. stripEnvPrefix only peels
      // VAR=a; rest becomes `b rm -rf ~`. Detection runs on the full segment
      // and latches the rm token. Defense-in-depth fix from Fix 2.
      label: 'b21: VAR="a b" rm -rf ~ (defense-in-depth)',
      command: 'VAR="a b" rm -rf ~',
      expected: { verdict: 'block', rule: 'rm-rf-home' },
    },

    // --- Bucket 22 — non-Bash tool ---
    { label: 'b22: Read tool skips', command: 'rm -rf /etc', toolName: 'Read', expected: { verdict: 'skip' } },
    { label: 'b22: Write tool skips', command: 'rm -rf ~', toolName: 'Write', expected: { verdict: 'skip' } },
    { label: 'b22: Grep tool skips', command: 'rm -rf /', toolName: 'Grep', expected: { verdict: 'skip' } },

    // --- Bucket 23 — adversarial coverage ---
    // Bare glob / missing variable-expansion bare forms
    { label: 'b23: adversarial: rm -rf *', command: 'rm -rf *', expected: { verdict: 'ask', rule: 'rm-rf-strict' } },
    { label: 'b23: adversarial: rm -rf $HOME', command: 'rm -rf $HOME', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b23: adversarial: rm -rf "$HOME"', command: 'rm -rf "$HOME"', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b23: adversarial: rm -rf ${HOME}', command: 'rm -rf ${HOME}', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },

    // Extra system-top-level paths we claim to cover
    { label: 'b23: adversarial: /root', command: 'rm -rf /root', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: /root/', command: 'rm -rf /root/', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: /lib', command: 'rm -rf /lib', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: /lib64', command: 'rm -rf /lib64', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: /opt', command: 'rm -rf /opt', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: /dev', command: 'rm -rf /dev', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: /proc', command: 'rm -rf /proc', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: /sys', command: 'rm -rf /sys', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: /home', command: 'rm -rf /home', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: /Users', command: 'rm -rf /Users', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: /private', command: 'rm -rf /private', expected: { verdict: 'block', rule: 'rm-rf-root' } },

    // WSL / macOS paths that may reveal SYSTEM_TOP_LEVEL gaps
    { label: 'b23: adversarial: /mnt/c/Users/alice', command: 'rm -rf /mnt/c/Users/alice', expected: { verdict: 'block', rule: 'rm-rf-escape' } },
    { label: 'b23: adversarial: /mnt/c', command: 'rm -rf /mnt/c', expected: { verdict: 'block', rule: 'rm-rf-escape' } },
    { label: 'b23: adversarial: /mnt', command: 'rm -rf /mnt', expected: { verdict: 'block', rule: 'rm-rf-escape' } },
    { label: 'b23: adversarial: /Applications', command: 'rm -rf /Applications', expected: { verdict: 'block', rule: 'rm-rf-escape' } },
    { label: 'b23: adversarial: /Library', command: 'rm -rf /Library', expected: { verdict: 'block', rule: 'rm-rf-escape' } },
    { label: 'b23: adversarial: /Volumes/MyDrive', command: 'rm -rf /Volumes/MyDrive', expected: { verdict: 'block', rule: 'rm-rf-escape' } },

    // Command-wrapper prefixes (sudo, env, nice, timeout, nohup)
    { label: 'b23: adversarial: sudo rm -rf /', command: 'sudo rm -rf /', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: sudo rm -rf ~', command: 'sudo rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b23: adversarial: env rm -rf ~', command: 'env rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b23: adversarial: nice rm -rf ~', command: 'nice rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b23: adversarial: timeout 10 rm -rf ~', command: 'timeout 10 rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b23: adversarial: nohup rm -rf ~', command: 'nohup rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },

    // Env-redefinition attack patterns
    { label: 'b23: adversarial: HOME=/ rm -rf "$HOME"', command: 'HOME=/ rm -rf "$HOME"', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b23: adversarial: HOME=/etc rm -rf ~', command: 'HOME=/etc rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },

    // Alias/quote bypass
    { label: 'b23: adversarial: \\rm -rf ~', command: '\\rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b23: adversarial: "rm" -rf ~', command: '"rm" -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },

    // Home-subtree classics
    { label: 'b23: adversarial: ~/.ssh', command: 'rm -rf ~/.ssh', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b23: adversarial: ~/.config', command: 'rm -rf ~/.config', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b23: adversarial: ~/.local', command: 'rm -rf ~/.local', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b23: adversarial: ~/Library', command: 'rm -rf ~/Library', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b23: adversarial: ~/Desktop', command: 'rm -rf ~/Desktop', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b23: adversarial: ~/Downloads', command: 'rm -rf ~/Downloads', expected: { verdict: 'block', rule: 'rm-rf-home' } },

    // Path normalization tricks
    { label: 'b23: adversarial: /etc/../', command: 'rm -rf /etc/../', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: /./', command: 'rm -rf /./', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: //', command: 'rm -rf //', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: ///', command: 'rm -rf ///', expected: { verdict: 'block', rule: 'rm-rf-root' } },

    // Tilde + traversal edge cases
    { label: 'b23: adversarial: ~/../..', command: 'rm -rf ~/../..', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b23: adversarial: ~/project/node_modules', command: 'rm -rf ~/project/node_modules', expected: { verdict: 'block', rule: 'rm-rf-home' } },

    // More variable-expansion forms
    { label: 'b23: adversarial: $TMPDIR', command: 'rm -rf $TMPDIR', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },

    // Loop / composite smuggling
    { label: 'b23: adversarial: for-loop with $d', command: 'for d in node_modules dist ~; do rm -rf "$d"; done', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b23: adversarial: { rm -rf ~; }', command: '{ rm -rf ~; }', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b23: adversarial: ( rm -rf ~ )', command: '( rm -rf ~ )', expected: { verdict: 'block', rule: 'rm-rf-home' } },

    // Dangerous combos (rule 5 unbypassable must win)
    { label: 'b23: adversarial: .* *', command: 'rm -rf .* *', expected: { verdict: 'block', rule: 'rm-rf-dangerous-glob-unbypassable' } },
    { label: 'b23: adversarial: . .*', command: 'rm -rf . .*', expected: { verdict: 'block', rule: 'rm-rf-dangerous-glob-unbypassable' } },

    // Comment handling (sanitize strips #-comments)
    { label: 'b23: adversarial: rm -rf ~ # cleanup', command: 'rm -rf ~ # cleanup', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b23: adversarial: echo safe # && rm -rf ~', command: 'echo safe # && rm -rf ~', expected: { verdict: 'skip' } },

    // Leading ./ — very common agent output
    { label: 'b23: adversarial: ./node_modules', command: 'rm -rf ./node_modules', expected: { verdict: 'skip' } },
    { label: 'b23: adversarial: "./node_modules"', command: 'rm -rf "./node_modules"', expected: { verdict: 'skip' } },

    // Extra: rm with only -r (no -f)
    { label: 'b23: adversarial: rm -r ~ (no -f)', command: 'rm -r ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },

    // --- Bucket 24 — adversarial 2 (deeper coverage) ---
    // Project-config dirs (inside proj, not allowlisted)
    { label: 'b24: adversarial2: rm -rf .git', command: 'rm -rf .git', expected: { verdict: 'ask', rule: 'rm-rf-strict' } },
    { label: 'b24: adversarial2: rm -rf .github', command: 'rm -rf .github', expected: { verdict: 'ask', rule: 'rm-rf-strict' } },
    { label: 'b24: adversarial2: rm -rf .vscode', command: 'rm -rf .vscode', expected: { verdict: 'ask', rule: 'rm-rf-strict' } },
    { label: 'b24: adversarial2: rm -rf .clooks', command: 'rm -rf .clooks', expected: { verdict: 'ask', rule: 'rm-rf-strict' } },

    // Quoted-unset-var / Steam-bug class
    { label: 'b24: adversarial2: rm -rf "$UNSET/etc"', command: 'rm -rf "$UNSET/etc"', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b24: adversarial2: rm -rf $UNSET/', command: 'rm -rf $UNSET/', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b24: adversarial2: rm -rf "${UNSET}/node_modules"', command: 'rm -rf "${UNSET}/node_modules"', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b24: adversarial2: rm -rf "$STEAMROOT/"*', command: 'rm -rf "$STEAMROOT/"*', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },

    // $PWD / $OLDPWD (rule 3 fires)
    { label: 'b24: adversarial2: rm -rf $PWD', command: 'rm -rf $PWD', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b24: adversarial2: rm -rf "$PWD"', command: 'rm -rf "$PWD"', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    { label: 'b24: adversarial2: rm -rf $OLDPWD', command: 'rm -rf $OLDPWD', expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },

    // Bare parent traversal
    { label: 'b24: adversarial2: rm -rf ..', command: 'rm -rf ..', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b24: adversarial2: rm -rf ../..', command: 'rm -rf ../..', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b24: adversarial2: rm -rf ~/..', command: 'rm -rf ~/..', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b24: adversarial2: rm -rf /etc/..', command: 'rm -rf /etc/..', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b24: adversarial2: rm -rf /usr/../etc', command: 'rm -rf /usr/../etc', expected: { verdict: 'block', rule: 'rm-rf-root' } },

    // macOS real paths (/private IS in SYSTEM_TOP_LEVEL)
    { label: 'b24: adversarial2: rm -rf /private/etc', command: 'rm -rf /private/etc', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b24: adversarial2: rm -rf /private/var', command: 'rm -rf /private/var', expected: { verdict: 'block', rule: 'rm-rf-root' } },

    // FHS dirs NOT in our SYSTEM_TOP_LEVEL
    { label: 'b24: adversarial2: rm -rf /srv', command: 'rm -rf /srv', expected: { verdict: 'block', rule: 'rm-rf-escape' } },
    { label: 'b24: adversarial2: rm -rf /run', command: 'rm -rf /run', expected: { verdict: 'block', rule: 'rm-rf-escape' } },

    // Control flow
    { label: 'b24: adversarial2: if true; then rm -rf ~; fi', command: 'if true; then rm -rf ~; fi', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b24: adversarial2: rm -rf ~ &', command: 'rm -rf ~ &', expected: { verdict: 'block', rule: 'rm-rf-home' } },

    // Alias-bypass alternates
    { label: 'b24: adversarial2: command rm -rf ~', command: 'command rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b24: adversarial2: r""m -rf ~', command: 'r""m -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },

    // Single-quoted (rm-token unwrap catches 'rm'-quoted invocations; trap handler unwrap catches quoted trap scripts)
    { label: "b24: adversarial2: 'rm' -rf ~", command: "'rm' -rf ~", expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: "b24: adversarial2: trap 'rm -rf ~' EXIT", command: "trap 'rm -rf ~' EXIT", expected: { verdict: 'block', rule: 'rm-rf-home' } },

    // Homebrew ARM path
    { label: 'b24: adversarial2: /opt/homebrew/bin/rm -rf ~', command: '/opt/homebrew/bin/rm -rf ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },

    // Multi-target (allowlisted + catastrophic)
    { label: 'b24: adversarial2: rm -rf node_modules ~', command: 'rm -rf node_modules ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b24: adversarial2: rm -rf node_modules /', command: 'rm -rf node_modules /', expected: { verdict: 'block', rule: 'rm-rf-root' } },

    // System subpaths (subtree match)
    { label: 'b24: adversarial2: rm -rf /etc/passwd', command: 'rm -rf /etc/passwd', expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: 'b24: adversarial2: rm -rf /var/log', command: 'rm -rf /var/log', expected: { verdict: 'block', rule: 'rm-rf-root' } },

    // Flag variations
    { label: 'b24: adversarial2: rm -R ~', command: 'rm -R ~', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b24: adversarial2: rm --one-file-system -rf /', command: 'rm --one-file-system -rf /', expected: { verdict: 'block', rule: 'rm-rf-root' } },

    // --- Bucket 25 — subshell / trap single-quote unwrap (locks the sanitize fix) ---

    // Shell -c forms (single-quoted scripts)
    { label: "b25: subshell-unwrap: bash -c 'rm -rf ~'", command: "bash -c 'rm -rf ~'", expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: "b25: subshell-unwrap: sh -c 'rm -rf ~'", command: "sh -c 'rm -rf ~'", expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: "b25: subshell-unwrap: zsh -c 'rm -rf /'", command: "zsh -c 'rm -rf /'", expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: "b25: subshell-unwrap: dash -c 'rm -rf ~'", command: "dash -c 'rm -rf ~'", expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: "b25: subshell-unwrap: ksh -c 'rm -rf /etc'", command: "ksh -c 'rm -rf /etc'", expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: "b25: subshell-unwrap: bash -c 'rm -rf node_modules'", command: "bash -c 'rm -rf node_modules'", expected: { verdict: 'skip' } },
    // compound inside quoted script: segment split fires inside unwrapped content
    { label: "b25: subshell-unwrap: bash -c 'echo hi; rm -rf ~'", command: "bash -c 'echo hi; rm -rf ~'", expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: "b25: subshell-unwrap: bash -c 'rm -rf ~/.ssh'", command: "bash -c 'rm -rf ~/.ssh'", expected: { verdict: 'block', rule: 'rm-rf-home' } },
    // rule 3 still fires on the unwrapped content
    { label: "b25: subshell-unwrap: bash -c 'rm -rf $HOME'", command: "bash -c 'rm -rf $HOME'", expected: { verdict: 'block', rule: 'rm-rf-unresolved-var' } },
    // aggregate: /tmp/build → rm-rf-root, ~ → rm-rf-home
    { label: "b25: subshell-unwrap: sh -c 'rm -rf /tmp/build ~'", command: "sh -c 'rm -rf /tmp/build ~'", expected: { verdict: 'block', rules: ['rm-rf-root', 'rm-rf-home'] } },

    // rm-name unwrap forms
    { label: "b25: subshell-unwrap: 'rm' -rf ~", command: "'rm' -rf ~", expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: "b25: subshell-unwrap: '/usr/bin/rm' -rf /etc", command: "'/usr/bin/rm' -rf /etc", expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: "b25: subshell-unwrap: '\\rm' -rf ~", command: "'\\rm' -rf ~", expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: "b25: subshell-unwrap: './rm' -rf ~", command: "'./rm' -rf ~", expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: "b25: subshell-unwrap: 'rm' -rf node_modules", command: "'rm' -rf node_modules", expected: { verdict: 'skip' } },

    // Trap forms
    { label: "b25: subshell-unwrap: trap 'rm -rf /' TERM", command: "trap 'rm -rf /' TERM", expected: { verdict: 'block', rule: 'rm-rf-root' } },
    { label: "b25: subshell-unwrap: trap 'rm -rf node_modules' EXIT", command: "trap 'rm -rf node_modules' EXIT", expected: { verdict: 'skip' } },

    // Double-quoted parallels (no behavior change — baseline regression)
    { label: 'b25: subshell-unwrap: bash -c "rm -rf ~"', command: 'bash -c "rm -rf ~"', expected: { verdict: 'block', rule: 'rm-rf-home' } },
    { label: 'b25: subshell-unwrap: trap "rm -rf ~" EXIT', command: 'trap "rm -rf ~" EXIT', expected: { verdict: 'block', rule: 'rm-rf-home' } },

    // Not matched by the fix — should stay skip (negative / don't-over-unwrap)
    // literal filename with metachars; sanitize strips whole quoted span; no targets; hook has no opinion — documents the accepted limitation for single-quoted argument filenames.
    { label: "b25: subshell-unwrap: rm -rf 'foo && bar'", command: "rm -rf 'foo && bar'", expected: { verdict: 'skip' } },
    // quoted 'myrm' is NOT an rm command name per the regex, so it's stripped as argument. Target: none.
    { label: "b25: subshell-unwrap: rm -rf 'myrm'", command: "rm -rf 'myrm'", expected: { verdict: 'skip' } },
    // not even an rm invocation; quoted content is just a string for echo
    { label: "b25: subshell-unwrap: echo 'rm -rf ~'", command: "echo 'rm -rf ~'", expected: { verdict: 'skip' } },
  ]

  test.each(CASES)('$label', (c) => {
    const ctx = makeCtx(c.command, c.toolName ?? 'Bash', proj)
    const result = hook.PreToolUse!(ctx, c.config ?? DEFAULT_CONFIG) as {
      debugMessage?: string
      result: string
      reason?: string
    }
    expect(result.result).toBe(c.expected.verdict)
    if ('rule' in c.expected) {
      const ruleEvidence = c.expected.verdict === 'ask' ? result.debugMessage ?? '' : result.reason ?? ''
      expect(ruleEvidence).toContain(c.expected.verdict === 'ask' ? c.expected.rule : `[${c.expected.rule}]`)
    } else if ('rules' in c.expected) {
      for (const r of c.expected.rules) {
        const ruleEvidence = c.expected.verdict === 'ask' ? result.debugMessage ?? '' : result.reason ?? ''
        expect(ruleEvidence).toContain(c.expected.verdict === 'ask' ? r : `[${r}]`)
      }
    }
  })
})
