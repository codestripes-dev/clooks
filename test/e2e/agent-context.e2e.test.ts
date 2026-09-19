import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import { createSandbox, formatDiagnostics, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())

function writeProbe(name: string) {
  sandbox.writeHook(
    `${name}.ts`,
    `import { appendFileSync } from 'fs'
function record(phase, input) {
  appendFileSync(import.meta.dir + '/${name}.jsonl', JSON.stringify({
    phase, agent: input.agent, event: input.event, parallel: input.parallel,
  }) + '\\n')
}
export const hook = {
  meta: { name: '${name}' },
  beforeHook(event) { record('before', event.input) },
  SessionStart(ctx) {
    record('handler', ctx)
    return ctx.skip({ injectContext: '${name}:' + ctx.agent })
  },
  afterHook(event) { record('after', event.input) },
}
`,
  )
}

function expectReceipt(name: string, agent: string, parallel: boolean) {
  const records = sandbox
    .readFile(`.clooks/hooks/${name}.jsonl`)
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(records).toEqual(
    ['before', 'handler', 'after'].map((phase) => ({
      phase,
      agent,
      event: 'SessionStart',
      parallel,
    })),
  )
}

const selections: Array<{ label: string; agent: string; env: Record<string, string> }> = [
  { label: 'unset', agent: 'claude-code', env: {} },
  { label: 'explicit Claude', agent: 'claude-code', env: { CLOOKS_AGENT: 'claude-code' } },
  { label: 'Codex', agent: 'codex', env: { CLOOKS_AGENT: 'codex' } },
]

describe('compiled engine agent context', () => {
  for (const selection of selections) {
    for (const parallel of [false, true]) {
      test(`${selection.label}: agent survives ${parallel ? 'parallel' : 'sequential'} lifecycle dispatch and raw spoofing`, () => {
        sandbox = createSandbox()
        for (const name of ['agent-a', 'agent-b']) writeProbe(name)
        sandbox.writeConfig(`version: '1.0.0'
agent-a:
  parallel: ${parallel}
agent-b:
  parallel: ${parallel}
`)
        const result = sandbox.run([], {
          stdin: JSON.stringify({
            hook_event_name: 'SessionStart',
            session_id: 'agent-session',
            cwd: sandbox.dir,
            transcript_path: '/tmp/agent-transcript.jsonl',
            model: 'model',
            permission_mode: 'default',
            source: 'startup',
            agent: selection.agent === 'codex' ? 'claude-code' : 'codex',
          }),
          env: { ...selection.env, CODEX_HOME: join(sandbox.home, '.codex') },
          timeout: 10_000,
        })
        expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
        expect(result.signalCode).toBeNull()
        expect(result.stderr).toBe('')
        const output = JSON.parse(result.stdout)
        if (parallel) {
          output.hookSpecificOutput.additionalContext = output.hookSpecificOutput.additionalContext
            .split('\n')
            .sort()
            .join('\n')
        }
        expect(output).toEqual({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `agent-a:${selection.agent}\nagent-b:${selection.agent}`,
          },
        })
        for (const name of ['agent-a', 'agent-b']) {
          expectReceipt(name, selection.agent, parallel)
        }
      })
    }
  }
})

describe('compiled synthetic agent context', () => {
  for (const agent of [undefined, 'claude-code', 'codex']) {
    test(`synthetic ${agent ?? 'default'} is independent of adapter environment`, () => {
      sandbox = createSandbox()
      writeProbe('synthetic-agent')
      const result = sandbox.run(['test', '.clooks/hooks/synthetic-agent.ts'], {
        stdin: JSON.stringify({ event: 'SessionStart', source: 'startup', agent }),
        env: {
          CLOOKS_AGENT: agent === 'codex' ? 'claude-code' : 'codex',
          CODEX_HOME: join(sandbox.home, '.codex'),
        },
        timeout: 10_000,
      })
      const expected = agent ?? 'claude-code'
      expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
      expect(result.signalCode).toBeNull()
      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout)).toEqual({
        result: 'skip',
        injectContext: `synthetic-agent:${expected}`,
      })
      expectReceipt('synthetic-agent', expected, false)
    })
  }

  test('invalid explicit agent fails before lifecycle or handler runs', () => {
    sandbox = createSandbox()
    writeProbe('invalid-agent')
    const args = ['test', '.clooks/hooks/invalid-agent.ts']
    const baseline = sandbox.run(args, {
      stdin: JSON.stringify({ event: 'SessionStart', source: 'startup', agent: 'codex' }),
      timeout: 10_000,
    })
    expect(baseline.rawExitCode, formatDiagnostics(baseline)).toBe(0)
    expectReceipt('invalid-agent', 'codex', false)
    const before = sandbox.readFile('.clooks/hooks/invalid-agent.jsonl')
    for (const agent of [null, '', 'unknown', 0, false, {}, []]) {
      const result = sandbox.run(args, {
        stdin: JSON.stringify({ event: 'SessionStart', source: 'startup', agent }),
        timeout: 10_000,
      })
      expect(result.rawExitCode, formatDiagnostics(result)).toBe(2)
      expect(result.signalCode).toBeNull()
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('clooks test: agent must be "claude-code" or "codex"\n')
      expect(sandbox.readFile('.clooks/hooks/invalid-agent.jsonl')).toBe(before)
    }
  })

  test('example documents deliberate synthetic identity without wire translation', () => {
    sandbox = createSandbox()
    const result = sandbox.run(['test', 'example', 'SessionStart'], { timeout: 10_000 })
    expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('agent')
    expect(result.stdout).toContain('"claude-code" | "codex"')
    expect(result.stdout).toContain('Synthetic identity only; no agent wire translation.')
  })
})
