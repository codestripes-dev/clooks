// Comprehensive coverage for `clooks test` (M4 of PLAN-FEAT-0067).
//
// Two suites:
// 1. `createTestCommand — routing lock` — keeps the M1 routing-lock contract
//    that prevents Commander's greedy positional binding from swallowing the
//    `example` subcommand literal.
// 2. `runHarness — behavior` — exercises the harness's exit-code mapping,
//    stdin/--input parity, error paths, and the `clooks test example`
//    rendering output. These tests call the exported `runHarness` directly,
//    mock `process.exit` (throw sentinel), and capture stdout/stderr writes.

import {
  describe,
  test,
  expect,
  mock,
  spyOn,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from 'bun:test'
import { Command } from 'commander'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestCommand, runHarness } from './test.js'
import { renderExample } from './test/render-example.js'
import { CLAUDE_CODE_EVENTS } from '../config/constants.js'
import { TOOL_KEYED_EVENTS } from '../examples/index.js'
import type { EventName } from '../types/branded.js'

// --- Routing-lock suite (carried forward from M1) -------------------------

// Mirrors the root program in src/router.ts so the `enablePositionalOptions()`
// call inside createTestCommand() actually has a parent context to act on.
function createTestProgram(): Command {
  const program = new Command()
  program.exitOverride()
  program.option('--json', 'Output results as JSON')
  program.addCommand(createTestCommand())
  return program
}

describe('createTestCommand — routing lock', () => {
  test('`clooks test example <Event>` routes to the example subcommand, not the parent harness', async () => {
    const program = createTestProgram()

    const exampleCmd = program.commands
      .find((c) => c.name() === 'test')!
      .commands.find((c) => c.name() === 'example')!
    const exampleSpy = mock((_event: string | undefined) => {
      // No-op
    })
    exampleCmd.action(exampleSpy as (event: string | undefined) => void)

    await program.parseAsync(['test', 'example', 'PreToolUse'], { from: 'user' })

    expect(exampleSpy).toHaveBeenCalledTimes(1)
    expect(exampleSpy.mock.calls[0]![0]).toBe('PreToolUse')
  })

  test('`clooks test <hook-file>` routes to the parent harness action, not the example subcommand', async () => {
    const program = createTestProgram()

    const testCmd = program.commands.find((c) => c.name() === 'test')!
    const exampleCmd = testCmd.commands.find((c) => c.name() === 'example')!

    const exampleSpy = mock(() => {})
    exampleCmd.action(exampleSpy as () => void)

    const harnessSpy = mock((_hookFile: string | undefined) => {
      // Short-circuit before runHarness() actually tries to import the file.
    })
    testCmd.action(harnessSpy as (hookFile: string | undefined) => void)

    await program.parseAsync(['test', './hook.ts'], { from: 'user' })

    expect(harnessSpy).toHaveBeenCalledTimes(1)
    expect(harnessSpy.mock.calls[0]![0]).toBe('./hook.ts')
    expect(exampleSpy).not.toHaveBeenCalled()
  })
})

// --- Harness behavior suite ----------------------------------------------

const FIXTURES = join(import.meta.dir, '..', '..', 'test', 'fixtures', 'hooks')
const HOOK_ALLOW = join(FIXTURES, 'allow-all.ts')
const HOOK_DECISIONS = join(FIXTURES, 'harness-decisions.ts')
const HOOK_ASK = join(FIXTURES, 'harness-ask.ts')
const HOOK_DEFER = join(FIXTURES, 'harness-defer.ts')
const HOOK_FAILURE = join(FIXTURES, 'harness-failure.ts')
const HOOK_VOID = join(FIXTURES, 'harness-void.ts')
const HOOK_THROWS = join(FIXTURES, 'crash-on-run.ts')
const HOOK_RETURN_NUMBER = join(FIXTURES, 'harness-return-number.ts')
const HOOK_RETURN_STRING = join(FIXTURES, 'harness-return-string.ts')
const HOOK_RETURN_NULL = join(FIXTURES, 'harness-return-null.ts')
const HOOK_WRONG_EXPORT = join(FIXTURES, 'wrong-export.ts')

