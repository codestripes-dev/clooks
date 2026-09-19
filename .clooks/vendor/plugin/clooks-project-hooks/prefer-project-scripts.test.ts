import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PreToolUseContext, SessionStartContext } from './types'
import {
  hook,
  sanitize,
  getSegments,
  extractSegmentInfo,
  hasEscapeHatch,
  detectMatch,
  equivalentScript,
} from './prefer-project-scripts'

// --- Helpers ---

function makeCtx(command: string, toolName = 'Bash'): PreToolUseContext {
  return {
    event: 'PreToolUse',
    toolName,
    toolInput: { command },
    originalToolInput: { command },
    toolUseId: 'tu-test',
    sessionId: 'test-session',
    cwd: project({
      lint: 'eslint src/',
      format: 'prettier --write .',
      typecheck: 'tsc --noEmit',
      test: 'jest src/utils/',
    }),
    permissionMode: 'default',
    transcriptPath: '/tmp/transcript.jsonl',
    allow: (opts = {}) => ({ result: 'allow', ...opts }),
    block: (opts) => ({ result: 'block', ...opts }),
    skip: (opts = {}) => ({ result: 'skip', ...opts }),
    ask: (opts) => ({ result: 'ask', ...opts }),
    defer: (opts = {}) => ({ result: 'defer', ...opts }),
  } as PreToolUseContext
}

function makeSessionStartCtx(): SessionStartContext {
  return {
    event: 'SessionStart',
    source: 'startup',
    sessionId: 'test-session',
    cwd: '/tmp',
    permissionMode: 'default',
    transcriptPath: '/tmp/transcript.jsonl',
    skip: (opts = {}) => ({ result: 'skip', ...opts }),
  } as unknown as SessionStartContext
}

// =============================================================================
// Section 1: Utility function tests
// =============================================================================

describe('sanitize', () => {
  test.each([
    ['strips single-quoted strings', "echo 'eslint' src/", 'echo  src/'],
    ['strips double-quoted strings', 'echo "run eslint" src/', 'echo  src/'],
    ['strips comments', 'eslint src/ # check lint', 'eslint src/ '],
    ['strips all three', `echo 'a' "b" # c`, 'echo   '],
    ['preserves unquoted content', 'eslint --fix src/', 'eslint --fix src/'],
  ])('%s', (_label, input, expected) => {
    expect(sanitize(input)).toBe(expected)
  })
})

describe('getSegments', () => {
  test.each([
    ['splits on &&', 'a && b', ['a', 'b']],
    ['splits on ||', 'a || b', ['a', 'b']],
    ['splits on ;', 'a ; b', ['a', 'b']],
    ['handles mixed operators', 'a && b || c ; d', ['a', 'b', 'c', 'd']],
    ['filters empty segments', ' && ', []],
    ['single segment', 'eslint src/', ['eslint src/']],
  ])('%s', (_label, input, expected) => {
    expect(getSegments(input)).toEqual(expected)
  })
})

describe('extractSegmentInfo', () => {
  test.each([
    ['simple command', 'eslint src/', 'eslint', 'eslint src/'],
    ['with pipe', 'eslint src/ | grep error', 'eslint', 'eslint src/'],
    ['with env var', 'NODE_ENV=test eslint src/', 'eslint', 'eslint src/'],
    ['multiple env vars', 'A=1 B=2 eslint src/', 'eslint', 'eslint src/'],
    ['empty string', '', '', ''],
    ['whitespace only', '   ', '', ''],
    ['multi-word command', 'spacetime publish --clear', 'spacetime', 'spacetime publish --clear'],
  ])('%s', (_label, input, expectedFirst, expectedStripped) => {
    const result = extractSegmentInfo(input)
    expect(result.firstWord).toBe(expectedFirst)
    expect(result.stripped).toBe(expectedStripped)
  })
})

