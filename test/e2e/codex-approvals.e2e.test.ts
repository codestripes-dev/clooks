import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSandbox, formatDiagnostics, type RunResult, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())
const timeout = 10_000
const binding = {
  baseInvocationHash: 'a'.repeat(64),
  decisionHash: 'b'.repeat(64),
  confirmationHash: 'c'.repeat(64),
}
const secondBinding = { ...binding, confirmationHash: 'd'.repeat(64) }
const storeSource = join(import.meta.dir, '../../src/agents/codex/approval-store.ts')
interface RecordReceipt {
  token: string
  issuedAt: number
  expiresAt: number
  acknowledgedAt: number | null
  consumedAt: number | null
  confirmationHash: string
}

function payload(command: string) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 'approval-e2e',
    turn_id: 'turn-1',
    cwd: sandbox.dir,
    transcript_path: null,
    model: 'gpt-5',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_use_id: 'call-1',
    tool_input: { command },
  })
}

function engine(command: string, extra: Record<string, string> = {}) {
  return sandbox.run([], {
    stdin: payload(command),
    env: { CLOOKS_AGENT: 'codex', ...extra },
    timeout,
  })
}

function envelope(result: RunResult, ok = true) {
  expect(result.exitCode, formatDiagnostics(result)).toBe(ok ? 0 : 1)
  expect(result.stderr).toBe('')
  const parsed = JSON.parse(result.stdout)
  expect(parsed.ok).toBe(ok)
  expect(parsed.command).toBe('approve')
  return parsed
}

function fixture() {
  sandbox = createSandbox()
  // Test-only hook calls the private store through the compiled engine and config loader.
  sandbox.writeHook(
    'approval-fixture.ts',
    `
import { appendFileSync } from 'node:fs'
import { ApprovalStore } from ${JSON.stringify(storeSource)}
export const hook = {
  meta: { name: 'approval-fixture' },
  PreToolUse(ctx) {
    appendFileSync(${JSON.stringify(join(sandbox.dir, 'calls.log'))}, 'called\\n')
    const store = new ApprovalStore(undefined, () => Number(process.env.TEST_NOW ?? Date.now()))
    const binding = JSON.parse(process.env.TEST_BINDING)
    let result
    if (ctx.toolInput.command === 'fixture issue') result = store.issueOrReuse(binding)
    else if (ctx.toolInput.command === 'fixture resolve') result = store.resolveAttempt(binding, [], JSON.parse(process.env.TEST_CONFIRMATIONS))
    else if (ctx.toolInput.command === 'fixture finalize') {
      try {
        store.finalizePermit(binding.baseInvocationHash, binding.decisionHash, JSON.parse(process.env.TEST_REQUIRED))
        result = { permit: true }
      } catch (error) {
        if (error.message !== 'Approval is no longer valid for this permit') throw error
        result = { permit: false, error: error.message }
      }
    } else return ctx.block({ reason: 'ordinary hook blocks approval command' })
    return ctx.block({ reason: JSON.stringify(result) })
  },
}
`,
  )
  sandbox.writeConfig(
    'version: "1.0.0"\napproval-fixture: {}\nPreToolUse:\n  order: [approval-fixture]\n',
  )
}

function receipt(result: RunResult) {
  expect(result.exitCode, formatDiagnostics(result)).toBe(0)
  expect(result.stderr).toBe('')
  const output = JSON.parse(result.stdout).hookSpecificOutput
  expect(output.permissionDecision).toBe('deny')
  expect(sandbox.readFile('calls.log')).toContain('called\n')
  return JSON.parse(output.permissionDecisionReason)
}

function issue(selected = binding, now?: number): RecordReceipt {
  return receipt(
    engine('fixture issue', {
      TEST_BINDING: JSON.stringify(selected),
      ...(now === undefined ? {} : { TEST_NOW: String(now) }),
    }),
  )
}

function resolve() {
  return receipt(
    engine('fixture resolve', {
      TEST_BINDING: JSON.stringify(binding),
      TEST_CONFIRMATIONS: JSON.stringify([
        binding.confirmationHash,
        secondBinding.confirmationHash,
      ]),
    }),
  )
}

function cli(token: string, env: Record<string, string> = {}, json = true) {
  return sandbox.run([...(json ? ['--json'] : []), 'approve', token], { env, timeout })
}

