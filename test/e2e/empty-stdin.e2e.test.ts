import { afterEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const EMPTY_STDIN_DIAGNOSTIC =
  'clooks: received empty stdin; no hook event was supplied.\n' +
  'No hook handlers were run.\n\n' +
  "If Claude was launched inside another agent's sandbox,\n" +
  'that sandbox may have prevented hook-input delivery.\n' +
  'Retry the Claude launch with approved permissions outside\n' +
  'that sandbox, keeping Clooks enabled.'

let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())

const environments: Record<string, string>[] = [
  {},
  { CLOOKS_AGENT: 'claude-code' },
  { CLOOKS_AGENT: 'codex' },
]

function expectedStderr(env: Record<string, string>): string {
  return env.CLOOKS_AGENT === 'codex'
    ? `clooks: Codex unidentified event hook "runtime" capability "stdin": ${EMPTY_STDIN_DIAGNOSTIC} Unidentified event; local failure only, with no native prevention guarantee.\n`
    : `${EMPTY_STDIN_DIAGNOSTIC}\n`
}

describe('compiled empty stdin diagnostic', () => {
  for (const env of environments) {
    const label = env.CLOOKS_AGENT ?? 'default Claude'
    test(`${label}: positive handler control then rejected inputs and launcher forwarding`, () => {
      sandbox = createSandbox()
      expect(sandbox.run(['init', '--agent', env.CLOOKS_AGENT ?? 'claude-code']).exitCode).toBe(0)
      sandbox.writeConfig('version: "1.0.0"\nsentinel: {}\n')
      sandbox.writeHook(
        'sentinel.ts',
        `
import { appendFileSync } from 'fs'
appendFileSync(${JSON.stringify(join(sandbox.dir, 'import-marker'))}, 'import\\n')
export const hook = {
  meta: { name: 'sentinel' },
  PreToolUse() {
    appendFileSync(${JSON.stringify(join(sandbox.dir, 'handler-marker'))}, 'handler\\n')
    return { result: 'allow' }
  },
}
`,
      )
      const stdin = JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'empty-stdin-control',
        turn_id: 'turn',
        cwd: sandbox.dir,
        model: 'model',
        permission_mode: 'default',
        transcript_path: null,
        tool_name: 'Bash',
        tool_use_id: 'call',
        tool_input: { command: 'true' },
      })
      for (const run of [
        (input: string) => sandbox.run([], { stdin: input, env, timeout: 10000 }),
        (input: string) => sandbox.runEntrypoint({ stdin: input, env }),
      ]) {
        const valid = run(stdin)
        expect(valid.rawExitCode).toBe(0)
        expect(valid.signalCode).toBeNull()
        expect(valid.stderr).toBe('')
        if (env.CLOOKS_AGENT === 'codex') expect(valid.stdout).toBe('')
        else expect(JSON.parse(valid.stdout).hookSpecificOutput.permissionDecision).toBe('allow')
        expect(sandbox.readFile('handler-marker')).toBe('handler\n')
        expect(sandbox.readFile('import-marker')).toBe('import\n')
        for (const input of ['', ' \t\r\n', '{broken']) {
          rmSync(join(sandbox.dir, 'handler-marker'), { force: true })
          rmSync(join(sandbox.dir, 'import-marker'), { force: true })
          const rejected = run(input)
          expect(rejected.rawExitCode).toBe(2)
          expect(rejected.signalCode).toBeNull()
          expect(rejected.stdout).toBe('')
          if (input === '{broken') {
            expect(rejected.stderr).toContain('failed to parse stdin JSON')
            expect(rejected.stderr).not.toContain('received empty stdin')
          } else expect(rejected.stderr).toBe(expectedStderr(env))
          expect(sandbox.fileExists('handler-marker')).toBe(false)
          expect(sandbox.fileExists('import-marker')).toBe(env.CLOOKS_AGENT !== 'codex')
        }
        rmSync(join(sandbox.dir, 'import-marker'), { force: true })
      }
    })

    test(`${label}: semantic input failures remain distinct from empty input`, () => {
      sandbox = createSandbox()
      sandbox.writeConfig('version: "1.0.0"\n')
      for (const stdin of [
        'null',
        '[]',
        '42',
        'true',
        '"text"',
        '{}',
        '{"hook_event_name":"Unknown"}',
      ]) {
        const result = sandbox.run([], { stdin, env, timeout: 10000 })
        expect(result.rawExitCode).toBe(2)
        expect(result.signalCode).toBeNull()
        expect(result.stdout).toBe('')
        expect(result.stderr).not.toContain('received empty stdin')
        expect(result.stderr).toContain(
          stdin.startsWith('{')
            ? 'stdin payload missing or unrecognized hook_event_name field'
            : 'stdin payload is not a JSON object',
        )
      }
    })

    test(`${label}: no-config bypass and configured zero-hook refusal`, () => {
      sandbox = createSandbox()
      for (const stdin of ['', ' \t\r\n', '{broken']) {
        const result = sandbox.run([], { stdin, env, timeout: 10000 })
        expect(result.rawExitCode).toBe(0)
        expect(result.signalCode).toBeNull()
        expect(result.stdout).toBe('')
        expect(result.stderr).toBe('')
      }
      sandbox.writeConfig('version: "1.0.0"\n')
      const result = sandbox.run([], { stdin: '', env, timeout: 10000 })
      expect(result.rawExitCode).toBe(2)
      expect(result.signalCode).toBeNull()
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(expectedStderr(env))
    })
  }
})