describe('hasEscapeHatch', () => {
  test.each([
    ['at start', 'ALLOW_DIRECT_TOOL=true eslint src/', true],
    ['with other env vars', 'FOO=bar ALLOW_DIRECT_TOOL=true eslint', true],
    ['not present', 'eslint src/', false],
    ['different value (=false)', 'ALLOW_DIRECT_TOOL=false eslint', false],
    ['value prefix (=trueish)', 'ALLOW_DIRECT_TOOL=trueish eslint', false],
    ['inside quotes (still matches on original)', 'ALLOW_DIRECT_TOOL=true "eslint"', true],
  ])('%s', (_label, input, expected) => {
    expect(hasEscapeHatch(input)).toBe(expected)
  })
})

// =============================================================================
// Section 2: detectMatch tests
// =============================================================================

describe('detectMatch', () => {
  const eslintMapping = { match: '(?<![\\w-])eslint(?![\\w-])', recommend: 'npm run lint' }
  const prettierMapping = { match: '(?<![\\w-])prettier(?![\\w-])', recommend: 'npm run format' }
  const mappings = [eslintMapping, prettierMapping]

  test('matches eslint', () => {
    const result = detectMatch('eslint src/', mappings)
    expect(result.matched).toEqual(eslintMapping)
  })

  test('matches prettier', () => {
    const result = detectMatch('prettier --write .', mappings)
    expect(result.matched).toEqual(prettierMapping)
  })

  test('no match for unknown tool', () => {
    const result = detectMatch('cargo build', mappings)
    expect(result.matched).toBeNull()
  })

  test('does not match inside hyphenated names (false-positive annotation: eslint-plugin-react)', () => {
    const result = detectMatch('bun add eslint-plugin-react', mappings)
    expect(result.matched).toBeNull()
  })

  test('does not match inside quoted strings', () => {
    const result = detectMatch('echo "run eslint"', mappings)
    expect(result.matched).toBeNull()
  })

  test('does not match pipe targets', () => {
    const result = detectMatch('ps aux | eslint', mappings)
    expect(result.matched).toBeNull()
  })

  test('matches with env var prefix', () => {
    const result = detectMatch('NODE_ENV=test eslint src/', mappings)
    expect(result.matched).toEqual(eslintMapping)
  })

  test('matches in compound command', () => {
    const result = detectMatch('cd src && eslint .', mappings)
    expect(result.matched).toEqual(eslintMapping)
  })

  test('first-match-wins (eslint before prettier)', () => {
    const result = detectMatch('eslint src/', [eslintMapping, prettierMapping])
    expect(result.matched).toEqual(eslintMapping)
  })

  test('invalid regex is skipped with debug message', () => {
    const badMapping = { match: '(?invalid', recommend: 'npm run bad' }
    const result = detectMatch('eslint src/', [badMapping, eslintMapping])
    expect(result.matched).toEqual(eslintMapping)
    expect(result.debugMessages).toHaveLength(1)
    expect(result.debugMessages[0]).toContain("invalid regex '(?invalid'")
  })

  test('all-invalid regexes returns null', () => {
    const badMapping = { match: '(?invalid', recommend: 'npm run bad' }
    const result = detectMatch('eslint src/', [badMapping])
    expect(result.matched).toBeNull()
    expect(result.debugMessages).toHaveLength(1)
  })

  test('empty mappings returns null', () => {
    const result = detectMatch('eslint src/', [])
    expect(result.matched).toBeNull()
  })

  test('matches multi-word tool invocations', () => {
    const spaceMapping = { match: '(?<![\\w-])spacetime\\s+publish(?![\\w-])', recommend: 'bun run spacetime:publish' }
    const result = detectMatch('spacetime publish --clear-database', [spaceMapping])
    expect(result.matched).toEqual(spaceMapping)
  })

  test('naive regex can select the recommended command before equivalence checking', () => {
    const circularMapping = { match: 'lint', recommend: 'npm run lint' }
    const result = detectMatch('npm run lint', [circularMapping])
    expect(result.matched).toEqual(circularMapping)
  })
})

// =============================================================================
// Section 3: hook.SessionStart tests
// =============================================================================

