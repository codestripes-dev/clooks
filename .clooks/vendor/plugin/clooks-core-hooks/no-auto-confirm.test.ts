import { describe, expect, test } from 'bun:test'
import type { PreToolUseContext, SessionStartContext } from './types'
import {
  hook,
  confirmationTokens,
  isAutoConfirm,
} from './no-auto-confirm'

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
  } as PreToolUseContext
}

const DEFAULT_CONFIG = {}

describe('bounded confirmation regressions', () => {
  test.each([
    "echo 'y' | command",
    'echo "yes" | command',
    "printf '%s\\n' 'yes' | command",
    "printf '%b' 'y\\n' | command",
    "A='literal space' echo 'y' | command",
    "echo ok\nprintf 'y\\n' | command",
    "echo ok; echo 'y' | command",
    'yes $WORD | command',
    'yes "$ANSWER" | command',
    'yes | command; echo $(date)',
    'echo "yes" | command; echo `date`',
    "yes | command; cat <<EOF\ntext\nEOF",
    "yes | command; echo 'unfinished",
  ])('blocks supported pipeline: %s', (command) => {
    expect(isAutoConfirm(command)).toBe(true)
    expect(hook.PreToolUse!(makeCtx(command), DEFAULT_CONFIG).result).toBe('block')
  })

  test.each([
    'echo "echo y | command"',
    '# echo y | command',
    'echo ok # echo y | command',
    "echo 'a; echo y | cmd'",
    'echo "$(echo y | command)"',
    'cat <<EOF\necho y | command\nEOF',
    "echo 'y | command",
    'echo "$ANSWER" | command',
    'echo y* | command',
    "printf '%s' 'y\\n' | command",
    'echo y || command',
    'echo hello > yes | cat',
    'echo hello >> yes | cat',
    'cat < yes | cat',
  ])('skips inert or unsupported text: %s', (command) => {
    expect(isAutoConfirm(command)).toBe(false)
    expect(hook.PreToolUse!(makeCtx(command), DEFAULT_CONFIG).result).toBe('skip')
  })
})

describe('hook.SessionStart', () => {
  test.each(['claude-code', 'codex'])('announces agent-neutral guidance for %s', (agent) => {
    const ctx = {
      ...makeCtx(''),
      event: 'SessionStart',
      agent,
    } as unknown as SessionStartContext
    const result = hook.SessionStart!(ctx, DEFAULT_CONFIG) as any
    expect(result.result).toBe('skip')
    expect(result.debugMessage).toBe('no-auto-confirm: announced')
    expect(result.injectContext).toContain('Shell commands will be blocked for')
    expect(result.injectContext).not.toContain('Bash')
    expect(result.injectContext).toContain('`yes |`, `echo y |`, `printf y |`')
    expect(result.injectContext).toContain('`-y`, `--yes`, `--force`, `--non-interactive`, `-auto-approve`')
    expect(result.injectContext).toContain('ask the user to run the command interactively')
  })
})

// =============================================================================
// Section 1: Utility function tests
// =============================================================================

describe('confirmationTokens', () => {
  test('retains quoted words and distinguishes operators from inert text', () => {
    expect(confirmationTokens(`A='literal space' echo "y" | command # yes | other`)).toEqual([
      { kind: 'word', value: 'A=literal space', literal: true },
      { kind: 'word', value: 'echo', literal: true },
      { kind: 'word', value: 'y', literal: true },
      { kind: 'operator', value: '|' },
      { kind: 'word', value: 'command', literal: true },
    ])
    expect(confirmationTokens("echo 'yes | command'")).toEqual([
      { kind: 'word', value: 'echo', literal: true },
      { kind: 'word', value: 'yes | command', literal: true },
    ])
  })
})

