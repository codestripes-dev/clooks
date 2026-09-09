import { describe, expect, test } from 'bun:test'
import type { PreToolUseContext, SessionStartContext } from './types'
import {
  hook,
  expandAllowed,
  isBlocked,
  generateBlockMessage,
  detectBlockedTool,
  isAdditionalBlocked,
} from './js-package-manager-guard'

// --- Helpers ---

type Config = {
  allowed: string[]
  additionalBlocked?: Array<{ tool: string; message: string }>
}

const DEFAULT_CONFIG: Config = {
  allowed: [],
  additionalBlocked: [],
}

function makePreToolUseCtx(command: string, toolName = 'Bash'): PreToolUseContext {
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
// Section 1: expandAllowed tests
// =============================================================================

describe('expandAllowed', () => {
  test.each([
    ['single PM: bun', ['bun'], ['bun', 'bunx']],
    ['single PM: npm', ['npm'], ['npm', 'npx', 'node']],
    ['single PM: pnpm', ['pnpm'], ['pnpm', 'pnpx']],
    ['single PM: yarn (no extensions)', ['yarn'], ['yarn']],
    ['single runtime: deno (no extensions)', ['deno'], ['deno']],
    ['single runtime: node (no reverse extension)', ['node'], ['node']],
    ['single runner: bunx (no reverse extension)', ['bunx'], ['bunx']],
    ['multiple PMs: bun + npm', ['bun', 'npm'], ['bun', 'bunx', 'npm', 'npx', 'node']],
    ['all PMs', ['npm', 'yarn', 'pnpm', 'bun', 'deno'], ['npm', 'npx', 'node', 'yarn', 'pnpm', 'pnpx', 'bun', 'bunx', 'deno']],
    ['empty array', [], []],
    ['unknown tool (not in universe)', ['webpack'], ['webpack']],
  ] as [string, string[], string[]][])(
    '%s: expandAllowed(%j)',
    (_label, input, expected) => {
      const result = expandAllowed(input)
      expect(result).toEqual(new Set(expected))
    },
  )
})

// =============================================================================
// Section 2: isBlocked tests
// =============================================================================

describe('isBlocked', () => {
  const expanded = expandAllowed(['bun'])  // {bun, bunx}

  test.each([
    ['npm — in universe, not allowed', 'npm', true],
    ['npx — in universe, not allowed', 'npx', true],
    ['node — in universe, not allowed', 'node', true],
    ['yarn — in universe, not allowed', 'yarn', true],
    ['pnpm — in universe, not allowed', 'pnpm', true],
    ['pnpx — in universe, not allowed', 'pnpx', true],
    ['deno — in universe, not allowed', 'deno', true],
    ['bun — in universe AND allowed', 'bun', false],
    ['bunx — auto-extended', 'bunx', false],
    ['cargo — not in universe', 'cargo', false],
    ['pip — not in universe', 'pip', false],
    ['git — not in universe', 'git', false],
    ['empty string', '', false],
  ] as [string, string, boolean][])(
    '%s',
    (_label, firstWord, expected) => {
      expect(isBlocked(firstWord, expanded)).toBe(expected)
    },
  )
})

// =============================================================================
// Section 3: generateBlockMessage tests
// =============================================================================

describe('generateBlockMessage', () => {
  describe('allowed: ["bun"]', () => {
    const expanded = expandAllowed(['bun'])
    const allowed = ['bun']

    test.each([
      ['npm blocked → suggest bun (PM)', 'npm', 'bun', 'for package management'],
      ['npx blocked → suggest bunx (runner)', 'npx', 'bunx', 'for package execution'],
      ['node blocked → suggest bun (runtime)', 'node', 'bun', 'as its JS runtime'],
      ['yarn blocked → suggest bun (PM)', 'yarn', 'bun', 'for package management'],
      ['pnpx blocked → suggest bunx (runner)', 'pnpx', 'bunx', 'for package execution'],
      ['deno blocked → suggest bun (runtime)', 'deno', 'bun', 'as its JS runtime'],
    ] as [string, string, string, string][])(
      '%s',
      (_label, blocked, expectedSuggestion, expectedContext) => {
        const msg = generateBlockMessage(blocked, expanded, allowed)
        expect(msg).toContain('[js-package-manager-guard]')
        expect(msg).toContain(expectedSuggestion)
        expect(msg).toContain(expectedContext)
        expect(msg).toContain(`instead of '${blocked}'`)
      },
    )
  })

  describe('allowed: ["npm"]', () => {
    const expanded = expandAllowed(['npm'])
    const allowed = ['npm']

    test.each([
      ['bun blocked → suggest npm (PM)', 'bun', 'npm', 'for package management'],
      ['bunx blocked → suggest npx (runner)', 'bunx', 'npx', 'for package execution'],
      ['deno blocked → suggest node (runtime)', 'deno', 'node', 'as its JS runtime'],
    ] as [string, string, string, string][])(
      '%s',
      (_label, blocked, expectedSuggestion, expectedContext) => {
        const msg = generateBlockMessage(blocked, expanded, allowed)
        expect(msg).toContain('[js-package-manager-guard]')
        expect(msg).toContain(expectedSuggestion)
        expect(msg).toContain(expectedContext)
        expect(msg).toContain(`instead of '${blocked}'`)
      },
    )
  })

  describe('allowed: ["yarn"] (edge cases — no runner, no runtime)', () => {
    const expanded = expandAllowed(['yarn'])
    const allowed = ['yarn']

    test.each([
      ['npm blocked → suggest yarn (PM)', 'npm', 'yarn', 'for package management'],
      ['npx blocked → fallback to yarn (no runner for yarn)', 'npx', 'yarn', 'for package execution'],
    ] as [string, string, string, string][])(
      '%s',
      (_label, blocked, expectedSuggestion, expectedContext) => {
        const msg = generateBlockMessage(blocked, expanded, allowed)
        expect(msg).toContain('[js-package-manager-guard]')
        expect(msg).toContain(expectedSuggestion)
        expect(msg).toContain(expectedContext)
        expect(msg).toContain(`instead of '${blocked}'`)
      },
    )

    test('node blocked → generic fallback (no runtime in expanded)', () => {
      const msg = generateBlockMessage('node', expanded, allowed)
      expect(msg).toContain('[js-package-manager-guard]')
      expect(msg).toContain('not allowed')
      expect(msg).toContain('Allowed tools: yarn')
    })
  })

  describe('allowed: ["deno"] (edge cases — deno is runtime-primary, not PM-capable for suggestions)', () => {
    const expanded = expandAllowed(['deno'])
    const allowed = ['deno']

    test.each([
      ['npm blocked → generic fallback (deno is not PM-capable)', 'npm'],
      ['bun blocked → generic fallback (same reason)', 'bun'],
      ['npx blocked → generic fallback (no PM = no runner suggestion)', 'npx'],
    ] as [string, string][])(
      '%s',
      (_label, blocked) => {
        const msg = generateBlockMessage(blocked, expanded, allowed)
        expect(msg).toContain('[js-package-manager-guard]')
        expect(msg).toContain('not allowed')
        expect(msg).toContain('Allowed tools: deno')
      },
    )

    test('node blocked → suggest deno (runtime)', () => {
      const msg = generateBlockMessage('node', expanded, allowed)
      expect(msg).toContain('[js-package-manager-guard]')
      expect(msg).toContain('deno')
      expect(msg).toContain('as its JS runtime')
      expect(msg).toContain("instead of 'node'")
    })
  })
})

// =============================================================================
// Section 4: detectBlockedTool tests
// =============================================================================

describe('detectBlockedTool', () => {
  const expanded = expandAllowed(['bun'])

  test.each([
    // Blocked — known universe, not allowed
    ['blocks npm', 'npm install lodash', 'npm'],
    ['blocks npx', 'npx create-react-app my-app', 'npx'],
    ['blocks node', 'node script.js', 'node'],
    ['blocks yarn', 'yarn add lodash', 'yarn'],
    ['blocks pnpm', 'pnpm install', 'pnpm'],
    ['blocks pnpx', 'pnpx tsx script.ts', 'pnpx'],
    ['blocks deno', 'deno run script.ts', 'deno'],

    // Allowed — in expanded set
    ['allows bun (configured)', 'bun install lodash', null],
    ['allows bunx (auto-extended)', 'bunx create-react-app', null],

    // Not in known universe — passes through
    ['allows cargo (not JS)', 'cargo build', null],
    ['allows pip (not JS)', 'pip install requests', null],
    ['allows git (not JS)', 'git status', null],
    ['allows ls (not JS)', 'ls -la', null],

    // Compound commands — first blocked segment wins
    ['blocks npm in second segment', 'bun install && npm publish', 'npm'],
    ['blocks npm in third segment', 'cd /app && bun test && npm publish', 'npm'],
    ['allows if all segments use bun', 'bun install && bun test', null],

    // Pipe targets excluded
    ['allows: npm as pipe target', 'echo test | npm publish', null],
    ['allows: node as pipe target', 'cat script.js | node', null],

    // VAR=val stripping
    ['blocks npm after env var', 'NPM_TOKEN=xxx npm install', 'npm'],
    ['blocks npm after multiple env vars', 'CI=true NPM_TOKEN=xxx npm install', 'npm'],

    // Sanitization — PM names in quotes/comments
    ['allows: npm inside double quotes', 'echo "use npm instead"', null],
    ['allows: npm inside single quotes', "echo 'npm install'", null],
    ['allows: npm in comment', 'echo hello # npm install', null],

    // PM names as non-first words
    ['allows: npm in path', 'ls node_modules/.npm/', null],
    ['allows: node in path', 'cat node_modules/lodash/index.js', null],

    // Multiple pipes — only pre-first-pipe portion checked
    ['allows: npm between two pipes', 'echo test | npm install | grep result', null],
    ['allows: node between two pipes', 'cat file | node process.js | grep done', null],

    // Case sensitivity — tool names are lowercase binaries
    ['allows: NPM (uppercase — not in known universe)', 'NPM install', null],
    ['allows: Npm (mixed case)', 'Npm install', null],
    ['allows: BUN (uppercase)', 'BUN install', null],

    // Edge cases
    ['empty command', '', null],
    ['whitespace only', '   ', null],
  ] as [string, string, string | null][])(
    '%s',
    (_label, command, expected) => {
      expect(detectBlockedTool(command, expanded)).toBe(expected)
    },
  )
})

// =============================================================================
// Section 5: Handler integration tests
// =============================================================================

describe('hook.SessionStart', () => {
  test('unconfigured: empty allowed → skip + injectContext warning', () => {
    const ctx = makeSessionStartCtx()
    const result = hook.SessionStart!(ctx, { allowed: [], additionalBlocked: [] })
    expect(result.result).toBe('skip')
    expect((result as any).injectContext).toContain('CONFIGURATION REQUIRED')
    expect((result as any).injectContext).toContain('js-package-manager-guard')
  })

  test('configured: non-empty allowed → skip + injectContext announcement', () => {
    const ctx = makeSessionStartCtx()
    const result = hook.SessionStart!(ctx, { allowed: ['bun'], additionalBlocked: [] })
    expect(result.result).toBe('skip')
    expect((result as any).injectContext).toContain('js-package-manager-guard')
    expect((result as any).injectContext).toContain('Allowed JS toolchain')
    expect((result as any).injectContext).toContain('`bun`')
    expect((result as any).injectContext).toContain('`bunx`')
    expect((result as any).injectContext).toContain('`npm`')
  })

  test('defensive: missing config.allowed → skip + injectContext', () => {
    const ctx = makeSessionStartCtx()
    const result = hook.SessionStart!(ctx, {} as any)
    expect(result.result).toBe('skip')
    expect((result as any).injectContext).toContain('CONFIGURATION REQUIRED')
  })
})

describe('hook.PreToolUse', () => {
  // --- Skip conditions ---

  test('skips non-Bash tools', () => {
    const ctx = makePreToolUseCtx('npm install', 'Read')
    const result = hook.PreToolUse!(ctx, { allowed: ['bun'] })
    expect(result).toEqual({ result: 'skip' })
  })

  test('skips empty command', () => {
    const ctx = makePreToolUseCtx('')
    const result = hook.PreToolUse!(ctx, { allowed: ['bun'] })
    expect(result).toEqual({ result: 'skip' })
  })

  test('skips when unconfigured (empty allowed)', () => {
    const ctx = makePreToolUseCtx('npm install')
    const result = hook.PreToolUse!(ctx, DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  // --- True positives (block) ---

  test.each([
    ['npm install lodash', 'npm'],
    ['npx create-react-app', 'npx'],
    ['node script.js', 'node'],
    ['yarn add lodash', 'yarn'],
    ['pnpm install', 'pnpm'],
    ['pnpx tsx script.ts', 'pnpx'],
    ['deno run script.ts', 'deno'],
  ] as [string, string][])(
    'blocks %s',
    (command, expectedBlocked) => {
      const ctx = makePreToolUseCtx(command)
      const result = hook.PreToolUse!(ctx, { allowed: ['bun'] }) as any
      expect(result.result).toBe('block')
      expect(result.reason).toContain('[js-package-manager-guard]')
      expect(result.debugMessage).toContain(expectedBlocked)
    },
  )

  // --- True negatives (skip) ---

  test.each([
    ['bun install lodash', 'allowed PM'],
    ['bunx create-app', 'auto-extended runner'],
    ['cargo build', 'non-JS tool'],
    ['git status', 'non-JS tool'],
    ['echo "npm install"', 'PM in quotes (sanitized)'],
  ] as [string, string][])(
    'allows: %s (%s)',
    (command) => {
      const ctx = makePreToolUseCtx(command)
      const result = hook.PreToolUse!(ctx, { allowed: ['bun'] })
      expect(result.result).toBe('skip')
    },
  )

  // --- Multiple allowed PMs ---

  test('allows npm when both bun and npm are allowed', () => {
    const ctx = makePreToolUseCtx('npm install lodash')
    const result = hook.PreToolUse!(ctx, { allowed: ['bun', 'npm'] })
    expect(result.result).toBe('skip')
  })

  test('blocks yarn when bun and npm are allowed', () => {
    const ctx = makePreToolUseCtx('yarn add lodash')
    const result = hook.PreToolUse!(ctx, { allowed: ['bun', 'npm'] }) as any
    expect(result.result).toBe('block')
  })

  // --- additionalBlocked ---

  test('blocks additionalBlocked tool', () => {
    const ctx = makePreToolUseCtx('fruity deploy')
    const config: Config = {
      allowed: ['bun'],
      additionalBlocked: [{ tool: 'fruity', message: "Use 'bun run deploy' instead of 'fruity deploy'." }],
    }
    const result = hook.PreToolUse!(ctx, config) as any
    expect(result.result).toBe('block')
    expect(result.reason).toContain("Use 'bun run deploy'")
    expect(result.reason).toContain('[js-package-manager-guard]')
  })

  test('additionalBlocked does not match allowed tools', () => {
    const ctx = makePreToolUseCtx('bun install')
    const config: Config = {
      allowed: ['bun'],
      additionalBlocked: [{ tool: 'fruity', message: 'blocked' }],
    }
    const result = hook.PreToolUse!(ctx, config)
    expect(result.result).toBe('skip')
  })

  // --- Block message content validation ---

  test('block message suggests correct PM alternative', () => {
    const ctx = makePreToolUseCtx('npm install lodash')
    const result = hook.PreToolUse!(ctx, { allowed: ['bun'] }) as any
    expect(result.reason).toContain('bun')
    expect(result.reason).toContain('for package management')
    expect(result.reason).toContain("instead of 'npm'")
  })

  test('block message suggests correct runner alternative', () => {
    const ctx = makePreToolUseCtx('npx create-react-app')
    const result = hook.PreToolUse!(ctx, { allowed: ['bun'] }) as any
    expect(result.reason).toContain('bunx')
    expect(result.reason).toContain('for package execution')
  })

  test('block message suggests correct runtime alternative', () => {
    const ctx = makePreToolUseCtx('node script.js')
    const result = hook.PreToolUse!(ctx, { allowed: ['bun'] }) as any
    expect(result.reason).toContain('bun')
    expect(result.reason).toContain('as its JS runtime')
  })

  // --- Compound & sanitization in handler ---

  test('blocks npm in compound command', () => {
    const ctx = makePreToolUseCtx('bun install && npm publish')
    const result = hook.PreToolUse!(ctx, { allowed: ['bun'] }) as any
    expect(result.result).toBe('block')
    expect(result.debugMessage).toContain('npm')
  })

  test('pipe target passes through', () => {
    const ctx = makePreToolUseCtx('echo test | npm publish')
    const result = hook.PreToolUse!(ctx, { allowed: ['bun'] })
    expect(result.result).toBe('skip')
  })

  test('VAR=val stripping detects blocked tool', () => {
    const ctx = makePreToolUseCtx('NPM_TOKEN=xxx npm install')
    const result = hook.PreToolUse!(ctx, { allowed: ['bun'] }) as any
    expect(result.result).toBe('block')
    expect(result.debugMessage).toContain('npm')
  })

  test('PM in quotes is sanitized', () => {
    const ctx = makePreToolUseCtx('echo "use npm"')
    const result = hook.PreToolUse!(ctx, { allowed: ['bun'] })
    expect(result.result).toBe('skip')
  })

  // --- Edge cases: yarn (no runner, no runtime) ---

  test('allowed: ["yarn"], blocked npx → suggestion falls back to yarn', () => {
    const ctx = makePreToolUseCtx('npx create-react-app')
    const result = hook.PreToolUse!(ctx, { allowed: ['yarn'] }) as any
    expect(result.result).toBe('block')
    expect(result.reason).toContain('yarn')
    expect(result.reason).toContain('for package execution')
  })

  test('allowed: ["yarn"], blocked node → generic fallback', () => {
    const ctx = makePreToolUseCtx('node script.js')
    const result = hook.PreToolUse!(ctx, { allowed: ['yarn'] }) as any
    expect(result.result).toBe('block')
    expect(result.reason).toContain('not allowed')
    expect(result.reason).toContain('Allowed tools: yarn')
  })

  // --- Edge cases: deno (runtime-primary, not PM-capable) ---

  test('allowed: ["deno"], blocked npm → generic fallback', () => {
    const ctx = makePreToolUseCtx('npm install')
    const result = hook.PreToolUse!(ctx, { allowed: ['deno'] }) as any
    expect(result.result).toBe('block')
    expect(result.reason).toContain('not allowed')
    expect(result.reason).toContain('Allowed tools: deno')
  })

  test('allowed: ["deno"], blocked bun → generic fallback', () => {
    const ctx = makePreToolUseCtx('bun install')
    const result = hook.PreToolUse!(ctx, { allowed: ['deno'] }) as any
    expect(result.result).toBe('block')
    expect(result.reason).toContain('not allowed')
    expect(result.reason).toContain('Allowed tools: deno')
  })

  test('allowed: ["deno"], blocked node → suggests deno as runtime', () => {
    const ctx = makePreToolUseCtx('node script.js')
    const result = hook.PreToolUse!(ctx, { allowed: ['deno'] }) as any
    expect(result.result).toBe('block')
    expect(result.reason).toContain('deno')
    expect(result.reason).toContain('as its JS runtime')
  })

  // --- additionalBlocked: known universe tool overlap ---

  test('known universe check fires before additionalBlocked', () => {
    const ctx = makePreToolUseCtx('npm install')
    const config: Config = {
      allowed: ['bun'],
      additionalBlocked: [{ tool: 'npm', message: 'Custom npm message' }],
    }
    const result = hook.PreToolUse!(ctx, config) as any
    expect(result.result).toBe('block')
    // Known universe block fires first — reason uses generateBlockMessage format
    expect(result.reason).toContain('for package management')
    expect(result.reason).not.toContain('Custom npm message')
  })

  // --- Multiple additionalBlocked entries: first match wins ---

  test('multiple additionalBlocked entries: first match wins', () => {
    const ctx = makePreToolUseCtx('fruity deploy')
    const config: Config = {
      allowed: ['bun'],
      additionalBlocked: [
        { tool: 'fruity', message: 'First message' },
        { tool: 'fruity', message: 'Second message' },
      ],
    }
    const result = hook.PreToolUse!(ctx, config) as any
    expect(result.result).toBe('block')
    expect(result.reason).toContain('First message')
    expect(result.reason).not.toContain('Second message')
  })

  // --- debugMessage content ---

  test('debugMessage contains hook name and blocked tool', () => {
    const ctx = makePreToolUseCtx('npm install')
    const result = hook.PreToolUse!(ctx, { allowed: ['bun'] }) as any
    expect(result.debugMessage).toBe("js-package-manager-guard: blocked 'npm'")
  })

  test('additionalBlocked debugMessage contains hook name and tool', () => {
    const ctx = makePreToolUseCtx('fruity deploy')
    const config: Config = {
      allowed: ['bun'],
      additionalBlocked: [{ tool: 'fruity', message: 'msg' }],
    }
    const result = hook.PreToolUse!(ctx, config) as any
    expect(result.debugMessage).toBe("js-package-manager-guard: blocked 'fruity' (additionalBlocked)")
  })

  // --- additionalBlocked + allowed overlap ---

  test('additionalBlocked for an allowed tool still blocks it (documents behavior)', () => {
    const ctx = makePreToolUseCtx('npm install')
    const config: Config = {
      allowed: ['npm'],
      additionalBlocked: [{ tool: 'npm', message: 'Pin to exact versions only' }],
    }
    const result = hook.PreToolUse!(ctx, config) as any
    // Known universe passes (npm is allowed), additionalBlocked fires
    expect(result.result).toBe('block')
    expect(result.reason).toContain('Pin to exact versions only')
  })

  // --- Defensive: missing additionalBlocked key ---

  test('additionalBlocked absent from config (undefined) — does not crash', () => {
    const ctx = makePreToolUseCtx('fruity deploy')
    const result = hook.PreToolUse!(ctx, { allowed: ['bun'] } as any)
    expect(result.result).toBe('skip')
  })
})

// =============================================================================
// Section 6: isAdditionalBlocked tests
// =============================================================================

describe('isAdditionalBlocked', () => {
  test.each([
    [
      'matching first word',
      'fruity deploy',
      [{ tool: 'fruity', message: 'msg' }],
      { tool: 'fruity', message: 'msg' },
    ],
    [
      'non-matching first word',
      'bun install',
      [{ tool: 'fruity', message: 'msg' }],
      null,
    ],
    [
      'multiple entries, first match wins',
      'fruity deploy',
      [{ tool: 'fruity', message: 'first' }, { tool: 'fruity', message: 'second' }],
      { tool: 'fruity', message: 'first' },
    ],
    [
      'empty additionalBlocked array',
      'fruity deploy',
      [],
      null,
    ],
    [
      'match in compound command',
      'bun install && fruity deploy',
      [{ tool: 'fruity', message: 'msg' }],
      { tool: 'fruity', message: 'msg' },
    ],
    [
      'pipe target excluded',
      'echo test | fruity deploy',
      [{ tool: 'fruity', message: 'msg' }],
      null,
    ],
    [
      'VAR=val stripping',
      'TOKEN=xxx fruity deploy',
      [{ tool: 'fruity', message: 'msg' }],
      { tool: 'fruity', message: 'msg' },
    ],
  ] as [string, string, Array<{ tool: string; message: string }>, { tool: string; message: string } | null][])(
    '%s',
    (_label, command, additionalBlocked, expected) => {
      expect(isAdditionalBlocked(command, additionalBlocked)).toEqual(expected)
    },
  )
})
