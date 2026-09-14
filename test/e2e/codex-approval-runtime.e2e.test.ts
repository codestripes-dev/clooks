import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createSandbox, formatDiagnostics, type RunResult, type Sandbox } from './helpers/sandbox'

// Compiled Clooks contract tests, not native Codex tool dispatch/enforcement.
// Hooks use real ctx.ask; neither issuance nor resolution imports the source store.
let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())
const timeout = 10_000
const tokenPattern = /ca1_[0-9a-f]{64}/g
const deadTokenError = 'Unknown, expired or consumed approval token'
const bindingError = 'Approval token does not match the current confirmation'
const marker = 'approval-calls.jsonl'

interface NativeOutput {
  hookSpecificOutput?: {
    hookEventName: string
    permissionDecision?: string
    permissionDecisionReason?: string
    additionalContext?: string
    updatedInput?: Record<string, unknown>
  }
  systemMessage?: string
}

function env(extra: Record<string, string> = {}) {
  return {
    CLOOKS_AGENT: 'codex',
    ...extra,
    HOME: sandbox.home,
    CODEX_HOME: join(sandbox.home, '.codex'),
    CLOOKS_HOME_ROOT: sandbox.home,
  }
}

function wire(overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'approval-runtime-session',
    turn_id: 'turn-1',
    cwd: sandbox.dir,
    transcript_path: null,
    model: 'gpt-5',
    permission_mode: 'default',
    tool_name: 'exec_command',
    tool_use_id: 'call-1',
    tool_input: { command: '/usr/bin/true' },
    ...overrides,
  }
}

function run(overrides: Record<string, unknown> = {}, extra: Record<string, string> = {}) {
  sandbox.writeFile(marker, '')
  sandbox.writeFile('approval-completions.log', '')
  return sandbox.run([], { stdin: JSON.stringify(wire(overrides)), env: env(extra), timeout })
}

function output(result: RunResult): NativeOutput {
  expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
  expect(result.signalCode, formatDiagnostics(result)).toBeNull()
  expect(result.stderr, formatDiagnostics(result)).toBe('')
  return result.stdout === '' ? {} : JSON.parse(result.stdout)
}

function deny(result: RunResult, detail?: string) {
  const parsed = output(result)
  expect(parsed.hookSpecificOutput?.hookEventName).toBe('PreToolUse')
  expect(parsed.hookSpecificOutput?.permissionDecision).toBe('deny')
  expect(parsed.hookSpecificOutput?.updatedInput).toBeUndefined()
  const reason = parsed.hookSpecificOutput!.permissionDecisionReason!
  expect(typeof reason).toBe('string')
  if (detail !== undefined) expect(reason).toContain(detail)
  return reason
}

function pending(result: RunResult, alias = 'ask-a', reason = 'confirm A') {
  const message = deny(result, reason)
  expect(message).toContain(alias)
  // Prompt prose is not a snapshot contract; the opaque token grammar is.
  const tokens = [...new Set(message.match(tokenPattern) ?? [])]
  expect(tokens).toHaveLength(1)
  expect(message).toMatch(/ask the user/i)
  expect(message).toMatch(/wait for explicit approval/i)
  expect(message).toContain(`clooks approve ${tokens[0]}`)
  expect(message).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
  return tokens[0]!
}

function rejected(result: RunResult, detail: string) {
  const reason = deny(result, detail)
  expect(reason.match(tokenPattern)).toBeNull()
}

function annotation(reason: string) {
  return `clooks: PreToolUse allow reason (human annotation only; original allow-reason recipient unavailable; native policy retained): ${reason}`
}

function permit(result: RunResult, reason = 'confirm A', specific?: Record<string, unknown>) {
  expect(output(result)).toEqual({
    ...(specific ? { hookSpecificOutput: { hookEventName: 'PreToolUse', ...specific } } : {}),
    systemMessage: annotation(reason),
  })
}

