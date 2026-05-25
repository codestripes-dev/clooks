import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

function writeAllowHook(s: Sandbox): void {
  s.writeHook(
    'allow-all.ts',
    `
export const hook = {
  meta: { name: "allow-all" },
  PreToolUse() { return { result: "allow" } },
}
`,
  )
  s.writeConfig(`version: "1.0.0"
allow-all: {}
`)
}

function expectClaudeAllowOutput(result: { exitCode: number; stdout: string; stderr: string }) {
  expect(result.exitCode).toBe(0)
  expect(result.stderr).toBe('')
  const output = JSON.parse(result.stdout)
  expect(output).toMatchObject({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  })
  return output
}

describe('agent adapter selection: compiled binary engine mode', () => {
  test('unset CLOOKS_AGENT uses Claude Code output shape', () => {
    sandbox = createSandbox()
    writeAllowHook(sandbox)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })

    expectClaudeAllowOutput(result)
  })

  test('CLOOKS_AGENT=claude-code matches unset Claude Code output shape', () => {
    sandbox = createSandbox()
    writeAllowHook(sandbox)

    const unsetResult = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    const explicitResult = sandbox.run([], {
      stdin: loadEvent('pre-tool-use-bash.json'),
      env: { CLOOKS_AGENT: 'claude-code' },
    })

    expectClaudeAllowOutput(unsetResult)
    expectClaudeAllowOutput(explicitResult)
    expect(JSON.parse(explicitResult.stdout)).toEqual(JSON.parse(unsetResult.stdout))
  })

  test('unknown CLOOKS_AGENT fails closed before engine execution', () => {
    sandbox = createSandbox()

    const result = sandbox.run([], {
      stdin: loadEvent('pre-tool-use-bash.json'),
      env: { CLOOKS_AGENT: 'unknown' },
    })

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('unsupported CLOOKS_AGENT "unknown"')
    expect(result.stderr).toContain('Recognized values')
  })

  test('CLOOKS_AGENT=codex fails closed with not implemented diagnostic', () => {
    sandbox = createSandbox()

    const result = sandbox.run([], {
      stdin: loadEvent('pre-tool-use-bash.json'),
      env: { CLOOKS_AGENT: 'codex' },
    })

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('CLOOKS_AGENT=codex is not implemented yet')
    expect(result.stderr).not.toContain('see ')
  })
})
