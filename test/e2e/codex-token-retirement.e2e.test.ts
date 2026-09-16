import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSandbox, formatDiagnostics, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())

const token = `ca1_${'a'.repeat(64)}`
const legacyFiles = [
  '.clooks/approvals/codex.sqlite',
  '.clooks/approvals/codex.sqlite-wal',
  '.clooks/approvals/codex.sqlite-shm',
]

function assertRetiredCommand() {
  const result = sandbox.run(['approve', token], {
    env: { CLOOKS_APPROVAL_TOKENS: token },
    stdin: payload('/usr/bin/true'),
  })
  expect(result.exitCode, formatDiagnostics(result)).toBeGreaterThan(0)
  expect(result.stdout, formatDiagnostics(result)).toBe('')
  expect(result.stderr).toContain("unknown command 'approve'")
}

function payload(command: string) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 'retirement-session',
    turn_id: 'retirement-turn',
    cwd: sandbox.dir,
    model: 'gpt-5',
    permission_mode: 'default',
    tool_use_id: 'retirement-call',
    tool_name: 'Bash',
    tool_input: { command },
  })
}

describe('compiled Codex token retirement', () => {
  test('approve is unknown without loading malformed project configuration or creating legacy state', () => {
    sandbox = createSandbox()
    sandbox.writeFile('.clooks/clooks.yml', 'this is not valid: [yaml')

    assertRetiredCommand()

    for (const file of legacyFiles) expect(sandbox.homeFileExists(file)).toBe(false)
    expect(existsSync(join(sandbox.home, '.clooks', 'approvals'))).toBe(false)
    const help = sandbox.run(['--help'])
    expect(help.exitCode, formatDiagnostics(help)).toBe(0)
    expect(help.stderr, formatDiagnostics(help)).toBe('')
    expect(help.stdout).toMatch(/^\s+mcp\s+Serve shared hook approvals over MCP stdio$/m)
    expect(help.stdout).not.toMatch(/^\s+approve(?:\s|$)/m)
  })

  test('approve leaves existing legacy database, WAL and SHM bytes untouched', () => {
    sandbox = createSandbox()
    for (const [index, file] of legacyFiles.entries()) {
      sandbox.writeHomeFile(file, `legacy-${index}\0state`)
    }
    const before = new Map(
      legacyFiles.map((file) => [file, readFileSync(join(sandbox.home, file))]),
    )

    assertRetiredCommand()

    for (const file of legacyFiles) {
      expect(readFileSync(join(sandbox.home, file))).toEqual(before.get(file)!)
    }
  })

  test('legacy environment and command carriers remain literal and cannot grant consent', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\nask: { handoff: false, maxFailures: 0 }\n')
    sandbox.writeHook(
      'ask.ts',
      `
import { writeFileSync } from 'node:fs'
export const hook = { meta: { name: 'ask' }, PreToolUse(ctx) {
  writeFileSync(${JSON.stringify(join(sandbox.dir, 'observed.txt'))}, String(ctx.toolInput.command))
  return ctx.ask({ reason: 'confirm literal command' })
} }
`,
    )
    const command = `CLOOKS_APPROVAL_TOKENS=${token} /usr/bin/true`
    const result = sandbox.run([], {
      env: { CLOOKS_AGENT: 'codex', CLOOKS_APPROVAL_TOKENS: token },
      stdin: payload(command),
      timeout: 10_000,
    })

    expect(result.exitCode, formatDiagnostics(result)).toBe(0)
    expect(result.stderr, formatDiagnostics(result)).toBe('')
    const denial = JSON.parse(result.stdout).hookSpecificOutput
    expect(denial).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        'clooks: Codex PreToolUse hook "ask" capability "approval": clooks: Approval unavailable: Live approval unavailable. Repair the Clooks registration for this provider and scope, then restart the client and retry. Pending call denial requested.',
    })
    expect(denial.updatedInput).toBeUndefined()
    expect(result.stdout).not.toContain('Approval token')
    expect(result.stdout).not.toContain('clooks approve')
    expect(sandbox.readFile('observed.txt')).toBe(command)
    expect(sandbox.homeFileExists('.clooks/approvals/codex.sqlite')).toBe(false)
  })
})