/**
 * Sentinel thrown by the mocked `process.exit`. The thrown value carries the
 * exit code so callers can inspect it without reaching into the spy's call
 * args after `mockRestore`.
 */
class ExitCalled extends Error {
  constructor(public readonly code: number) {
    super(`__EXIT__:${code}`)
  }
}

/** Per-test scratch state. */
interface HarnessSpies {
  exit: ReturnType<typeof spyOn>
  stdout: ReturnType<typeof spyOn>
  stderr: ReturnType<typeof spyOn>
  stdoutChunks: string[]
  stderrChunks: string[]
}

function installHarnessSpies(): HarnessSpies {
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  const exit = spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitCalled(code ?? 0)
  }) as (code?: number) => never)
  const stdout = spyOn(process.stdout, 'write').mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'))
    return true
  }) as typeof process.stdout.write)
  const stderr = spyOn(process.stderr, 'write').mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'))
    return true
  }) as typeof process.stderr.write)
  return { exit, stdout, stderr, stdoutChunks, stderrChunks }
}

function restoreHarnessSpies(s: HarnessSpies): void {
  s.exit.mockRestore()
  s.stdout.mockRestore()
  s.stderr.mockRestore()
}

/** Run runHarness, expecting it to call process.exit (which throws). */
async function runAndCaptureExit(
  hookFile: string,
  opts: { input?: string },
  _s: HarnessSpies,
): Promise<number> {
  try {
    await runHarness(hookFile, opts)
  } catch (e) {
    if (e instanceof ExitCalled) return e.code
    throw e
  }
  throw new Error('runHarness returned without calling process.exit')
}

/** Replace Bun.stdin.json with a stub returning the given payload. */
function withStdin<T>(payload: unknown, fn: () => Promise<T>): Promise<T> {
  const orig = Bun.stdin.json
  ;(Bun.stdin as { json: () => Promise<unknown> }).json = () => Promise.resolve(payload)
  return fn().finally(() => {
    ;(Bun.stdin as { json: () => Promise<unknown> }).json = orig
  })
}

let tempDir: string
let spies: HarnessSpies

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-test-harness-m4-'))
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  spies = installHarnessSpies()
})

afterEach(() => {
  restoreHarnessSpies(spies)
})

describe('runHarness — stdin and --input parity', () => {
  test('stdin and --input <file> produce identical stdout for the same payload', async () => {
    // Release the outer beforeEach mocks before installing inner ones; otherwise
    // each parity-test run leaks two `process.exit`/stdout/stderr mock layers.
    // We re-install fresh outer spies at the bottom so afterEach has a target.
    restoreHarnessSpies(spies)

    const payload = {
      event: 'PreToolUse',
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      originalToolInput: { command: 'echo hi' },
      toolUseId: 'tu_parity_0001',
    }

    // Stdin path
    const stdinSpies = installHarnessSpies()
    let stdinCode: number
    try {
      stdinCode = await withStdin(payload, () => runAndCaptureExit(HOOK_ALLOW, {}, stdinSpies))
    } finally {
      restoreHarnessSpies(stdinSpies)
    }
    const stdinOut = stdinSpies.stdoutChunks.join('')

    // --input path
    const inputFile = join(tempDir, 'parity.json')
    writeFileSync(inputFile, JSON.stringify(payload))
    const inputSpies = installHarnessSpies()
    let inputCode: number
    try {
      inputCode = await runAndCaptureExit(HOOK_ALLOW, { input: inputFile }, inputSpies)
    } finally {
      restoreHarnessSpies(inputSpies)
    }
    const inputOut = inputSpies.stdoutChunks.join('')

    expect(stdinCode).toBe(0)
    expect(inputCode).toBe(0)
    expect(stdinOut).toBe(inputOut)
    expect(stdinOut).toBe('{"result":"allow"}\n')

    // Re-install the per-test spies the afterEach expects.
    spies = installHarnessSpies()
  })
})