describe('hook.SessionStart', () => {
  test('injects nudge when mappings is empty', () => {
    const result = hook.SessionStart!(makeSessionStartCtx(), { mappings: [] })
    expect(result.result).toBe('skip')
    expect(result.injectContext).toContain('CONFIGURATION REQUIRED')
    expect(result.injectContext).toContain('prefer-project-scripts')
    expect(result.injectContext).toContain('enabled: false')
  })

  test('injects nudge when config.mappings is not an array', () => {
    const result = hook.SessionStart!(makeSessionStartCtx(), { mappings: undefined as any })
    expect(result.result).toBe('skip')
    expect(result.injectContext).toContain('CONFIGURATION REQUIRED')
  })

  test('injects announcement when mappings are configured', () => {
    const config = { mappings: [{ match: 'eslint', recommend: 'npm run lint' }] }
    const result = hook.SessionStart!(makeSessionStartCtx(), config)
    expect(result.result).toBe('skip')
    expect(result.injectContext).toContain('prefer-project-scripts')
    expect(result.injectContext).toContain('`npm run lint`')
    expect(result.injectContext).toContain('same executable and complete arguments')
    expect(result.injectContext).toContain('Unverifiable recommendations')
    expect(result.injectContext).not.toContain('The Bash tool')
  })
})

// =============================================================================
// Section 4: hook.PreToolUse — skip conditions
// =============================================================================

describe('hook.PreToolUse — skip conditions', () => {
  const config = { mappings: [{ match: '(?<![\\w-])eslint(?![\\w-])', recommend: 'npm run lint' }] }

  test('skips non-Bash tools', () => {
    const result = hook.PreToolUse!(makeCtx('eslint src/', 'Read'), config)
    expect(result.result).toBe('skip')
  })

  test('skips empty command', () => {
    const result = hook.PreToolUse!(makeCtx(''), config)
    expect(result.result).toBe('skip')
  })

  test('skips when mappings is empty', () => {
    const result = hook.PreToolUse!(makeCtx('eslint src/'), { mappings: [] })
    expect(result.result).toBe('skip')
  })

  test('skips with escape hatch', () => {
    const result = hook.PreToolUse!(makeCtx('ALLOW_DIRECT_TOOL=true eslint src/'), config)
    expect(result.result).toBe('skip')
  })
})

// =============================================================================
// Section 5: hook.PreToolUse — true positives and true negatives
// =============================================================================

describe('hook.PreToolUse — true positives', () => {
  const config = {
    mappings: [
      { match: '(?<![\\w-])eslint(?![\\w-])', recommend: 'npm run lint' },
      { match: '(?<![\\w-])prettier(?![\\w-])', recommend: 'npm run format' },
      { match: '(?<![\\w-])tsc(?![\\w-])', recommend: 'npm run typecheck' },
      { match: '(?<![\\w-])jest(?![\\w-])', recommend: 'npm run test' },
    ],
  }

  test.each([
    ['bare eslint', 'eslint src/', 'npm run lint'],
    ['bare prettier', 'prettier --write .', 'npm run format'],
    ['bare tsc', 'tsc --noEmit', 'npm run typecheck'],
    ['bare jest', 'jest src/utils/', 'npm run test'],
  ])('blocks %s', (_label, command, expectedRecommend) => {
    const result = hook.PreToolUse!(makeCtx(command), config) as any
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[prefer-project-scripts]')
    expect(result.reason).toContain(expectedRecommend)
    expect(result.reason).toContain('ALLOW_DIRECT_TOOL=true')
  })
})

describe('hook.PreToolUse — true negatives', () => {
  const config = {
    mappings: [
      { match: '(?<![\\w-])eslint(?![\\w-])', recommend: 'npm run lint' },
      { match: '(?<![\\w-])prettier(?![\\w-])', recommend: 'npm run format' },
    ],
  }

  test.each([
    ['recommended command (npm run lint)', 'npm run lint'],
    ['recommended command (npm run format)', 'npm run format'],
    ['unrelated tool (cargo build)', 'cargo build'],
    ['hyphenated name (false-positive: eslint-plugin-react)', 'bun add eslint-plugin-react'],
    ['tool inside quotes (false-positive: echo "run eslint")', 'echo "run eslint"'],
    ['pipe target (false-positive: ps aux | eslint)', 'ps aux | eslint'],
    ['tool in comment', 'echo ok # eslint should run here'],
    ['eslint with env var is unverifiable', 'VAR=val eslint src/'],
    ['eslint in compound command is unverifiable', 'cd src && eslint .'],
  ])('allows %s', (_label, command) => {
    const result = hook.PreToolUse!(makeCtx(command), config)
    expect(result.result).toBe('skip')
  })
})