describe('compiled Codex approval store and registration (no runtime integration)', () => {
  test('compiled hook issuance, CLI idempotent registration and exact two-token finalization', async () => {
    fixture()
    const a = issue()
    const b = issue(secondBinding)
    expect(a.token).toMatch(/^ca1_[0-9a-f]{64}$/)
    expect(a.expiresAt - a.issuedAt).toBe(300_000)
    expect(issue()).toEqual(a)
    expect(resolve()).toEqual({
      requiredTokens: [],
      pendingConfirmations: [binding.confirmationHash, secondBinding.confirmationHash],
    })
    const first = envelope(cli(a.token))
    expect(first.data.expiresAt).toBe(a.expiresAt)
    expect(envelope(cli(a.token))).toEqual(first)
    expect(resolve().pendingConfirmations).toEqual([secondBinding.confirmationHash])
    envelope(cli(b.token))
    expect(issue().consumedAt).toBeNull()
    const resolved = resolve()
    expect(resolved.pendingConfirmations).toEqual([])
    expect(resolved.requiredTokens).toEqual([
      { token: a.token, expectedConfirmationHash: binding.confirmationHash },
      { token: b.token, expectedConfirmationHash: secondBinding.confirmationHash },
    ])
    const results = await Promise.all(
      [1, 2].map(() =>
        sandbox.runAsync([], {
          stdin: payload('fixture finalize'),
          timeout,
          env: {
            CLOOKS_AGENT: 'codex',
            TEST_BINDING: JSON.stringify(binding),
            TEST_REQUIRED: JSON.stringify(resolved.requiredTokens),
          },
        }),
      ),
    )
    expect(results.map((result) => receipt(result).permit).sort()).toEqual([false, true])
    expect(results.map(receipt).find((result) => !result.permit).error).toBe(
      'Approval is no longer valid for this permit',
    )
    const consumedState = readFileSync(join(sandbox.home, '.clooks/approvals/codex.sqlite'))
    expect(envelope(cli(a.token), false).error).toContain('consumed')
    expect(envelope(cli(b.token), false).error).toContain('consumed')
    expect(readFileSync(join(sandbox.home, '.clooks/approvals/codex.sqlite'))).toEqual(
      consumedState,
    )
    expect(issue().token).not.toBe(a.token)
  }, 30_000)

  test('two compiled processes reuse one initially absent-store confirmation', async () => {
    fixture()
    const results = await Promise.all(
      [1, 2].map(() =>
        sandbox.runAsync([], {
          stdin: payload('fixture issue'),
          timeout,
          env: { CLOOKS_AGENT: 'codex', TEST_BINDING: JSON.stringify(binding) },
        }),
      ),
    )
    expect(receipt(results[0]!)).toEqual(receipt(results[1]!))
  }, 30_000)

  test('registration is noninteractive, uses runtime home not project/CODEX_HOME, and never executes a target', () => {
    fixture()
    const a = issue()
    const elsewhere = join(sandbox.home, 'elsewhere')
    mkdirSync(elsewhere)
    const callsBefore = sandbox.readFile('calls.log')
    const result = sandbox.run(['approve', a.token], {
      cwd: elsewhere,
      stdin: '',
      env: { CODEX_HOME: elsewhere },
      timeout,
    })
    expect(result.exitCode, formatDiagnostics(result)).toBe(0)
    expect(result.stdout + result.stderr).toContain('Approval acknowledged')
    expect(result.stdout + result.stderr).toContain(new Date(a.expiresAt).toISOString())
    expect(sandbox.readFile('calls.log')).toBe(callsBefore)
    expect(issue().acknowledgedAt).not.toBeNull()
    expect(issue().consumedAt).toBeNull()
    const dbBefore = readFileSync(join(sandbox.home, '.clooks/approvals/codex.sqlite'))
    expect(envelope(cli(a.token, { CLOOKS_HOME_ROOT: elsewhere }), false).error).toContain(
      'Unknown',
    )
    expect(readFileSync(join(sandbox.home, '.clooks/approvals/codex.sqlite'))).toEqual(dbBefore)
    expect(sandbox.homeFileExists('elsewhere/.clooks/approvals')).toBe(false)
  })

  test('approve command remains an ordinary hooked shell call; explicit blocks are not bypassed', () => {
    fixture()
    const a = issue()
    const before = sandbox.readFile('calls.log')
    const result = engine(`clooks approve ${a.token}`, { TEST_BINDING: JSON.stringify(binding) })
    expect(result.exitCode, formatDiagnostics(result)).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout).hookSpecificOutput).toMatchObject({
      permissionDecision: 'deny',
      permissionDecisionReason: 'ordinary hook blocks approval command',
    })
    expect(sandbox.readFile('calls.log')).toBe(before + 'called\n')
    expect(issue().acknowledgedAt).toBeNull()
    envelope(cli(a.token))
    expect(issue().acknowledgedAt).not.toBeNull()
  })

  test('malformed, missing, expired and unknown tokens fail through compiled CLI routing', () => {
    fixture()
    expect(envelope(cli('bad'), false).error).toContain('Malformed')
    expect(envelope(cli('ca1_' + '0'.repeat(64)), false).error).toContain('Unknown')
    const missing = sandbox.run(['approve'], { timeout })
    expect(missing.exitCode).toBe(1)
    expect(missing.stderr).toContain('missing required argument')
    const expired = issue(binding, Date.now() - 300_001)
    const dbBefore = readFileSync(join(sandbox.home, '.clooks/approvals/codex.sqlite'))
    expect(envelope(cli(expired.token), false).error).toMatch(/expired|Unknown/)
    expect(readFileSync(join(sandbox.home, '.clooks/approvals/codex.sqlite'))).toEqual(dbBefore)
  })

  test('corruption and non-root write failures refuse registration without recreating state', () => {
    fixture()
    const a = issue()
    const dbPath = join(sandbox.home, '.clooks/approvals/codex.sqlite')
    const before = readFileSync(dbPath)
    // Deny traversal: the store legitimately repairs modes on its owned file/directory.
    chmodSync(join(sandbox.home, '.clooks'), 0o000)
    try {
      expect(envelope(cli(a.token), false).error).toContain('storage unavailable')
    } finally {
      chmodSync(join(sandbox.home, '.clooks'), 0o700)
    }
    expect(readFileSync(dbPath)).toEqual(before)
    writeFileSync(dbPath, 'broken sqlite')
    expect(envelope(cli(a.token), false).error).toContain('storage unavailable')
    expect(readFileSync(dbPath, 'utf8')).toBe('broken sqlite')
  })
})