describe('runHarness — exit code mapping', () => {
  test('allow → exit 0, prints decision JSON', async () => {
    const code = await withStdin(
      {
        event: 'PreToolUse',
        toolName: 'Bash',
        toolInput: { command: 'echo' },
        originalToolInput: { command: 'echo' },
        toolUseId: 'tu_x',
      },
      () => runAndCaptureExit(HOOK_DECISIONS, {}, spies),
    )
    expect(code).toBe(0)
    expect(spies.stdoutChunks.join('')).toBe('{"result":"allow"}\n')
  })

  test('block → exit 1', async () => {
    // harness-decisions.ts wires UserPromptSubmit → ctx.block({ reason: 'no' }).
    const code = await withStdin({ event: 'UserPromptSubmit', userPrompt: 'hi' }, () =>
      runAndCaptureExit(HOOK_DECISIONS, {}, spies),
    )
    expect(code).toBe(1)
    expect(spies.stdoutChunks.join('')).toContain('"result":"block"')
    expect(spies.stdoutChunks.join('')).toContain('"reason":"no"')
  })

  test('skip → exit 0', async () => {
    const code = await withStdin(
      {
        event: 'PostToolUse',
        toolName: 'Bash',
        toolInput: { command: 'echo' },
        originalToolInput: { command: 'echo' },
        toolUseId: 'tu_s',
        toolResponse: { stdout: '' },
      },
      () => runAndCaptureExit(HOOK_DECISIONS, {}, spies),
    )
    expect(code).toBe(0)
    expect(spies.stdoutChunks.join('')).toBe('{"result":"skip"}\n')
  })

  test('success → exit 0', async () => {
    const code = await withStdin({ event: 'WorktreeCreate', worktreePath: '/tmp/wt' }, () =>
      runAndCaptureExit(HOOK_DECISIONS, {}, spies),
    )
    expect(code).toBe(0)
    // Mirror the `block` assertion: an exact match of the full JSON line
    // catches accidental field-shape regressions (extra keys, reordering
    // of `result` first, etc). The fixture calls `success({ path: '/tmp/worktree' })`.
    expect(spies.stdoutChunks.join('')).toBe('{"result":"success","path":"/tmp/worktree"}\n')
  })

  test('continue → exit 0', async () => {
    const code = await withStdin({ event: 'TeammateIdle' }, () =>
      runAndCaptureExit(HOOK_DECISIONS, {}, spies),
    )
    expect(code).toBe(0)
    expect(spies.stdoutChunks.join('')).toContain('"result":"continue"')
  })

  test('retry → exit 0', async () => {
    const code = await withStdin(
      {
        event: 'PermissionDenied',
        toolName: 'Bash',
        toolInput: { command: 'echo' },
        originalToolInput: { command: 'echo' },
        toolUseId: 'tu_d',
        denialReason: 'no perms',
      },
      () => runAndCaptureExit(HOOK_DECISIONS, {}, spies),
    )
    expect(code).toBe(0)
    expect(spies.stdoutChunks.join('')).toBe('{"result":"retry"}\n')
  })

  test('ask → exit 0', async () => {
    const code = await withStdin(
      {
        event: 'PreToolUse',
        toolName: 'Bash',
        toolInput: { command: 'echo' },
        originalToolInput: { command: 'echo' },
        toolUseId: 'tu_ask',
      },
      () => runAndCaptureExit(HOOK_ASK, {}, spies),
    )
    expect(code).toBe(0)
    expect(spies.stdoutChunks.join('')).toContain('"result":"ask"')
  })

  test('defer → exit 0', async () => {
    const code = await withStdin(
      {
        event: 'PreToolUse',
        toolName: 'Bash',
        toolInput: { command: 'echo' },
        originalToolInput: { command: 'echo' },
        toolUseId: 'tu_def',
      },
      () => runAndCaptureExit(HOOK_DEFER, {}, spies),
    )
    expect(code).toBe(0)
    expect(spies.stdoutChunks.join('')).toBe('{"result":"defer"}\n')
  })

  test('failure → exit 1', async () => {
    const code = await withStdin({ event: 'WorktreeCreate', worktreePath: '/tmp/wt' }, () =>
      runAndCaptureExit(HOOK_FAILURE, {}, spies),
    )
    expect(code).toBe(1)
    expect(spies.stdoutChunks.join('')).toContain('"result":"failure"')
  })

  test('stop → exit 1', async () => {
    const code = await withStdin({ event: 'TaskCreated' }, () =>
      runAndCaptureExit(HOOK_DECISIONS, {}, spies),
    )
    expect(code).toBe(1)
    expect(spies.stdoutChunks.join('')).toContain('"result":"stop"')
  })

  test('handler returns undefined → prints {} and exits 0', async () => {
    const code = await withStdin(
      {
        event: 'Notification',
        message: 'hi',
        title: 'Test',
        notificationType: 'permission_prompt',
      },
      () => runAndCaptureExit(HOOK_VOID, {}, spies),
    )
    expect(code).toBe(0)
    expect(spies.stdoutChunks.join('')).toBe('{}\n')
  })
})