describe('isAutoConfirm', () => {
  // --- yes patterns ---
  test.each([
    ['yes |', 'yes | rm -rf /tmp', true],
    ['yes | (no space before pipe)', 'yes| command', true],
    ['yes with custom word', 'yes sure | command', true],
    ['yes with full path', '/usr/bin/yes | command', true],
    ['yes with relative path', './yes | command', true],
    ['yes with homebrew path', '/opt/homebrew/bin/yes | command', true],
    ['yes standalone (no pipe)', 'yes', false],
    ['yes with arg (no pipe)', 'yes sure', false],
    ['YES | (false-positive: uppercase command — not a valid Linux binary)', 'YES | command', false],
    ['escaped yes command', '\\yes | command', true],
    ['yes with two arguments', 'yes sure thing | command', true],
  ])('yes: %s → %s', (_label, input, expected) => {
    expect(isAutoConfirm(input)).toBe(expected)
  })

  // --- echo patterns ---
  test.each([
    ['echo y |', 'echo y | apt install foo', true],
    ['echo Y | (uppercase)', 'echo Y | command', true],
    ['echo yes |', 'echo yes | dangerous-cmd', true],
    ['echo YES | (uppercase)', 'echo YES | command', true],
    ['echo Yes | (mixed case)', 'echo Yes | command', true],
    ['echo -e y |', 'echo -e y | command', true],
    ['echo -e yes |', 'echo -e YES | command', true],
    ['echo -n y |', 'echo -n y | command', true],
    ['echo -n yes |', 'echo -n yes | command', true],
    ['echo -ne y |', 'echo -ne y | command', true],
    ['echo -en y |', 'echo -en y | command', true],
    ['echo -E y |', 'echo -E y | command', true],
    ['echo -E yes |', 'echo -E yes | command', true],
    ['echo -nE y |', 'echo -nE y | command', true],
    ['echo -En y |', 'echo -En y | command', true],
    ['echo y| (no space before pipe)', 'echo y| command', true],
    ['echo hello | (false-positive: not a confirm token)', 'echo hello | command', false],
    ['echo yesterday | (false-positive: starts with y but not a token)', 'echo yesterday | command', false],
    ['echo ye | (false-positive: partial token)', 'echo ye | command', false],
    ['echo (no arg)', 'echo | command', false],
    ['echo with redirect (not a pipe)', 'echo y > file', false],
    ['echo -nne y | (repeated flag chars — regression test)', 'echo -nne y | command', true],
    ['echo -een yes | (repeated flag chars)', 'echo -een yes | command', true],
    ['echo -e -n y | (known limitation: two separate flag tokens)', 'echo -e -n y | command', false],
    ['echo -n -e yes | (known limitation: two separate flag tokens)', 'echo -n -e yes | command', false],
  ])('echo: %s → %s', (_label, input, expected) => {
    expect(isAutoConfirm(input)).toBe(expected)
  })

  // --- printf patterns ---
  test.each([
    ['printf y |', 'printf y | command', true],
    ['printf Y | (uppercase)', 'printf Y | command', true],
    ['printf yes |', 'printf yes | command', true],
    ['printf YES | (uppercase)', 'printf YES | command', true],
    ['printf hello | (false-positive: not a token)', 'printf hello | command', false],
    ['printf (no arg)', 'printf | command', false],
  ])('printf: %s → %s', (_label, input, expected) => {
    expect(isAutoConfirm(input)).toBe(expected)
  })

  // --- Not blocked ---
  test.each([
    ['true | command', 'true | command', false],
    ['cat file | grep', 'cat file | grep pattern', false],
    ['command with no pipe', 'apt install -y foo', false],
  ])('not blocked: %s → %s', (_label, input, expected) => {
    expect(isAutoConfirm(input)).toBe(expected)
  })
})

// =============================================================================
// Section 2: hook.PreToolUse — skip conditions
// =============================================================================

describe('hook.PreToolUse — skip conditions', () => {
  test('skips non-Bash tools', () => {
    const result = hook.PreToolUse!(makeCtx('yes | command', 'Read'), DEFAULT_CONFIG)
    expect(result.result).toBe('skip')
  })

  test('skips empty command', () => {
    const result = hook.PreToolUse!(makeCtx(''), DEFAULT_CONFIG)
    expect(result.result).toBe('skip')
  })
})

// =============================================================================
// Section 3: hook.PreToolUse — true positives
// =============================================================================

