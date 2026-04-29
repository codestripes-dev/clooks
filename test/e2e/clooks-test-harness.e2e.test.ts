// E2E coverage for `clooks test`.
//
// Drives the compiled binary via `sandbox.run([...])` to prove the full
// pipeline — bin entry → harness body → renderer — works hermetically inside
// the Docker sandbox. Internal harness behavior is owned by the unit tests
// (`src/commands/test.test.ts`); this file only verifies binary-level
// observable behavior for the 7 scenarios listed in the plan's M5 section.

import { describe, test, expect, afterEach } from 'bun:test'
import { createSandbox, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

// Hook source strings — kept inline so each scenario is self-contained.

const ALLOW_HOOK_SRC = `
export const hook = {
  meta: { name: "allow-all" },
  PreToolUse(ctx) {
    return ctx.allow()
  },
}
`

const BLOCK_HOOK_SRC = `
export const hook = {
  meta: { name: "block-no" },
  PreToolUse(ctx) {
    return ctx.block({ reason: "no" })
  },
}
`

const THROW_HOOK_SRC = `
export const hook = {
  meta: { name: "throws" },
  PreToolUse() {
    throw new Error("kaboom")
  },
}
`

// Minimal valid PreToolUse payload accepted by the harness. Keep this
// independent of EXAMPLES — scenario 6 covers the example-payload round trip.
const PRE_TOOL_USE_PAYLOAD = JSON.stringify({
  event: 'PreToolUse',
  toolName: 'Bash',
  toolInput: { command: 'echo hi' },
  originalToolInput: { command: 'echo hi' },
  toolUseId: 'tu_e2e_0001',
})

/**
 * Extract the JSON block from `clooks test example PreToolUse` output by line
 * slice. The example output is prose+JSON documentation, NOT valid JSON in
 * full — `jq` does not apply. The block sits below "A minimum-viable fixture:"
 * indented with two spaces; we find the first line opening with `{`, match
 * braces, then dedent.
 */
function extractJsonBlock(exampleOutput: string): string {
  const lines = exampleOutput.split('\n')
  let startIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line !== undefined && line.startsWith('  {')) {
      startIdx = i
      break
    }
  }
  if (startIdx === -1) {
    throw new Error('extractJsonBlock: could not find opening "{" in example output')
  }

  let depth = 0
  let endIdx = -1
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    for (const ch of line) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    if (depth === 0) {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) {
    throw new Error('extractJsonBlock: could not find closing "}" in example output')
  }

  // Dedent the two-space JSON indent that formatJsonBlock applies.
  const block = lines
    .slice(startIdx, endIdx + 1)
    .map((l) => (l.startsWith('  ') ? l.slice(2) : l))
    .join('\n')
  return block
}