describe('runHarness — non-object handler return values', () => {
  // Coverage for the harness's blind `JSON.stringify(result) + '\n'` happy
  // path in src/commands/test.ts. `exitCodeForResult(undefined)` is 0, so all
  // of these exit cleanly; the value of testing them is locking down the
  // serialization contract (no double-encoding, no `String(...)` fallback).

  const PRE_TOOL_USE_PAYLOAD = {
    event: 'PreToolUse',
    toolName: 'Bash',
    toolInput: { command: 'echo' },
    originalToolInput: { command: 'echo' },
    toolUseId: 'tu_nonobj',
  }

  test('handler returns a number → prints `42\\n` and exits 0', async () => {
    const code = await withStdin(PRE_TOOL_USE_PAYLOAD, () =>
      runAndCaptureExit(HOOK_RETURN_NUMBER, {}, spies),
    )
    expect(code).toBe(0)
    expect(spies.stdoutChunks.join('')).toBe('42\n')
  })

  test('handler returns a string → prints `"oops"\\n` and exits 0', async () => {
    const code = await withStdin(PRE_TOOL_USE_PAYLOAD, () =>
      runAndCaptureExit(HOOK_RETURN_STRING, {}, spies),
    )
    expect(code).toBe(0)
    expect(spies.stdoutChunks.join('')).toBe('"oops"\n')
  })

  test('handler returns null → prints `null\\n` and exits 0', async () => {
    const code = await withStdin(PRE_TOOL_USE_PAYLOAD, () =>
      runAndCaptureExit(HOOK_RETURN_NULL, {}, spies),
    )
    expect(code).toBe(0)
    expect(spies.stdoutChunks.join('')).toBe('null\n')
  })
})

