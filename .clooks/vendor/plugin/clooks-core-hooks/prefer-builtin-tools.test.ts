import { describe, expect, test } from 'bun:test'
import type { PreToolUseContext } from "./types"
import {
  getSegments,
  extractSegmentInfo,
  isTailFollow,
  hasSedInplace,
  hasRedirect,
  hook,
} from "./prefer-builtin-tools"

// --- Helpers ---

function makeCtx(command: string, toolName = 'Bash'): PreToolUseContext {
  return {
    event: 'PreToolUse',
    toolName,
    toolInput: { command },
    originalToolInput: { command },
    toolUseId: 'tu-test',
    sessionId: 'test-session',
    cwd: '/tmp',
    permissionMode: 'default',
    transcriptPath: '/tmp/transcript.jsonl',
    allow: (opts = {}) => ({ result: 'allow', ...opts }),
    block: (opts) => ({ result: 'block', ...opts }),
    skip: (opts = {}) => ({ result: 'skip', ...opts }),
    ask: (opts) => ({ result: 'ask', ...opts }),
    defer: (opts = {}) => ({ result: 'defer', ...opts }),
  } as unknown as PreToolUseContext
}

type Config = {
  [key: string]: boolean | { match: string; message: string }[] | undefined
  additionalRules?: { match: string; message: string }[]
}

const DEFAULT_CONFIG: Config = {
  "cat": true,
  "head": true,
  "tail": true,
  "grep": true,
  "find": true,
  "sed-inplace": true,
  "ls": true,
  "sleep": true,
  "echo-redirect": true,
  additionalRules: [],
}

// =============================================================================
// Section 1: Segment-processing utility tests
// =============================================================================

describe('getSegments', () => {
  test.each([
    ['cat file.txt', ['cat file.txt']],
    ['cat file && grep pattern file.ts', ['cat file', 'grep pattern file.ts']],
    ['cd /tmp ; ls', ['cd /tmp', 'ls']],
    ['echo ok || cat err.log', ['echo ok', 'cat err.log']],
    ['', []],
    ['cat file && grep pat && find . -name', ['cat file', 'grep pat', 'find . -name']],
  ] as [string, string[]][])(
    '%s',
    (input, expected) => {
      expect(getSegments(input)).toEqual(expected)
    },
  )
})

describe('extractSegmentInfo', () => {
  test('cat file.txt', () => {
    expect(extractSegmentInfo('cat file.txt')).toEqual({
      command: 'cat file.txt',
      hasPipe: false,
      firstWord: 'cat',
    })
  })

  test('cat file.txt | jq .version', () => {
    expect(extractSegmentInfo('cat file.txt | jq .version')).toEqual({
      command: 'cat file.txt',
      hasPipe: true,
      firstWord: 'cat',
    })
  })

  test('  head -20 file.ts', () => {
    expect(extractSegmentInfo('  head -20 file.ts')).toEqual({
      command: 'head -20 file.ts',
      hasPipe: false,
      firstWord: 'head',
    })
  })

  test('NPM_TOKEN=xxx cat file', () => {
    expect(extractSegmentInfo('NPM_TOKEN=xxx cat file')).toEqual({
      command: 'cat file',
      hasPipe: false,
      firstWord: 'cat',
    })
  })

  test('A=1 B=2 grep pat f.ts', () => {
    expect(extractSegmentInfo('A=1 B=2 grep pat f.ts')).toEqual({
      command: 'grep pat f.ts',
      hasPipe: false,
      firstWord: 'grep',
    })
  })

  test('ps aux | grep node', () => {
    expect(extractSegmentInfo('ps aux | grep node')).toEqual({
      command: 'ps aux',
      hasPipe: true,
      firstWord: 'ps',
    })
  })

  test('empty string', () => {
    expect(extractSegmentInfo('')).toEqual({
      command: '',
      hasPipe: false,
      firstWord: '',
    })
  })

  test('X=1 Y=2 Z=3 ls', () => {
    expect(extractSegmentInfo('X=1 Y=2 Z=3 ls')).toEqual({
      command: 'ls',
      hasPipe: false,
      firstWord: 'ls',
    })
  })
})

// =============================================================================
// Section 2: Per-rule detection function tests
// =============================================================================

