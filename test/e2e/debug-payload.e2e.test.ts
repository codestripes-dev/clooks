import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSandbox, formatDiagnostics, type Sandbox } from './helpers/sandbox'

// Existing GitHub-response fixture is an exact marketplace hook snapshot, not a
// reimplementation. Wire inputs below are synthetic; no native agent is launched.
const fixture = join(
  import.meta.dir,
  '../fixtures/github-raw/codestripes-dev/clooks-example-hooks/HEAD/hooks/debug-payload',
)
const source = readFileSync(`${fixture}.ts`, 'utf8')
const provenance = JSON.parse(readFileSync(`${fixture}.provenance.json`, 'utf8')) as {
  sha256: string
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())

function install() {
  sandbox = createSandbox()
  expect(digest(source)).toBe(provenance.sha256)
  sandbox.writeHook('debug-payload.ts', source)
  expect(sandbox.readFile('.clooks/hooks/debug-payload.ts')).toBe(source)
  sandbox.writeConfig('version: "1.0.0"\ndebug-payload: {}\n')
}

describe('actual debug-payload compiled contract', () => {
  for (const provider of ['claude-code', 'codex'] as const) {
    test.each([undefined, 'false', 'true'])(
      `${provider} gate=%s: normalized context and observational output`,
      (debug) => {
        install()
        for (const event of ['PreToolUse', 'PostCompact', 'SessionEnd', 'SessionStart']) {
          const logDir = join(sandbox.dir, 'logs', event)
          const common = {
            hook_event_name: event,
            session_id: `debug-${provider}-${event}`,
            cwd: sandbox.dir,
            transcript_path: null,
          }
          const fields =
            event === 'SessionEnd'
              ? { reason: 'other' }
              : {
                  model: 'fixture',
                  permission_mode: 'default',
                  turn_id: 'fixture-turn',
                  tool_use_id: 'fixture-call',
                  tool_name: provider === 'codex' ? 'exec_command' : 'Bash',
                  tool_input: { command: 'echo synthetic-secret' },
                  source: 'startup',
                  trigger: 'auto',
                  compact_summary: 'synthetic summary',
                }
          const result = sandbox.run([], {
            stdin: JSON.stringify({ ...common, ...fields }),
            env: {
              CLOOKS_AGENT: provider,
              CODEX_HOME: join(sandbox.home, '.codex'),
              CLOOKS_LOGDIR: logDir,
              ...(debug === undefined ? {} : { CLOOKS_DEBUG: debug }),
            },
            timeout: 10_000,
          })
          expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
          expect(result.signalCode).toBeNull()
          const logFile = join(logDir, 'debug-events.log')
          if (debug !== 'true') {
            expect(result.stdout).toBe('')
            expect(result.stderr).toBe('')
            expect(existsSync(logFile)).toBe(false)
            continue
          }
          expect(existsSync(logFile), formatDiagnostics(result)).toBe(true)
          const line = readFileSync(logFile, 'utf8')
          const normalized = JSON.parse(line.slice(line.indexOf('{')))
          expect(normalized).toMatchObject({
            event,
            provider,
            sessionId: common.session_id,
            cwd: sandbox.dir,
          })
          expect(normalized.hook_event_name).toBeUndefined()
          expect(normalized.session_id).toBeUndefined()
          expect(normalized.signal).toBeUndefined()
          expect(normalized.skip).toBeUndefined()
          if (event === 'SessionStart') {
            const output = JSON.parse(result.stdout)
            expect(output.hookSpecificOutput.additionalContext).toContain(
              JSON.stringify(normalized, null, 2),
            )
            expect(output.hookSpecificOutput.permissionDecision).toBeUndefined()
          } else {
            // No allow vote, context injection or closure/compaction control.
            expect(result.stdout, formatDiagnostics(result)).toBe('')
            expect(result.stderr).toContain(`debug-payload [${event}]`)
          }
          if (event === 'PreToolUse') {
            expect(normalized.toolName).toBe('Bash')
            expect(normalized.toolInput.command).toBe('echo synthetic-secret')
          }
          if (event === 'SessionEnd' && provider === 'codex') {
            expect(normalized.reason).toBe('other')
            expect(normalized.model).toBeUndefined()
            expect(normalized.permissionMode).toBeUndefined()
          }
        }
      },
    )

    test(`${provider}: failed debug-file write remains observational`, () => {
      install()
      sandbox.writeFile('occupied', 'unchanged')
      const result = sandbox.run([], {
        stdin: JSON.stringify({
          hook_event_name: 'PreToolUse',
          session_id: 'debug-write-failure',
          cwd: sandbox.dir,
          transcript_path: null,
          model: 'fixture',
          permission_mode: 'default',
          turn_id: 'fixture-turn',
          tool_use_id: 'fixture-call',
          tool_name: provider === 'codex' ? 'exec_command' : 'Bash',
          tool_input: { command: 'echo inert' },
        }),
        env: {
          CLOOKS_AGENT: provider,
          CODEX_HOME: join(sandbox.home, '.codex'),
          CLOOKS_DEBUG: 'true',
          CLOOKS_LOGDIR: join(sandbox.dir, 'occupied'),
        },
      })
      expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
      expect(result.signalCode).toBeNull()
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('debug-payload [PreToolUse]')
      expect(sandbox.readFile('occupied')).toBe('unchanged')
    })
  }
})