describe('runHarness — error paths', () => {
  test('hook throws → exit 2 with `clooks test: hook threw:` stderr', async () => {
    const code = await withStdin(
      {
        event: 'PreToolUse',
        toolName: 'Bash',
        toolInput: { command: 'echo' },
        originalToolInput: { command: 'echo' },
        toolUseId: 'tu_throw',
      },
      () => runAndCaptureExit(HOOK_THROWS, {}, spies),
    )
    expect(code).toBe(2)
    const stderr = spies.stderrChunks.join('')
    expect(stderr).toContain('clooks test: hook threw:')
    expect(stderr).toContain('intentional crash')
  })

  test('missing event field → exit 2', async () => {
    const code = await withStdin({ toolName: 'Bash' }, () =>
      runAndCaptureExit(HOOK_ALLOW, {}, spies),
    )
    expect(code).toBe(2)
    expect(spies.stderrChunks.join('')).toContain('"event" field')
  })

  test('non-object payload (array) → exit 2', async () => {
    const code = await withStdin([1, 2, 3], () => runAndCaptureExit(HOOK_ALLOW, {}, spies))
    expect(code).toBe(2)
    expect(spies.stderrChunks.join('')).toContain('input JSON must be an object')
  })

  test('null payload → exit 2', async () => {
    const code = await withStdin(null, () => runAndCaptureExit(HOOK_ALLOW, {}, spies))
    expect(code).toBe(2)
    expect(spies.stderrChunks.join('')).toContain('input JSON must be an object')
  })

  test('unknown event name → exit 2', async () => {
    const code = await withStdin({ event: 'TotallyNotAnEvent' }, () =>
      runAndCaptureExit(HOOK_ALLOW, {}, spies),
    )
    expect(code).toBe(2)
    expect(spies.stderrChunks.join('')).toContain('not a known EventName')
  })

  test('hook does not handle the event → exit 2', async () => {
    // allow-all.ts only exports PreToolUse / PostToolUse / UserPromptSubmit.
    const code = await withStdin(
      { event: 'Stop', stopHookActive: false, lastAssistantMessage: 'done' },
      () => runAndCaptureExit(HOOK_ALLOW, {}, spies),
    )
    expect(code).toBe(2)
    expect(spies.stderrChunks.join('')).toContain('does not export a handler for event "Stop"')
  })

  test('--input file with bad JSON → exit 2', async () => {
    const badFile = join(tempDir, 'bad.json')
    writeFileSync(badFile, '{not json}')
    const code = await runAndCaptureExit(HOOK_ALLOW, { input: badFile }, spies)
    expect(code).toBe(2)
    expect(spies.stderrChunks.join('')).toContain('failed to read JSON input')
  })

  test('hook file does not exist → exit 2', async () => {
    const missing = join(tempDir, 'no-such-hook.ts')
    const code = await withStdin({ event: 'PreToolUse' }, () =>
      runAndCaptureExit(missing, {}, spies),
    )
    expect(code).toBe(2)
    expect(spies.stderrChunks.join('')).toContain('failed to import hook file')
  })

  test('hook file with no `hook` named export → exit 2', async () => {
    // wrong-export.ts exports `notHook` instead of `hook`. The harness routes
    // through `validateHookExport` (src/loader.ts), which throws with the
    // stable substring 'does not export a "hook" named export'.
    const code = await withStdin(
      {
        event: 'PreToolUse',
        toolName: 'Bash',
        toolInput: { command: 'echo' },
        originalToolInput: { command: 'echo' },
        toolUseId: 'tu_wrong_export',
      },
      () => runAndCaptureExit(HOOK_WRONG_EXPORT, {}, spies),
    )
    expect(code).toBe(2)
    const stderr = spies.stderrChunks.join('')
    expect(stderr).toContain('hook')
    expect(stderr).toContain('export')
  })
})

describe('runHarness — usage errors via Commander wrapper', () => {
  test('`clooks test` with no positional arg → exit 2 with stderr message', async () => {
    const program = createTestProgram()
    let code: number | undefined
    try {
      await program.parseAsync(['test'], { from: 'user' })
    } catch (e) {
      if (e instanceof ExitCalled) code = e.code
      else throw e
    }
    expect(code).toBe(2)
    expect(spies.stderrChunks.join('')).toContain('missing required argument <hook-file>')
  })

  test('`clooks test example <unknown>` → exit 2 with clean stderr', async () => {
    const program = createTestProgram()
    let code: number | undefined
    try {
      await program.parseAsync(['test', 'example', 'NotAnEvent'], { from: 'user' })
    } catch (e) {
      if (e instanceof ExitCalled) code = e.code
      else throw e
    }
    expect(code).toBe(2)
    const stderr = spies.stderrChunks.join('')
    expect(stderr).toContain('unknown event "NotAnEvent"')
    expect(stderr).toContain('clooks types')
  })

  test('`clooks test example` with no event arg → exit 2', async () => {
    const program = createTestProgram()
    let code: number | undefined
    try {
      await program.parseAsync(['test', 'example'], { from: 'user' })
    } catch (e) {
      if (e instanceof ExitCalled) code = e.code
      else throw e
    }
    expect(code).toBe(2)
    expect(spies.stderrChunks.join('')).toContain('missing required argument <event>')
  })
})