describe('isTailFollow', () => {
  test.each([
    ['tail -f logfile', true],
    ['tail -F logfile', true],
    ['tail --follow logfile', true],
    ['tail -f -n 100 logfile', true],
    ['tail -100f logfile', true],
    ['tail -20 file.txt', false],
    ['tail -n 50 file.txt', false],
    ['tail file.txt', false],
  ])('%s → %s', (input, expected) => {
    expect(isTailFollow(input)).toBe(expected)
  })
})

describe('hasSedInplace', () => {
  test.each([
    ["sed -i 's/old/new/' f.ts", true],
    ["sed -i.bak 's/a/b/' f.ts", true],
    ["sed --in-place 's/a/b/' f", true],
    ["sed 's/old/new/'", false],
    ["sed 's/old/new/' file.ts", false],
    ["sed -e 's/a/b/' -e 's/c/d/'", false],
    ["sed -n '/pattern/p' f.ts", false],
  ])('%s → %s', (input, expected) => {
    expect(hasSedInplace(input)).toBe(expected)
  })
})

describe('hasRedirect', () => {
  test.each([
    ['echo hello > file.txt', true],
    ['echo hello >> file.txt', true],
    ['printf content > file.txt', true],
    ['echo hello', false],
    ['echo hello world', false],
    ['printf content', false],
  ])('%s → %s', (input, expected) => {
    expect(hasRedirect(input)).toBe(expected)
  })
})

// =============================================================================
// Section 3: Handler integration tests
// =============================================================================