function cli(token: string, ok = true) {
  const result = sandbox.run(['--json', 'approve', token], { env: env(), timeout })
  expect(result.rawExitCode, formatDiagnostics(result)).toBe(ok ? 0 : 1)
  expect(result.signalCode).toBeNull()
  expect(result.stderr).toBe('')
  const parsed = JSON.parse(result.stdout)
  expect(parsed.ok).toBe(ok)
  expect(parsed.command).toBe('approve')
  if (ok) {
    expect(parsed.data.token).toBe(token)
    expect(Number.isInteger(parsed.data.acknowledgedAt)).toBe(true)
    expect(parsed.data.expiresAt).toBeGreaterThan(parsed.data.acknowledgedAt)
  }
  return parsed
}

function inline(token: string, command = '/usr/bin/true', overrides: Record<string, unknown> = {}) {
  return run({
    ...overrides,
    tool_input: { command: `CLOOKS_APPROVAL_TOKENS=${token} ${command}` },
  })
}

function hook(alias: string, body: string, preamble = '') {
  const source = `
import { appendFileSync } from 'node:fs'
${preamble}
export const hook = {
  meta: { name: 'shared-display-name' },
  async PreToolUse(ctx) {
    appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, JSON.stringify({
      alias: ${JSON.stringify(alias)}, current: ctx.toolInput, original: ctx.originalToolInput,
    }) + '\\n')
    ${body}
  },
}
`
  sandbox.writeHook(`${alias}.ts`, source)
  return source
}

function configure(names = ['ask-a'], parallel = false, settings = '') {
  const config = `version: "1.0.0"
${names.map((name) => `${name}: { uses: './.clooks/hooks/${name}.ts', parallel: ${parallel}, handoff: false, maxFailures: 0 }`).join('\n')}
PreToolUse:
  order: ${JSON.stringify(names)}
${settings}`
  sandbox.writeConfig(config)
  return config
}

function fixture(body = "return ctx.ask({ reason: process.env.TEST_REASON ?? 'confirm A' })") {
  sandbox = createSandbox()
  hook('ask-a', body)
  configure()
}