describe('clooks test — harness E2E', () => {
  // Scenario 1
  test('1. allow path — stdin payload, exit 0, allow JSON on stdout', () => {
    sandbox = createSandbox()
    sandbox.writeFile('hooks/allow.ts', ALLOW_HOOK_SRC)

    const result = sandbox.run(['test', 'hooks/allow.ts'], { stdin: PRE_TOOL_USE_PAYLOAD })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"result":"allow"}\n')
  })

  // Scenario 2
  test('2. block path — exit 1, block JSON with reason on stdout', () => {
    sandbox = createSandbox()
    sandbox.writeFile('hooks/block.ts', BLOCK_HOOK_SRC)

    const result = sandbox.run(['test', 'hooks/block.ts'], { stdin: PRE_TOOL_USE_PAYLOAD })

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('{"result":"block","reason":"no"}\n')
  })

  // Scenario 3
  test('3. --input path — JSON read from a file, exit 0, allow JSON on stdout', () => {
    sandbox = createSandbox()
    sandbox.writeFile('hooks/allow.ts', ALLOW_HOOK_SRC)
    sandbox.writeFile('fixtures/pre-tool-use.json', PRE_TOOL_USE_PAYLOAD)

    const result = sandbox.run(['test', 'hooks/allow.ts', '--input', 'fixtures/pre-tool-use.json'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"result":"allow"}\n')
  })

  // Scenario 4
  test('4. example UserPromptSubmit — header, JSON block, Required fields section', () => {
    sandbox = createSandbox()

    const result = sandbox.run(['test', 'example', 'UserPromptSubmit'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.startsWith('# UserPromptSubmit — example input')).toBe(true)
    expect(result.stdout).toContain('"event": "UserPromptSubmit"')
    expect(result.stdout).toContain('"prompt"')
    expect(result.stdout).toContain('Required fields:')
  })

  // Scenario 5
  test('5. example PreToolUse — Bash JSON block + Tool inputs section names all 10 tools', () => {
    sandbox = createSandbox()

    const result = sandbox.run(['test', 'example', 'PreToolUse'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('# PreToolUse — example input')
    // Bash JSON block (the embedded example payload uses Bash with a `command`).
    expect(result.stdout).toContain('"toolName": "Bash"')
    expect(result.stdout).toContain('"command": "echo hello"')
    // Tool inputs section header.
    expect(result.stdout).toContain('Tool inputs (')
    // All 10 built-in tools must appear by name in their column header form
    // ("<Tool>:" — see render-example.ts:129).
    for (const tool of [
      'Bash',
      'Edit',
      'Write',
      'Read',
      'Glob',
      'Grep',
      'Agent',
      'WebFetch',
      'WebSearch',
      'AskUserQuestion',
    ]) {
      expect(result.stdout).toContain(`  ${tool}:`)
    }
  })

  // Scenario 6
  test('6. example payload extracted by line slice is accepted by the harness', () => {
    sandbox = createSandbox()
    sandbox.writeFile('hooks/allow.ts', ALLOW_HOOK_SRC)

    const example = sandbox.run(['test', 'example', 'PreToolUse'])
    expect(example.exitCode).toBe(0)

    const jsonBlock = extractJsonBlock(example.stdout)
    // Sanity check: the slice must parse as JSON.
    const parsed = JSON.parse(jsonBlock) as Record<string, unknown>
    expect(parsed.event).toBe('PreToolUse')

    // Write the parsed JSON to a fixture file inside the sandbox and feed it
    // to the harness via --input. (Writing the raw `jsonBlock` would also
    // work since it's already valid JSON, but round-tripping through
    // JSON.parse → stringify proves the line-slice is a real JSON object.)
    sandbox.writeFile('fixtures/example.json', JSON.stringify(parsed))

    const result = sandbox.run(['test', 'hooks/allow.ts', '--input', 'fixtures/example.json'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('{"result":"allow"}\n')
  })

  // Scenario 7
  test('7. hook throws — exit 2, stderr contains "hook threw:"', () => {
    sandbox = createSandbox()
    sandbox.writeFile('hooks/throws.ts', THROW_HOOK_SRC)

    const result = sandbox.run(['test', 'hooks/throws.ts'], { stdin: PRE_TOOL_USE_PAYLOAD })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('clooks test: hook threw:')
  })
})

// Hook source for the config-flag scenarios. The handler echoes the merged
// `config` it receives back through `injectContext` so the harness's stdout
// reflects the post-merge shape end-to-end.
const ECHO_HOOK_SRC = `
export const hook = {
  meta: { name: "echo", config: { mode: "default", threshold: 1 } },
  PreToolUse(ctx, config) {
    return ctx.allow({ injectContext: JSON.stringify(config) })
  },
}
`

describe('clooks test — config flags E2E', () => {
  // E1
  test('E1. --config-json round trip — JSON literal flows into handler', () => {
    sandbox = createSandbox()
    sandbox.writeFile('hooks/echo.ts', ECHO_HOOK_SRC)

    const result = sandbox.run(['test', 'hooks/echo.ts', '--config-json', '{"x":42}'], {
      stdin: PRE_TOOL_USE_PAYLOAD,
    })

    expect(result.exitCode).toBe(0)
    // Hook declares meta.config defaults `{mode:'default', threshold:1}`. The
    // --config-json literal `{x:42}` merges on top, so the handler receives
    // `{mode:'default', threshold:1, x:42}`. Parse-then-equal keeps the assert
    // independent of V8 spread-key ordering quirks.
    const parsed = JSON.parse(result.stdout) as { result: string; injectContext: string }
    expect(parsed.result).toBe('allow')
    expect(JSON.parse(parsed.injectContext)).toEqual({ mode: 'default', threshold: 1, x: 42 })
  })

  // E2
  test('E2. --config round trip — YAML entry config flows into handler', () => {
    sandbox = createSandbox()
    sandbox.writeFile('hooks/echo.ts', ECHO_HOOK_SRC)
    // YAML lives at sandbox root; `uses: ./hooks/echo.ts` is path-like, so
    // the harness resolves it against the YAML's own directory (sandbox root).
    sandbox.writeFile(
      'single.yml',
      [
        'version: "1"',
        'echo:',
        '  uses: ./hooks/echo.ts',
        '  config:',
        '    threshold: 5',
        '',
      ].join('\n'),
    )

    const result = sandbox.run(['test', 'hooks/echo.ts', '--config', 'single.yml'], {
      stdin: PRE_TOOL_USE_PAYLOAD,
    })

    expect(result.exitCode).toBe(0)
    // Defaults `{mode:'default', threshold:1}` merge with the YAML override
    // `{threshold:5}`: `mode` carried, `threshold` overridden.
    const parsed = JSON.parse(result.stdout) as { result: string; injectContext: string }
    expect(parsed.result).toBe('allow')
    expect(JSON.parse(parsed.injectContext)).toEqual({ mode: 'default', threshold: 5 })
  })

  // E3
  test('E3. --config and --config-json mutex → exit 2 with mutex error on stderr', () => {
    sandbox = createSandbox()
    sandbox.writeFile('hooks/echo.ts', ECHO_HOOK_SRC)

    // The mutex check fires before the binary tries to read the YAML, so a
    // `--config` argument pointing at a nonexistent file still triggers the
    // mutex error rather than a load failure.
    const result = sandbox.run(
      ['test', 'hooks/echo.ts', '--config', 'nonexistent.yml', '--config-json', '{}'],
      { stdin: PRE_TOOL_USE_PAYLOAD },
    )

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('mutually exclusive')
  })

  // E4
  test('E4. --config with no matching entry → exit 2 with "no entry in" + --hook-name hint', () => {
    sandbox = createSandbox()
    sandbox.writeFile('hooks/echo.ts', ECHO_HOOK_SRC)
    // `unrelated.yml` registers `./hooks/other.ts`, whose resolved absolute path
    // does not match `./hooks/echo.ts`. The binary's path-match loop finds zero
    // candidates and emits the "no entry in" error. `hooks/other.ts` does not
    // need to exist because validateConfig only shape-checks the YAML.
    sandbox.writeFile(
      'unrelated.yml',
      [
        'version: "1"',
        'other:',
        '  uses: ./hooks/other.ts',
        '  config:',
        '    threshold: 99',
        '',
      ].join('\n'),
    )

    const result = sandbox.run(['test', 'hooks/echo.ts', '--config', 'unrelated.yml'], {
      stdin: PRE_TOOL_USE_PAYLOAD,
    })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('no entry in')
    expect(result.stderr).toContain('Use --hook-name')
  })

  // E5
  test('E5. --config + --hook-name resolves a multi-match → chosen entry config flows through', () => {
    sandbox = createSandbox()
    sandbox.writeFile('hooks/echo.ts', ECHO_HOOK_SRC)
    // Two aliases pointing at the same hook file. Without --hook-name the
    // harness exits 2 (multi-match); with --hook-name it picks the named entry.
    sandbox.writeFile(
      'multi.yml',
      [
        'version: "1"',
        'echo-a:',
        '  uses: ./hooks/echo.ts',
        '  config:',
        '    flavor: "a"',
        'echo-b:',
        '  uses: ./hooks/echo.ts',
        '  config:',
        '    flavor: "b"',
        '',
      ].join('\n'),
    )

    const result = sandbox.run(
      ['test', 'hooks/echo.ts', '--config', 'multi.yml', '--hook-name', 'echo-b'],
      { stdin: PRE_TOOL_USE_PAYLOAD },
    )

    expect(result.exitCode).toBe(0)
    // Parse to be order-insensitive on the inner JSON, even though only one
    // key is present here.
    const parsed = JSON.parse(result.stdout) as { result: string; injectContext: string }
    expect(parsed.result).toBe('allow')
    expect(JSON.parse(parsed.injectContext)).toEqual({
      mode: 'default',
      threshold: 1,
      flavor: 'b',
    })
  })

  // E6
  test('E6. --hook-name without --config → exit 2 with usage error on stderr', () => {
    sandbox = createSandbox()
    sandbox.writeFile('hooks/echo.ts', ECHO_HOOK_SRC)

    const result = sandbox.run(['test', 'hooks/echo.ts', '--hook-name', 'echo'], {
      stdin: PRE_TOOL_USE_PAYLOAD,
    })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--hook-name requires --config')
  })
})