describe('hook.PreToolUse', () => {
  // --- Skip conditions ---

  test('skips non-Bash tools', () => {
    const result = hook.PreToolUse!(makeCtx('cat file.txt', 'Read'), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('skips empty command', () => {
    const result = hook.PreToolUse!(makeCtx(''), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  // --- True positive — one per rule ---

  test.each([
    ['cat', 'cat file.txt'],
    ['head', 'head -20 file.txt'],
    ['tail', 'tail -20 file.txt'],
    ['grep', 'grep pattern file.ts'],
    ['grep', 'rg pattern file.ts'],
    ['grep', 'egrep pattern file.ts'],
    ['grep', 'fgrep pattern file.ts'],
    ['find', 'find'],
    ['find', 'find . -name "*.ts"'],
    ['sed-inplace', "sed -i 's/old/new/' file.ts"],
    ['ls', 'ls'],
    ['ls', 'ls -la'],
    ['ls', 'ls -laR'],
    ['sleep', 'sleep 5'],
    ['echo-redirect', 'echo hello > file.txt'],
    ['echo-redirect', 'printf content > file.txt'],
  ])('blocks %s: %s', (ruleId, command) => {
    const result = hook.PreToolUse!(makeCtx(command), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain(`[${ruleId}]`)
  })

  // --- True negative — safe alternative / exception per rule ---

  test.each([
    ['allows: cat with pipe (pipe-source)', 'cat file.txt | jq .version'],
    ['allows: head with pipe (pipe-source)', 'head -5 file | wc -l'],
    ['allows: tail -f (log following)', 'tail -f logfile'],
    ['allows: tail -F (log following)', 'tail -F logfile'],
    ['allows: tail --follow (log following)', 'tail --follow logfile'],
    ['allows: grep as pipe target', 'ps aux | grep node'],
    ['allows: grep with pipe (pipe-source)', 'grep pattern file.ts | wc -l'],
    ['allows: find with pipe (pipe-source)', 'find . -name "*.ts" | head'],
    ['allows: sed without -i (stream processing)', "sed 's/old/new/' file.ts"],
    ['allows: sed -i with pipe (pipe-source)', "sed -i 's/a/b/' f | tee log"],
    ['allows: ls with pipe (pipe-source)', 'ls | head'],
    ['allows: echo without redirect', 'echo hello'],
    ['allows: printf without redirect', 'printf "content"'],
    ['allows: echo with pipe (not redirect)', 'echo hello | tee file'],
  ])('%s: %s', (_label, command) => {
    const result = hook.PreToolUse!(makeCtx(command), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('skip')
  })

  // --- Escape hatch ---

  test('escape hatch allows cat', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_BUILTIN_COMMAND=true cat file.txt'),
      DEFAULT_CONFIG,
    )
    expect(result).toEqual({ result: 'skip' })
  })

  test('escape hatch allows grep', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_BUILTIN_COMMAND=true grep pattern file'),
      DEFAULT_CONFIG,
    )
    expect(result).toEqual({ result: 'skip' })
  })

  test('escape hatch allows sleep', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_BUILTIN_COMMAND=true sleep 5'),
      DEFAULT_CONFIG,
    )
    expect(result).toEqual({ result: 'skip' })
  })

  test('escape hatch applies to all segments in compound command', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_BUILTIN_COMMAND=true echo ok && cat file.txt'),
      DEFAULT_CONFIG,
    )
    expect(result).toEqual({ result: 'skip' })
  })

  test('escape hatch does NOT apply when only in second segment', () => {
    const result = hook.PreToolUse!(
      makeCtx('cat file.txt ; ALLOW_BUILTIN_COMMAND=true echo ok'),
      DEFAULT_CONFIG,
    ) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[cat]')
  })

  test('escape hatch does NOT skip additionalRules', () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      additionalRules: [{ match: 'curl', message: 'Use WebFetch' }],
    }
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_BUILTIN_COMMAND=true curl http://example.com'),
      config,
    ) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toBe('Use WebFetch')
  })

  // --- Config disabling ---

  test('config disables cat rule', () => {
    const config: Config = { ...DEFAULT_CONFIG, "cat": false }
    const result = hook.PreToolUse!(makeCtx('cat file.txt'), config)
    expect(result).toEqual({ result: 'skip' })
  })

  test('config disabling cat does not affect grep', () => {
    const config: Config = { ...DEFAULT_CONFIG, "cat": false }
    const result = hook.PreToolUse!(makeCtx('grep pattern file.ts'), config) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[grep]')
  })

  test('config disables sleep rule', () => {
    const config: Config = { ...DEFAULT_CONFIG, "sleep": false }
    const result = hook.PreToolUse!(makeCtx('sleep 5'), config)
    expect(result).toEqual({ result: 'skip' })
  })

  // --- additionalRules ---

  test('additionalRules with custom regex', () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      additionalRules: [{ match: '^curl https?://', message: 'Consider WebFetch' }],
    }
    const result = hook.PreToolUse!(makeCtx('curl https://example.com'), config) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toBe('Consider WebFetch')
  })

  test('additionalRules debugMessage includes regex', () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      additionalRules: [{ match: '^curl', message: 'Use WebFetch' }],
    }
    const result = hook.PreToolUse!(makeCtx('curl http://example.com'), config) as unknown as Record<string, unknown>
    expect(result.debugMessage).toBe("prefer-builtin-tools: blocked by additionalRule '^curl'")
  })

  test('additionalRules with invalid regex does not crash', () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      additionalRules: [{ match: '[invalid', message: 'Bad' }],
    }
    // Built-in cat rule still fires; invalid additional rule is skipped
    const result = hook.PreToolUse!(makeCtx('cat file.txt'), config) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[cat]')
  })

  // --- Sanitization ---

  test('sanitization: cat inside single quotes is stripped', () => {
    const result = hook.PreToolUse!(makeCtx("echo 'use cat here'"), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('sanitization: grep inside double quotes is stripped', () => {
    const result = hook.PreToolUse!(makeCtx('echo "use grep here"'), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('sanitization: cat in comment is stripped', () => {
    const result = hook.PreToolUse!(makeCtx('echo hello # cat file.txt'), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('sanitization: escape hatch inside quotes is not treated as escape hatch', () => {
    const result = hook.PreToolUse!(
      makeCtx('echo "ALLOW_BUILTIN_COMMAND=true" && cat file.txt'),
      DEFAULT_CONFIG,
    ) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[cat]')
  })

  // --- debugMessage ---

  test('debugMessage contains rule ID', () => {
    const result = hook.PreToolUse!(makeCtx('cat file.txt'), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.debugMessage).toBe("prefer-builtin-tools: blocked by rule 'cat'")
  })

  // --- VAR=val stripping ---

  test('NPM_TOKEN=xxx cat file.txt is blocked', () => {
    const result = hook.PreToolUse!(makeCtx('NPM_TOKEN=xxx cat file.txt'), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[cat]')
  })

  test('A=1 B=2 grep pattern f.ts is blocked', () => {
    const result = hook.PreToolUse!(makeCtx('A=1 B=2 grep pattern f.ts'), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[grep]')
  })

  // --- Non-matching commands (skip, not allow) ---

  test.each([
    ['git status'],
    ['npm install'],
    ['node script.js'],
    ['awk "{print $1}" file'],
    ['curl https://example.com'],
    ['wc -l file.txt'],
    ['diff file1 file2'],
    ['touch file.txt'],
    ['mkdir -p src/utils'],
  ])('skips non-matching command: %s', (command) => {
    const result = hook.PreToolUse!(makeCtx(command), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })
})

// =============================================================================
// Section 4: Edge case tests
// =============================================================================

describe('edge cases', () => {
  test('sleep has NO pipe-source exception', () => {
    const result = hook.PreToolUse!(makeCtx('sleep 5 | echo done'), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[sleep]')
  })

  test('multiple blocked commands in compound statement — blocks on first match (cat)', () => {
    const result = hook.PreToolUse!(
      makeCtx('cat file.txt && grep pattern file.ts'),
      DEFAULT_CONFIG,
    ) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[cat]')
  })

  test('echo-redirect: append redirect', () => {
    const result = hook.PreToolUse!(makeCtx('echo content >> file.txt'), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[echo-redirect]')
  })

  test('echo-redirect: stderr and stdout redirect', () => {
    const result = hook.PreToolUse!(makeCtx('echo content 2> /dev/null > file.txt'), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[echo-redirect]')
  })

  test('sed -i.bak is blocked', () => {
    const result = hook.PreToolUse!(makeCtx("sed -i.bak 's/old/new/' file.ts"), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[sed-inplace]')
  })

  test('sed --in-place is blocked', () => {
    const result = hook.PreToolUse!(makeCtx("sed --in-place 's/old/new/' file.ts"), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[sed-inplace]')
  })

  // ls variants — all blocked
  test.each([
    ['ls'],
    ['ls -la'],
    ['ls src/'],
    ['ls -R'],
  ])('ls variant blocked: %s', (command) => {
    const result = hook.PreToolUse!(makeCtx(command), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[ls]')
  })

  // echo/printf without redirect — NOT blocked
  test('echo without redirect is not blocked', () => {
    const result = hook.PreToolUse!(makeCtx('echo "hello world"'), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('printf without redirect is not blocked', () => {
    const result = hook.PreToolUse!(makeCtx('printf "%s\\n" "hello"'), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('blocked command in second segment of compound statement', () => {
    const result = hook.PreToolUse!(
      makeCtx('cd /tmp && cat file.txt'),
      DEFAULT_CONFIG,
    ) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[cat]')
  })

  test('tail -100f is allowed (combined numeric+follow flag)', () => {
    const result = hook.PreToolUse!(makeCtx('tail -100f logfile'), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('sed -i with empty quotes (macOS idiom) is blocked after sanitization', () => {
    const result = hook.PreToolUse!(makeCtx("sed -i '' 's/old/new/' file.ts"), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[sed-inplace]')
  })

  test('command substitution: cat inside $() is not detected (known limitation)', () => {
    const result = hook.PreToolUse!(makeCtx('echo $(cat file.txt)'), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('echo-redirect: 2>&1 triggers false positive (known limitation — hasRedirect is intentionally broad)', () => {
    const result = hook.PreToolUse!(makeCtx('echo hello 2>&1'), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[echo-redirect]')
  })

  test('echo-redirect: redirect to /dev/null is still blocked', () => {
    const result = hook.PreToolUse!(makeCtx("echo 'hello' > /dev/null"), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[echo-redirect]')
  })

  test('leading whitespace is handled correctly', () => {
    const result = hook.PreToolUse!(makeCtx('  cat file.txt'), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[cat]')
  })

  // Commands that look like matches but aren't
  test.each([
    ['category file.txt'],
    ['headless-chrome --start'],
    ['greping is fun'],
    ['finding-nemo'],
    ['sleeping-beauty'],
    ['sudo cat file.txt'],
    ['/usr/bin/cat file.txt'],
  ])('does not match similar-looking command: %s', (command) => {
    const result = hook.PreToolUse!(makeCtx(command), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })
})