describe('hook.PreToolUse — true positives', () => {
  test.each([
    ['yes |', 'yes | rm -rf /tmp'],
    ['yes with custom word', 'yes sure | command'],
    ['echo y |', 'echo y | apt install foo'],
    ['echo YES | (case-insensitive)', 'echo YES | dangerous-cmd'],
    ['echo -e y |', 'echo -e y | command'],
    ['echo -n y |', 'echo -n y | command'],
    ['echo -ne y |', 'echo -ne y | command'],
    ['echo -en y |', 'echo -en y | command'],
    ['printf y |', 'printf y | command'],
    ['printf YES |', 'printf YES | command'],
    ['quoted echo confirmation', 'echo "y" | command'],
    ['quoted printf confirmation', "printf 'y\\n' | apt install foo"],
    ['/usr/bin/yes |', '/usr/bin/yes | command'],
    ['compound: cd && yes |', 'cd /tmp && yes | rm -rf *'],
    ['compound: cmd ; echo y |', 'ls ; echo y | command'],
    ['env var prefix', 'NPM_TOKEN=xxx yes | command'],
    ['multiple env vars', 'A=1 B=2 echo y | command'],
    ['leading whitespace', '  yes | command'],
  ])('blocks %s', (_label, command) => {
    const result = hook.PreToolUse!(makeCtx(command), DEFAULT_CONFIG) as any
    expect(result.result).toBe('block')
    expect(result.reason).toContain('non-interactive mode')
    expect(result.reason).toContain('-y, --yes, --force')
  })
})

// =============================================================================
// Section 4: hook.PreToolUse — true negatives
// =============================================================================

describe('hook.PreToolUse — true negatives', () => {
  test.each([
    ['true | command (legitimate pipe)', 'true | command'],
    ['echo hello | command (false-positive: not a confirm token)', 'echo hello | command'],
    ['yes standalone (no pipe)', 'yes'],
    ['echo yesterday | (false-positive: starts with y)', 'echo yesterday | command'],
    ['echo ye | (false-positive: partial token)', 'echo ye | command'],
    ['quoted: echo \'yes | ...\'', "echo 'yes | something'"],
    ['cat file | grep (not auto-confirm)', 'cat file | grep pattern'],
    ['apt install -y (using designed flag)', 'apt install -y foo'],
    ['command with no pipe at all', 'rm -rf /tmp'],
  ])('allows %s', (_label, command) => {
    const result = hook.PreToolUse!(makeCtx(command), DEFAULT_CONFIG)
    expect(result.result).toBe('skip')
  })
})

// =============================================================================
// Section 5: Edge cases
// =============================================================================

describe('hook.PreToolUse — edge cases', () => {
  test('block message preserves non-interactive guidance', () => {
    const result = hook.PreToolUse!(makeCtx('yes | command'), DEFAULT_CONFIG) as any
    expect(result.reason).toBe(
      'Piping auto-responses (yes, echo, printf) into a command simulates human input ' +
      "instead of using the command's non-interactive mode. Use the command's own flag " +
      '(e.g. -y, --yes, --force, --non-interactive, -auto-approve) or ask the user to ' +
      'run the command interactively.'
    )
  })

  test('debugMessage includes the original command', () => {
    const result = hook.PreToolUse!(makeCtx('yes | rm -rf /tmp'), DEFAULT_CONFIG) as any
    expect(result.debugMessage).toContain('yes | rm -rf /tmp')
  })

  test('debugMessage includes original command for echo pattern', () => {
    const result = hook.PreToolUse!(makeCtx('echo y | apt install foo'), DEFAULT_CONFIG) as any
    expect(result.debugMessage).toContain('echo y | apt install foo')
  })

  test('debugMessage includes original command for printf pattern', () => {
    const result = hook.PreToolUse!(makeCtx('printf yes | command'), DEFAULT_CONFIG) as any
    expect(result.debugMessage).toContain('printf yes | command')
  })

  test('only first matching segment triggers block', () => {
    // Both segments match, but block fires on the first
    const result = hook.PreToolUse!(makeCtx('yes | cmd1 && echo y | cmd2'), DEFAULT_CONFIG) as any
    expect(result.result).toBe('block')
  })

  test('second segment match after innocent first segment', () => {
    const result = hook.PreToolUse!(makeCtx('ls -la && yes | command'), DEFAULT_CONFIG) as any
    expect(result.result).toBe('block')
  })

  test('quoted auto-confirm text is inert across segments', () => {
    const result = hook.PreToolUse!(makeCtx("echo 'yes | something' && ls"), DEFAULT_CONFIG)
    expect(result.result).toBe('skip')
  })

  test('compound with || operator: yes | cmd || fallback', () => {
    // Single | is kept within segment, || splits segments
    const result = hook.PreToolUse!(makeCtx('yes | rm -rf / || echo failed'), DEFAULT_CONFIG) as any
    expect(result.result).toBe('block')
  })

  test('yes with quoted argument still blocks', () => {
    const result = hook.PreToolUse!(makeCtx("yes 'confirm' | rm -rf /tmp"), DEFAULT_CONFIG) as any
    expect(result.result).toBe('block')
  })
})