// =============================================================================
// Section 6: Edge cases
// =============================================================================

describe('hook.PreToolUse — edge cases', () => {
  test('invalid regex in mapping is skipped gracefully', () => {
    const config = {
      mappings: [
        { match: '(?invalid', recommend: 'npm run bad' },
        { match: '(?<![\\w-])eslint(?![\\w-])', recommend: 'npm run lint' },
      ],
    }
    const result = hook.PreToolUse!(makeCtx('eslint src/'), config) as any
    expect(result.result).toBe('block')
    expect(result.reason).toContain('npm run lint')
    expect(result.debugMessage).toContain("invalid regex '(?invalid'")
  })

  test('all-invalid regexes result in skip', () => {
    const config = { mappings: [{ match: '(?invalid', recommend: 'npm run bad' }] }
    const result = hook.PreToolUse!(makeCtx('eslint src/'), config) as any
    expect(result.result).toBe('skip')
    expect(result.debugMessage).toContain("invalid regex '(?invalid'")
  })

  test('mappings with non-array value treated as empty', () => {
    const result = hook.PreToolUse!(makeCtx('eslint src/'), { mappings: 'bad' as any })
    expect(result.result).toBe('skip')
  })

  test('block message format matches spec', () => {
    const config = { mappings: [{ match: '(?<![\\w-])eslint(?![\\w-])', recommend: 'npm run lint' }] }
    const result = hook.PreToolUse!(makeCtx('eslint src/'), config) as any
    expect(result.reason).toBe(
      '[prefer-project-scripts] Use `npm run lint` instead: its literal script matches the requested executable and complete arguments. If the bare tool is needed, prefix with ALLOW_DIRECT_TOOL=true.'
    )
    expect(result.debugMessage).toBe("prefer-project-scripts: blocked, recommending 'npm run lint'")
  })

  test('compound command remains unverified after whitespace-only segments', () => {
    const config = { mappings: [{ match: '(?<![\\w-])eslint(?![\\w-])', recommend: 'npm run lint' }] }
    const result = hook.PreToolUse!(makeCtx('  ;  ; eslint src/'), config) as any
    expect(result.result).toBe('skip')
    expect(result.reason).toBeUndefined()
    expect(result.debugMessage).toContain('equivalence unverified')
  })
})

const owned: string[] = []
afterEach(() => {
  for (const dir of owned.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function project(scripts: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'clooks-script-equivalence-'))
  owned.push(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }))
  writeFileSync(join(dir, 'sentinel'), 'unchanged')
  return dir
}
function context(cwd: string, command: string, agent: string | undefined) {
  return {
    cwd,
    agent,
    toolName: 'Bash',
    toolInput: { command },
    skip: (opts = {}) => ({ result: 'skip', ...opts }),
    block: (opts = {}) => ({ result: 'block', ...opts }),
    ask: (opts = {}) => ({ result: 'ask', ...opts }),
    allow: () => {
      throw new Error('Must not grant permission')
    },
  }
}

