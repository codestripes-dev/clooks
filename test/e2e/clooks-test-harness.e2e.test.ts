// E2E coverage for `clooks test` (PLAN-FEAT-0067 M5).
//
// Drives the compiled binary via `sandbox.run([...])` to prove the full
// pipeline — bin entry → harness body → renderer — works hermetically inside
// the Docker sandbox. Internal harness behavior is owned by M4
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