function calls() {
  return sandbox
    .readFile(marker)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

describe('compiled Codex runtime approval transports', () => {
  test('actual ctx.ask reuses a pending token; safe dispatch harness has no denied effect and a positive allowed effect', () => {
    fixture()
    const target = join(sandbox.dir, 'touch target')
    const command = `/usr/bin/touch '${target}'`
    // This explicit harness dispatches only its fixed safe argv, never arbitrary hook output.
    const dispatch = (result: RunResult) => {
      const parsed = output(result)
      if (parsed.hookSpecificOutput?.permissionDecision === 'deny') return
      expect(parsed).toEqual({ systemMessage: annotation('confirm A') })
      const effect = Bun.spawnSync(['/usr/bin/touch', target], {
        cwd: sandbox.dir,
        env: env(),
        timeout,
      })
      expect(effect.exitCode).toBe(0)
      expect(effect.stderr.toString()).toBe('')
    }
    const first = run({ tool_input: { command } })
    const token = pending(first)
    expect(calls()).toEqual([{ alias: 'ask-a', current: { command }, original: { command } }])
    dispatch(first)
    expect(sandbox.fileExists('touch target')).toBe(false)
    expect(pending(run({ tool_input: { command } }))).toBe(token)
    const allowed = inline(token, command)
    permit(allowed)
    expect(calls()).toEqual([{ alias: 'ask-a', current: { command }, original: { command } }])
    dispatch(allowed)
    expect(sandbox.fileExists('touch target')).toBe(true)
    rmSync(target)
    const replay = inline(token, command)
    rejected(replay, deadTokenError)
    dispatch(replay)
    expect(sandbox.fileExists('touch target')).toBe(false)
    expect(cli(token, false).error).toContain(deadTokenError)
  }, 30_000)

  test('process environment is not an acknowledgement; registration survives real turn and call ID advancement', () => {
    fixture()
    const token = pending(run())
    expect(pending(run({}, { CLOOKS_APPROVAL_TOKENS: token }))).toBe(token)
    const receipt = cli(token)
    expect(cli(token)).toEqual(receipt)
    permit(run({ turn_id: 'user-approved-next-turn', tool_use_id: 'retry-call' }))
    expect(cli(token, false).error).toContain(deadTokenError)
  })

  for (const shape of [
    {
      name: 'compound shell',
      tool_name: 'exec_command',
      tool_input: { command: '/usr/bin/true && /usr/bin/true' },
    },
    {
      name: 'apply_patch',
      tool_name: 'apply_patch',
      tool_input: { command: '*** Begin Patch\n*** Add File: example.txt\n+hello\n*** End Patch' },
    },
    {
      name: 'MCP',
      tool_name: 'mcp__fixture__inspect',
      tool_input: { path: 'example.txt', options: { recursive: false }, limit: 0 },
    },
  ]) {
    test(`${shape.name} uses explicit CLI registration and unchanged arguments`, () => {
      fixture()
      const input = { tool_name: shape.tool_name, tool_input: shape.tool_input }
      const token = pending(run(input))
      expect(pending(run(input))).toBe(token)
      if (shape.name === 'compound shell') {
        rejected(
          inline(token, shape.tool_input.command!),
          'Inline approval requires a direct external command; use clooks approve and unchanged arguments',
        )
        expect(calls()).toEqual([])
        expect(pending(run(input))).toBe(token)
      }
      const before = calls()
      cli(token)
      expect(calls()).toEqual(before)
      permit(run(input))
      expect(calls()).toEqual([
        { alias: 'ask-a', current: shape.tool_input, original: shape.tool_input },
      ])
      expect(cli(token, false).error).toContain(deadTokenError)
    })
  }

  for (const parallel of [false, true]) {
    for (const transport of ['inline', 'mixed']) {
      test(`two asks keep configured prompt order and retained ${transport} acknowledgements, parallel=${parallel}`, () => {
        fixture()
        // In parallel B completes before A by an explicit shared-module barrier.
        sandbox.writeHook(
          'barrier.ts',
          'let release; export const done = new Promise(r => release = r); export const finish = () => release()',
        )
        const completionPath = JSON.stringify(join(sandbox.dir, 'approval-completions.log'))
        hook(
          'ask-a',
          `${parallel ? 'await done;' : ''} appendFileSync(${completionPath}, 'A\\n'); return ctx.ask({ reason: 'confirm A' })`,
          "import { done } from './barrier.ts'",
        )
        hook(
          'ask-b',
          `appendFileSync(${completionPath}, 'B\\n'); finish(); return ctx.ask({ reason: 'confirm B' })`,
          "import { finish } from './barrier.ts'",
        )
        configure(['ask-a', 'ask-b'], parallel)
        const a = pending(run())
        expect(
          calls()
            .map((call) => call.alias)
            .sort(),
        ).toEqual(['ask-a', 'ask-b'])
        expect(sandbox.readFile('approval-completions.log')).toBe(parallel ? 'B\nA\n' : 'A\nB\n')
        const b = pending(inline(a), 'ask-b', 'confirm B')
        expect(b).not.toBe(a)
        expect(pending(run(), 'ask-b', 'confirm B')).toBe(b)
        if (transport === 'mixed') cli(b)
        permit(transport === 'mixed' ? run() : inline(b), 'confirm B')
        expect(sandbox.readFile('approval-completions.log')).toBe(parallel ? 'B\nA\n' : 'A\nB\n')
        expect(cli(a, false).error).toContain(deadTokenError)
        expect(cli(b, false).error).toContain(deadTokenError)
      }, 30_000)
    }
  }

  test('aliases sharing one entry, display name and ask reason require distinct approvals', () => {
    fixture("return ctx.ask({ reason: 'shared confirmation' })")
    const config = configure(['ask-a', 'ask-b'])
    sandbox.writeConfig(config.replace('./.clooks/hooks/ask-b.ts', './.clooks/hooks/ask-a.ts'))
    const a = pending(run(), 'ask-a', 'shared confirmation')
    const observation = {
      alias: 'ask-a',
      current: { command: '/usr/bin/true' },
      original: { command: '/usr/bin/true' },
    }
    // Both configured aliases execute the same module with identical input and result.
    expect(calls()).toEqual([observation, observation])
    cli(a)
    const b = pending(run(), 'ask-b', 'shared confirmation')
    expect(b).not.toBe(a)
    cli(a)
    expect(pending(run(), 'ask-b', 'shared confirmation')).toBe(b)
    cli(b)
    permit(run(), 'shared confirmation')
    expect(calls()).toEqual([observation, observation])
    for (const token of [a, b]) expect(cli(token, false).error).toContain(deadTokenError)
  }, 30_000)

  test('A acknowledgement survives a changed B reason without changing pipeline or entry bytes', () => {
    fixture()
    hook('ask-b', "return ctx.ask({ reason: process.env.TEST_B_REASON ?? 'confirm B' })")
    configure(['ask-a', 'ask-b'])
    const a = pending(run())
    cli(a)
    const oldB = pending(run(), 'ask-b', 'confirm B')
    cli(oldB)
    const changed = { TEST_B_REASON: 'confirm B revised' }
    const newB = pending(run({}, changed), 'ask-b', 'confirm B revised')
    expect(newB).not.toBe(oldB)
    expect(pending(run({}, changed), 'ask-b', 'confirm B revised')).toBe(newB)
    rejected(
      run({ tool_input: { command: `CLOOKS_APPROVAL_TOKENS=${oldB} /usr/bin/true` } }, changed),
      bindingError,
    )
    cli(newB)
    permit(run({}, changed), 'confirm B revised')
    for (const token of [a, oldB, newB]) expect(cli(token, false).error).toContain(deadTokenError)
  }, 30_000)

  test('approve itself remains hooked, with a separately bound inline ask and no target exemption', () => {
    fixture()
    const target = { tool_name: 'mcp__fixture__inspect', tool_input: { path: 'example.txt' } }
    const a = pending(run(target))
    const command = `clooks approve ${a}`
    const b = pending(run({ tool_input: { command } }))
    expect(b).not.toBe(a)
    permit(inline(b, command))
    cli(a)
    permit(run(target))
    expect(cli(b, false).error).toContain(deadTokenError)
  })
})

describe('compiled Codex approval bindings and precedence', () => {
  for (const field of ['session', 'child', 'tool', 'cwd', 'input', 'permission-mode']) {
    test(`rejects an inline token for changed ${field} without consuming the original`, () => {
      fixture()
      mkdirSync(join(sandbox.dir, 'other-cwd'))
      const token = pending(run())
      const changed: Record<string, unknown> =
        field === 'session'
          ? { session_id: 'other-session' }
          : field === 'child'
            ? { agent_id: 'other-child', agent_type: 'worker' }
            : field === 'tool'
              ? { tool_name: 'Bash' }
              : field === 'cwd'
                ? { cwd: join(sandbox.dir, 'other-cwd') }
                : field === 'permission-mode'
                  ? { permission_mode: 'plan' }
                  : {}
      rejected(
        inline(token, field === 'input' ? '/usr/bin/false' : '/usr/bin/true', changed),
        bindingError,
      )
      permit(inline(token))
    })
  }

  for (const change of ['reason', 'config', 'entry-bytes']) {
    test(`changed ${change} requires fresh approval; exact restoration retains the blocked token`, () => {
      fixture()
      const source = sandbox.readFile('.clooks/hooks/ask-a.ts')
      const config = sandbox.readFile('.clooks/clooks.yml')
      const token = pending(run())
      cli(token)
      if (change === 'config')
        sandbox.writeConfig(config.replace('handoff: false', 'handoff: true'))
      if (change === 'entry-bytes')
        sandbox.writeHook('ask-a.ts', source + '\n// different entry bytes\n')
      const extra: Record<string, string> = change === 'reason' ? { TEST_REASON: 'confirm A ' } : {}
      const replacement = pending(
        run({}, extra),
        'ask-a',
        change === 'reason' ? 'confirm A ' : 'confirm A',
      )
      expect(replacement).not.toBe(token)
      rejected(
        run({ tool_input: { command: `CLOOKS_APPROVAL_TOKENS=${token} /usr/bin/true` } }, extra),
        bindingError,
      )
      sandbox.writeHook('ask-a.ts', source)
      sandbox.writeConfig(config)
      permit(run())
      expect(cli(token, false).error).toContain(deadTokenError)
    })
  }

  test('unknown and expired presented tokens fail with the specific storage diagnostic', () => {
    fixture()
    const token = pending(run())
    rejected(inline('ca1_' + '0'.repeat(64)), deadTokenError)
    expect(pending(run())).toBe(token)
    // Fault injection changes only the deadline of a real runtime-issued row.
    // No fixture can manufacture a binding or seed an approval for this suite.
    const db = new Database(join(sandbox.home, '.clooks/approvals/codex.sqlite'))
    try {
      expect(
        db.query('UPDATE approvals SET expiresAt = 0 WHERE token = ?').run(token).changes,
      ).toBe(1)
    } finally {
      db.close()
    }
    rejected(inline(token), deadTokenError)
    expect(cli(token, false).error).toContain(deadTokenError)
    expect(pending(run())).not.toBe(token)
  })

  for (const mode of ['block', 'crash']) {
    test(`${mode} takes precedence and retains already registered asks`, () => {
      fixture()
      hook(
        'gate',
        `if (process.env.TEST_GATE === 'yes') {
        ${mode === 'block' ? "return ctx.block({ reason: 'explicit gate block' })" : "throw new Error('approval fixture crash')"}
      } return ctx.allow()`,
      )
      configure(['ask-a', 'gate'])
      const token = pending(run())
      cli(token)
      const blocked = run({}, { TEST_GATE: 'yes' })
      deny(blocked, mode === 'block' ? 'explicit gate block' : 'approval fixture crash')
      expect(calls().map((call) => call.alias)).toEqual(['ask-a', 'gate'])
      expect(blocked.stdout.match(tokenPattern)).toBeNull()
      expect(cli(token).data.token).toBe(token)
      permit(run())
    })
  }
})

describe('compiled Codex approval rewrite and context semantics', () => {
  for (const patch of ['losing-ask-only', 'winning-ask', 'allow-loser']) {
    test(`preserves exact reducer output and observed materialized inputs: ${patch}`, () => {
      fixture()
      hook(
        'ask-a',
        "return ctx.ask({ reason: 'confirm A', injectContext: 'discard ask A', updatedInput: { command: '/usr/bin/false' } })",
      )
      hook(
        'allow',
        `return ctx.allow({ injectContext: 'allow context' ${patch === 'allow-loser' ? ", updatedInput: { command: '/usr/bin/true final' }" : ''} })`,
      )
      hook(
        'ask-b',
        `return ctx.ask({ reason: 'confirm B', injectContext: 'winner context' ${patch === 'winning-ask' ? ", updatedInput: { command: '/usr/bin/true final' }" : ''} })`,
      )
      configure(['ask-a', 'allow', 'ask-b'])
      const a = pending(run())
      expect(calls()).toEqual([
        {
          alias: 'ask-a',
          current: { command: '/usr/bin/true' },
          original: { command: '/usr/bin/true' },
        },
        {
          alias: 'allow',
          current: { command: '/usr/bin/false' },
          original: { command: '/usr/bin/true' },
        },
        {
          alias: 'ask-b',
          current: { command: patch === 'allow-loser' ? '/usr/bin/true final' : '/usr/bin/false' },
          original: { command: '/usr/bin/true' },
        },
      ])
      cli(a)
      const b = pending(run(), 'ask-b', 'confirm B')
      cli(b)
      permit(run(), 'confirm B', {
        additionalContext: 'allow context\nwinner context',
        ...(patch === 'losing-ask-only'
          ? {}
          : {
              permissionDecision: 'allow',
              updatedInput: { command: '/usr/bin/true final' },
            }),
      })
      expect(cli(a, false).error).toContain(deadTokenError)
      expect(cli(b, false).error).toContain(deadTokenError)
    }, 30_000)
  }

  for (const native of ['apply_patch', 'mcp__fixture__inspect']) {
    test(`ask.updatedInput round-trips real-shaped ${native} through its codec`, () => {
      const original =
        native === 'apply_patch'
          ? { command: '*** Begin Patch\n*** Add File: before.txt\n+before\n*** End Patch' }
          : { path: 'before.txt', remove: true, keep: null, options: { recursive: false } }
      const patch =
        native === 'apply_patch'
          ? { command: '*** Begin Patch\n*** Add File: after.txt\n+after\n*** End Patch' }
          : { path: 'after.txt', remove: null, options: { recursive: true } }
      const expected =
        native === 'apply_patch'
          ? patch
          : { path: 'after.txt', keep: null, options: { recursive: true } }
      fixture(`return ctx.ask({ reason: 'confirm A', updatedInput: ${JSON.stringify(patch)} })`)
      const input = { tool_name: native, tool_input: original }
      const token = pending(run(input))
      cli(token)
      permit(run(input), 'confirm A', { permissionDecision: 'allow', updatedInput: expected })
      expect(cli(token, false).error).toContain(deadTokenError)
    })
  }

  test('unsupported ask.updatedInput fails codec validation before token issuance', () => {
    fixture("return ctx.ask({ reason: 'confirm A', updatedInput: { cwd: '/wrong' } })")
    rejected(run(), 'command-only updates cannot contain additional keys, including null deletions')
    expect(calls().map((call) => call.alias)).toEqual(['ask-a'])
    expect(sandbox.homeFileExists('.clooks/approvals/codex.sqlite')).toBe(false)
  })
})

describe('compiled Codex approval retirement and Claude isolation', () => {
  for (const path of ['no-asks', 'no-hooks', 'no-match', 'no-config', 'config-degraded']) {
    test(`${path} success retires prior acknowledgements before restored hooks can reuse them`, () => {
      fixture(
        "if (process.env.TEST_NO_ASK === 'yes') return ctx.allow(); return ctx.ask({ reason: 'confirm A' })",
      )
      const source = sandbox.readFile('.clooks/hooks/ask-a.ts')
      const config = sandbox.readFile('.clooks/clooks.yml')
      const token = pending(run())
      cli(token)
      if (path === 'no-hooks') sandbox.writeConfig('version: "1.0.0"\n')
      if (path === 'no-match')
        sandbox.writeHook(
          'ask-a.ts',
          source.replace('async PreToolUse(ctx)', 'async SessionStart(ctx)'),
        )
      if (path === 'no-config') rmSync(join(sandbox.dir, '.clooks/clooks.yml'))
      if (path === 'config-degraded') {
        sandbox.writeConfig('version: "1.0.0"\nconfig:\n  onError: invalid\n')
        for (let attempt = 0; attempt < 2; attempt++) {
          deny(run(), 'config validation failed')
          expect(cli(token).data.token).toBe(token)
        }
      }
      const passed = output(run({}, path === 'no-asks' ? { TEST_NO_ASK: 'yes' } : {}))
      if (path === 'config-degraded') {
        expect(passed).toEqual({
          systemMessage:
            '[clooks] Config validation failed 3 consecutive times. Hooks are disabled to prevent deadlock. Fix .clooks/clooks.yml: clooks: global config "onError" must be "block" or "continue", got "invalid"',
        })
      } else expect(passed).toEqual({})
      expect(calls().map((call) => call.alias)).toEqual(path === 'no-asks' ? ['ask-a'] : [])
      sandbox.writeConfig(config)
      sandbox.writeHook('ask-a.ts', source)
      expect(cli(token, false).error).toContain(deadTokenError)
      expect(pending(run())).not.toBe(token)
      rejected(inline(token), deadTokenError)
    }, 30_000)
  }

  test('plain and explicit Claude ask bytes stay identical and never open Codex approval storage', () => {
    fixture("return ctx.ask({ reason: 'confirm A', injectContext: 'Claude context' })")
    sandbox.writeHomeFile('.clooks/approvals/codex.sqlite', 'unreadable as sqlite')
    const before = readFileSync(join(sandbox.home, '.clooks/approvals/codex.sqlite'))
    const input = JSON.stringify(wire({ tool_name: 'Bash' }))
    const results = ['', 'claude-code'].map((agent) => {
      const selected = env()
      if (agent) selected.CLOOKS_AGENT = agent
      else delete (selected as Partial<typeof selected>).CLOOKS_AGENT
      return sandbox.run([], { stdin: input, env: selected, timeout })
    })
    for (const result of results)
      expect(output(result)).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: 'confirm A',
          additionalContext: 'Claude context',
        },
      })
    expect(results[0]!.stdout).toBe(results[1]!.stdout)
    expect(readFileSync(join(sandbox.home, '.clooks/approvals/codex.sqlite'))).toEqual(before)
  })
})
