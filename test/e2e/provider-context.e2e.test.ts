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
    phase, provider: input.provider, event: input.event, parallel: input.parallel,
  }) + '\\n')
}
export const hook = {
  meta: { name: '${name}' },
  beforeHook(event) { record('before', event.input) },
  SessionStart(ctx) {
    record('handler', ctx)
    return ctx.skip({ injectContext: '${name}:' + ctx.provider })
  },
  afterHook(event) { record('after', event.input) },
}
`,
  )
}

function expectReceipt(name: string, provider: string, parallel: boolean) {
  const records = sandbox
    .readFile(`.clooks/hooks/${name}.jsonl`)
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(records).toEqual(
    ['before', 'handler', 'after'].map((phase) => ({
      phase,
      provider,
      event: 'SessionStart',
      parallel,
    })),
  )
}

const selections: Array<{ label: string; provider: string; env: Record<string, string> }> = [
  { label: 'unset', provider: 'claude-code', env: {} },
  { label: 'explicit Claude', provider: 'claude-code', env: { CLOOKS_AGENT: 'claude-code' } },
  { label: 'Codex', provider: 'codex', env: { CLOOKS_AGENT: 'codex' } },
]

describe('compiled engine provider context', () => {
  for (const selection of selections) {
    for (const parallel of [false, true]) {
      test(`${selection.label}: provider survives ${parallel ? 'parallel' : 'sequential'} lifecycle dispatch and raw spoofing`, () => {
        sandbox = createSandbox()
        for (const name of ['provider-a', 'provider-b']) writeProbe(name)
        sandbox.writeConfig(`version: '1.0.0'
provider-a:
  parallel: ${parallel}
provider-b:
  parallel: ${parallel}
`)
        const result = sandbox.run([], {
          stdin: JSON.stringify({
            hook_event_name: 'SessionStart',
            session_id: 'provider-session',
            cwd: sandbox.dir,
            transcript_path: '/tmp/provider-transcript.jsonl',
            model: 'model',
            permission_mode: 'default',
            source: 'startup',
            provider: selection.provider === 'codex' ? 'claude-code' : 'codex',
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
            additionalContext: `provider-a:${selection.provider}\nprovider-b:${selection.provider}`,
          },
        })
        for (const name of ['provider-a', 'provider-b']) {
          expectReceipt(name, selection.provider, parallel)
        }
      })
    }
  }
})

describe('compiled synthetic provider context', () => {
  for (const provider of [undefined, 'claude-code', 'codex']) {
    test(`synthetic ${provider ?? 'default'} is independent of adapter environment`, () => {
      sandbox = createSandbox()
      writeProbe('synthetic-provider')
      const result = sandbox.run(['test', '.clooks/hooks/synthetic-provider.ts'], {
        stdin: JSON.stringify({ event: 'SessionStart', source: 'startup', provider }),
        env: {
          CLOOKS_AGENT: provider === 'codex' ? 'claude-code' : 'codex',
          CODEX_HOME: join(sandbox.home, '.codex'),
        },
        timeout: 10_000,
      })
      const expected = provider ?? 'claude-code'
      expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
      expect(result.signalCode).toBeNull()
      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout)).toEqual({
        result: 'skip',
        injectContext: `synthetic-provider:${expected}`,
      })
      expectReceipt('synthetic-provider', expected, false)
    })
  }

  test('invalid explicit provider fails before lifecycle or handler runs', () => {
    sandbox = createSandbox()
    writeProbe('invalid-provider')
    const args = ['test', '.clooks/hooks/invalid-provider.ts']
    const baseline = sandbox.run(args, {
      stdin: JSON.stringify({ event: 'SessionStart', source: 'startup', provider: 'codex' }),
      timeout: 10_000,
    })
    expect(baseline.rawExitCode, formatDiagnostics(baseline)).toBe(0)
    expectReceipt('invalid-provider', 'codex', false)
    const before = sandbox.readFile('.clooks/hooks/invalid-provider.jsonl')
    for (const provider of [null, '', 'unknown', 0, false, {}, []]) {
      const result = sandbox.run(args, {
        stdin: JSON.stringify({ event: 'SessionStart', source: 'startup', provider }),
        timeout: 10_000,
      })
      expect(result.rawExitCode, formatDiagnostics(result)).toBe(2)
      expect(result.signalCode).toBeNull()
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('clooks test: provider must be "claude-code" or "codex"\n')
      expect(sandbox.readFile('.clooks/hooks/invalid-provider.jsonl')).toBe(before)
    }
  })

  test('example documents deliberate synthetic identity without wire translation', () => {
    sandbox = createSandbox()
    const result = sandbox.run(['test', 'example', 'SessionStart'], { timeout: 10_000 })
    expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('provider')
    expect(result.stdout).toContain('"claude-code" | "codex"')
    expect(result.stdout).toContain('Synthetic identity only; no provider wire translation.')
  })
})