describe('literal script equivalence', () => {
  test.each([
    ['bun run lint', 'eslint src/'],
    ['npm run lint', 'eslint src/'],
    ['pnpm run lint', 'eslint src/'],
    ['yarn run lint', 'eslint src/'],
  ])('%s preserves complete arguments', (recommend, command) => {
    expect(equivalentScript(command, recommend, project({ lint: command }))).toBe(true)
  })
  test.each([
    ['ruff check src', 'ruff check src'],
    ['spacetime publish --clear-database', 'spacetime publish --clear-database'],
    ['tsc --noEmit', 'tsc --noEmit'],
    ['prettier --write "file name.ts"', "prettier --write 'file name.ts'"],
  ])('custom or quoted literal %s', (command, body) => {
    expect(equivalentScript(command, 'bun run task', project({ task: body }))).toBe(true)
  })
  test.each([
    ['prettier --check src/a.ts', 'prettier --write src/a.ts'],
    ['prettier --check src/a.ts', "prettier --check 'src/**/*.ts'"],
    ['eslint test/', 'eslint src/'],
    ['eslint --fix src/', 'eslint src/'],
    ['tsc', 'tsc --noEmit'],
    ['spacetime publish --clear-database', 'spacetime publish'],
    ['FOO=bar eslint src/', 'FOO=bar eslint src/'],
    ['eslint src/ && touch sentinel', 'eslint src/ && touch sentinel'],
    ['eslint src/\ntouch sentinel', 'eslint src/\ntouch sentinel'],
    ['eslint $(touch sentinel)', 'eslint $(touch sentinel)'],
    ['eslint *.ts', 'eslint *.ts'],
    ['eslint src/ > sentinel', 'eslint src/ > sentinel'],
    ['eslint src/ | cat', 'eslint src/ | cat'],
    ['npx eslint src/', 'eslint src/'],
    ['bun run nested', 'bun run nested'],
    ['eslint ~/target', "eslint '~/target'"],
    ["eslint '~/target'", 'eslint ~/target'],
  ])('abstains from %s versus %s', (command, body) => {
    const dir = project({ task: body })
    expect(equivalentScript(command, 'bun run task', dir)).toBe(false)
    expect(readFileSync(join(dir, 'sentinel'), 'utf8')).toBe('unchanged')
  })
  test.each(['pretask', 'posttask'])('abstains with %s lifecycle', (lifecycle) => {
    expect(
      equivalentScript(
        'eslint src/',
        'bun run task',
        project({ task: 'eslint src/', [lifecycle]: '' }),
      ),
    ).toBe(false)
  })
  test.each([
    'make lint',
    './lint.sh',
    'yarn task',
    'yarn add',
    'bun run missing',
    'bun run task -- src/',
    'FOO=x bun run task',
  ])('unverifiable recommendation %s remains nonblocking', (recommend) => {
    const dir = project({ task: 'eslint src/' })
    expect(equivalentScript('eslint src/', recommend, dir)).toBe(false)
  })
  test('yarn built-in shorthand never resolves scripts.add', () => {
    const dir = project({ add: 'eslint src/' })
    expect(equivalentScript('eslint src/', 'yarn add', dir)).toBe(false)
    expect(equivalentScript('eslint src/', 'yarn run add', dir)).toBe(true)
  })
  test('missing or malformed package data abstains', () => {
    const dir = project()
    for (const bytes of ['{', 'null', '{"scripts":[]}', '{"scripts":{"task":7}}']) {
      writeFileSync(join(dir, 'package.json'), bytes)
      expect(equivalentScript('eslint src/', 'bun run task', dir)).toBe(false)
    }
    rmSync(join(dir, 'package.json'))
    expect(equivalentScript('eslint src/', 'bun run task', dir)).toBe(false)
  })
  for (const agent of [undefined, 'claude-code', 'codex']) {
    test(`${agent}: verified block, debug-only skip, detection and escape compatibility`, async () => {
      const dir = project({ lint: 'eslint src/' })
      const config = { mappings: [{ match: 'eslint', recommend: 'bun run lint' }] }
      const invoke = (command: string, settings = config) =>
        hook.PreToolUse!(context(dir, command, agent) as never, settings)
      expect((await invoke('eslint src/')).result).toBe('block')
      for (const command of [
        'eslint test/',
        'echo "eslint"',
        'cat x | eslint src/',
        'ALLOW_DIRECT_TOOL=true eslint src/',
        'bun run lint',
      ]) {
        const result = await invoke(command)
        expect(result.result).toBe('skip')
        expect(Object.keys(result).every((key) => ['result', 'debugMessage'].includes(key))).toBe(
          true,
        )
      }
      expect((await invoke('eslint src/', { mappings: [] })).result).toBe('skip')
      expect(
        (await invoke('eslint src/', { mappings: [{ match: '(', recommend: 'bun run lint' }] }))
          .result,
      ).toBe('skip')
    })
  }
})
