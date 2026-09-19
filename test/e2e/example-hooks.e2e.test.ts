import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSandbox, formatDiagnostics, type Sandbox } from './helpers/sandbox'

const fixtures = join(
  import.meta.dir,
  '../fixtures/github-raw/codestripes-dev/clooks-example-hooks/HEAD/hooks',
)
const provenance = JSON.parse(
  readFileSync(join(fixtures, 'example-hooks.provenance.json'), 'utf8'),
) as { sha256: Record<'lifecycle-example' | 'kitchen-sink', string> }
let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())

function install(name: 'lifecycle-example' | 'kitchen-sink') {
  sandbox = createSandbox()
  const source = readFileSync(join(fixtures, `${name}.ts`), 'utf8')
  expect(createHash('sha256').update(source).digest('hex')).toBe(provenance.sha256[name])
  sandbox.writeHook(`${name}.ts`, source)
  expect(sandbox.readFile(`.clooks/hooks/${name}.ts`)).toBe(source)
  sandbox.writeConfig(`version: "1.0.0"\n${name}: {}\n`)
}

// Synthetic wire input through compiled Clooks and exact example source, not a native agent.
function invoke(agent: 'claude-code' | 'codex', event: string, fields = {}, debug = true) {
  const result = sandbox.run([], {
    stdin: JSON.stringify({
      hook_event_name: event,
      session_id: `example-${agent}-${event}`,
      cwd: sandbox.dir,
      transcript_path: null,
      ...(event === 'SessionEnd'
        ? { reason: 'other' }
        : {
            model: 'fixture',
            permission_mode: 'default',
            turn_id: 'turn-fixture',
            tool_use_id: 'call-fixture',
          }),
      ...fields,
    }),
    env: {
      CLOOKS_AGENT: agent,
      CODEX_HOME: join(sandbox.home, '.codex'),
      CLOOKS_DEBUG: String(debug),
    },
    timeout: 10_000,
  })
  expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
  expect(result.signalCode).toBeNull()
  return result
}

describe('corrected lifecycle and kitchen examples', () => {
  for (const agent of ['claude-code', 'codex'] as const) {
    test(`${agent}: lifecycle keeps protocol stdout clean, actual branch denial and intentional allow`, () => {
      install('lifecycle-example')
      const git = (...args: string[]) => {
        const result = Bun.spawnSync(['git', ...args], {
          cwd: sandbox.dir,
          env: { HOME: sandbox.home, PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1' },
        })
        expect(result.exitCode, result.stderr.toString()).toBe(0)
      }
      git('init', '-b', 'staging')
      git(
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '--allow-empty',
        '-m',
        'fixture',
      )
      const fields = {
        tool_name: agent === 'codex' ? 'exec_command' : 'Bash',
        tool_input: { command: 'echo inert' },
      }
      for (const debug of [false, true]) {
        sandbox.writeConfig(
          'version: "1.0.0"\nlifecycle-example:\n  config:\n    protectedBranches: [staging]\n',
        )
        const blocked = invoke(agent, 'PreToolUse', fields, debug)
        const output = JSON.parse(blocked.stdout)
        expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
        expect(output.hookSpecificOutput.permissionDecisionReason).toContain('staging branch')
        expect(output.hookSpecificOutput.permissionDecisionReason).not.toContain('production')

        sandbox.writeConfig(
          'version: "1.0.0"\nlifecycle-example:\n  config:\n    protectedBranches: [production]\n',
        )
        const allowed = invoke(agent, 'PreToolUse', fields, debug)
        if (agent === 'claude-code') {
          expect(JSON.parse(allowed.stdout).hookSpecificOutput.permissionDecision).toBe('allow')
        } else expect(allowed.stdout).toBe('')
        if (debug)
          expect(allowed.stderr).toMatch(/\[lifecycle-example\] PreToolUse handler took \d+\.\dms/)
        else expect(allowed.stderr).toBe('')
      }
    })

    test(`${agent}: kitchen PreToolUse and compact/end remain debug-only`, () => {
      install('kitchen-sink')
      for (const [event, fields, marker] of [
        [
          'PreToolUse',
          {
            tool_name: agent === 'codex' ? 'exec_command' : 'Bash',
            tool_input: { command: 'echo inert-marker' },
          },
          'inert-marker',
        ],
        ['PostCompact', { trigger: 'auto', compact_summary: 'compact-marker' }, 'compact-marker'],
        ['SessionEnd', {}, 'other'],
      ] as const) {
        for (const debug of [false, true]) {
          const result = invoke(agent, event, fields, debug)
          if (debug && agent === 'claude-code' && event === 'PreToolUse') {
            const output = JSON.parse(result.stdout)
            expect(output).toEqual({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                additionalContext: result.stderr.trimEnd(),
              },
            })
            expect(output.hookSpecificOutput.permissionDecision).toBeUndefined()
          } else expect(result.stdout).toBe('')
          if (debug) {
            expect(result.stderr).toContain(`[kitchen-sink] ${event}`)
            expect(result.stderr).toContain(marker)
          } else expect(result.stderr).toBe('')
        }
      }
    })
  }

  test.each([
    ['StopFailure', { error: 'rate_limit', error_details: 'error-marker' }, 'error-marker'],
    [
      'PermissionDenied',
      { tool_name: 'Bash', tool_input: { command: 'echo inert' }, reason: 'denial-marker' },
      'denial-marker',
    ],
    [
      'TaskCreated',
      { task_id: 'task-1', task_subject: 'subject-marker', task_description: 'detail' },
      'subject-marker',
    ],
  ] as const)(
    'Claude kitchen %s exposes actual normalized fields without decisions',
    (event, fields, marker) => {
      install('kitchen-sink')
      const result = invoke('claude-code', event, fields)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain(`[kitchen-sink] ${event}`)
      expect(result.stderr).toContain(marker)
    },
  )

  test('Claude kitchen does not fabricate WorktreeCreate success', () => {
    install('kitchen-sink')
    sandbox.writeFile('sentinel', 'unchanged')
    const result = invoke('claude-code', 'WorktreeCreate', { name: 'new-worktree' })
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain('[kitchen-sink] WorktreeCreate')
    expect(sandbox.fileExists('new-worktree')).toBe(false)
    expect(sandbox.readFile('sentinel')).toBe('unchanged')
  })
})