describe('clooks test example — output content', () => {
  test('PreToolUse rendering contains Bash JSON block AND Tool inputs section listing all 10 tools', async () => {
    const program = createTestProgram()
    let code: number | undefined
    try {
      await program.parseAsync(['test', 'example', 'PreToolUse'], { from: 'user' })
    } catch (e) {
      if (e instanceof ExitCalled) code = e.code
      else throw e
    }
    expect(code).toBe(0)
    const out = spies.stdoutChunks.join('')

    // Header + Bash JSON block (one of the canonical fields).
    expect(out).toContain('# PreToolUse — example input')
    expect(out).toContain('"toolName": "Bash"')
    expect(out).toContain('"command": "echo hello"')

    // Tool inputs section header.
    expect(out).toContain('Tool inputs (toolName + toolInput shapes):')

    // All 10 built-in tools must appear as section headers.
    for (const tool of [
      'Bash:',
      'Edit:',
      'Write:',
      'Read:',
      'Glob:',
      'Grep:',
      'WebFetch:',
      'WebSearch:',
      'Agent:',
      'AskUserQuestion:',
    ]) {
      expect(out).toContain(tool)
    }

    // Fallback note for ExitPlanMode / mcp__*.
    expect(out).toContain('ExitPlanMode and any mcp__* tool')

    // Optional keys section.
    expect(out).toContain('Optional keys')
    expect(out).toContain('test-session-0000000000000000')
  })

  test('UserPromptSubmit rendering does NOT include Tool inputs section', async () => {
    const program = createTestProgram()
    try {
      await program.parseAsync(['test', 'example', 'UserPromptSubmit'], { from: 'user' })
    } catch (e) {
      if (!(e instanceof ExitCalled)) throw e
    }
    const out = spies.stdoutChunks.join('')
    expect(out).toContain('# UserPromptSubmit — example input')
    expect(out).toContain('Required fields:')
    expect(out).not.toContain('Tool inputs (toolName + toolInput shapes):')
  })
})

describe('renderExample — structural coverage of every event', () => {
  // Spot-checking PreToolUse + UserPromptSubmit hides regressions in the
  // renderer for any of the other 20 events. These two parametric tests
  // exercise every EventName / every TOOL_KEYED_EVENTS entry directly.

  /** Extract the indented JSON block following "A minimum-viable fixture:". */
  function extractJsonBlock(out: string): string {
    const marker = 'A minimum-viable fixture:'
    const i = out.indexOf(marker)
    if (i === -1) throw new Error('marker not found')
    const tail = out.slice(i + marker.length)
    const start = tail.indexOf('{')
    if (start === -1) throw new Error('no opening brace after marker')
    // Walk braces honoring strings; the JSON block is followed by a blank line
    // then "Required fields:", so we only need to find the matching close.
    let depth = 0
    let inString = false
    let escape = false
    for (let p = start; p < tail.length; p++) {
      const c = tail[p]!
      if (inString) {
        if (escape) {
          escape = false
        } else if (c === '\\') {
          escape = true
        } else if (c === '"') {
          inString = false
        }
        continue
      }
      if (c === '"') {
        inString = true
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) return tail.slice(start, p + 1)
      }
    }
    throw new Error('unterminated JSON block')
  }

  const ALL_EVENTS = Array.from(CLAUDE_CODE_EVENTS) as EventName[]

  for (const event of ALL_EVENTS) {
    test(`renderExample(${event}) emits the canonical structural sections`, () => {
      const out = renderExample(event)
      expect(out.startsWith(`# ${event} — example input`)).toBe(true)
      expect(out).toContain('A minimum-viable fixture:')
      expect(out).toContain('Required fields:')
      expect(out).toContain('Optional keys —')

      // The embedded JSON block must round-trip through JSON.parse.
      const block = extractJsonBlock(out)
      expect(() => JSON.parse(block)).not.toThrow()
    })
  }

  for (const event of TOOL_KEYED_EVENTS) {
    test(`renderExample(${event}) includes the Tool inputs section + all 10 built-in tools + MCP fallback`, () => {
      const out = renderExample(event)

      expect(out).toContain('Tool inputs (toolName + toolInput shapes):')

      for (const tool of [
        'Bash:',
        'Edit:',
        'Write:',
        'Read:',
        'Glob:',
        'Grep:',
        'Agent:',
        'WebFetch:',
        'WebSearch:',
        'AskUserQuestion:',
      ]) {
        expect(out).toContain(tool)
      }

      expect(out).toContain('ExitPlanMode and any mcp__* tool')
    })
  }
})
