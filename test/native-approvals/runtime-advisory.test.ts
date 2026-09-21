import { afterEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENTRYPOINT_SCRIPT } from '../../src/commands/init-entrypoint'
import { renderRuntimeAdvisoryScript } from '../../src/commands/init-advisory'
import {
  entryProbeScript,
  oldRuntimeScript,
  runtimeAdvisoryCases,
  runtimeBehaviors,
  selectSessionStartGroups,
  sessionStartGroups,
  type CommandGroup,
  type RuntimeAdvisoryCase,
} from './runtime-advisory'
import {
  assertReverseAdvisoryObservation,
  assertRuntimeAdvisoryMatrix,
  assertRuntimeAdvisoryObservation,
  completionToken,
  fixturePrompt,
  observeRuntimeAdvisory,
  promptRequests,
  type ReverseAdvisoryObservation,
  type RuntimeAdvisoryNativeResult,
} from './runtime-advisory-native'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const temporary = () => {
  const root = mkdtempSync(join(tmpdir(), "native-advisory-'quoted-"))
  roots.push(root)
  return root
}

const cases = runtimeAdvisoryCases()
const messageCase = cases.find(
  (c) => c.agent === 'codex' && c.advisory === 'message' && c.runtime === 'success-output',
)!

function good(c: RuntimeAdvisoryCase): RuntimeAdvisoryNativeResult {
  const skip = c.advisory === 'skip'
  const stop = c.agent === 'codex' && c.runtime === 'continue-false' && !skip
  const visible =
    !skip &&
    (c.runtime === 'success-output' || (c.agent === 'claude' && c.runtime === 'fail-output'))
  return {
    ...c,
    id: JSON.stringify(c),
    passed: true,
    nativeExit: 0,
    requestCount: stop ? 0 : 2,
    promptRequestCount: stop ? 0 : 1,
    completionSeen: !stop,
    terminalStop: stop,
    terminalStderr:
      !skip && c.agent === 'claude' && ['fail-output', 'stderr-only'].includes(c.runtime),
    terminalRuntime: visible,
    modelRuntime: visible,
    terminalAdvisory: c.advisory === 'message',
    terminalAdvisoryComplete: c.advisory === 'message',
    modelAdvisory: c.advisory === 'message' && !stop,
    modelAdvisoryComplete: c.advisory === 'message' && !stop,
    entries: [
      ...(skip && c.agent === 'codex' ? [] : ['runtime:' + (c.mixed ? 'global' : c.scope)]),
      ...(c.advisory === 'absent' ? [] : ['advisory:' + c.scope]),
    ],
    binaryInvocations: skip ? [] : ['runtime', ...(c.advisory === 'message' ? ['probe:eof'] : [])],
    runtimeInput: skip
      ? undefined
      : { hook_event_name: 'SessionStart', session_id: 'native-session' },
  }
}

describe('permanent native advisory behavioral oracles', () => {
  test('matrix has ten controls per agent plus opposite-order global, mixed and exact skip cases', () => {
    expect(cases).toHaveLength(26)
    for (const agent of ['claude', 'codex']) {
      for (const runtime of runtimeBehaviors)
        expect(
          cases
            .filter(
              (c) =>
                c.agent === agent &&
                c.runtime === runtime &&
                c.scope === 'project' &&
                !c.mixed &&
                c.advisory !== 'skip',
            )
            .map((c) => c.advisory),
        ).toEqual(['absent', 'message'])
      expect(cases.filter((c) => c.agent === agent && c.scope === 'global')).toMatchObject([
        { order: 'advisory-first' },
      ])
      expect(cases.filter((c) => c.agent === agent && c.mixed)).toHaveLength(1)
      expect(cases.filter((c) => c.agent === agent && c.advisory === 'skip')).toHaveLength(1)
    }
    expect(() => assertRuntimeAdvisoryMatrix(cases.map(good))).not.toThrow()
  })

  test('matrix rejects incomplete, duplicate, failed and changed paired results', () => {
    const rows = cases.map(good)
    expect(() => assertRuntimeAdvisoryMatrix(rows.slice(1))).toThrow()
    expect(() => assertRuntimeAdvisoryMatrix([rows[0]!, ...rows.slice(0, -1)])).toThrow()
    expect(() =>
      assertRuntimeAdvisoryMatrix(rows.map((r, i) => (i === 1 ? { ...r, passed: false } : r))),
    ).toThrow()
    expect(() =>
      assertRuntimeAdvisoryMatrix(
        rows.map((r, i) => (i === 1 ? { ...r, terminalRuntime: false } : r)),
      ),
    ).toThrow()
  })

  test.each([
    { nativeExit: 70 },
    { promptRequestCount: 0 },
    { completionSeen: false },
    { terminalStop: true },
    { terminalStderr: true },
    { terminalRuntime: false },
    { modelRuntime: false },
    { terminalAdvisory: false },
    { terminalAdvisoryComplete: false },
    { modelAdvisory: false },
    { modelAdvisoryComplete: false },
    { entries: ['runtime:project'] },
    { entries: ['runtime:project', 'advisory:project', 'advisory:project'] },
    { binaryInvocations: ['runtime', 'probe:input'] },
    { binaryInvocations: ['runtime', 'probe:eof', 'probe:eof'] },
    { binaryInvocations: ['runtime', 'probe:eof', 'unexpected:mcp'] },
    { runtimeInput: { hook_event_name: 'PreToolUse', session_id: 'session' } },
  ])('rejects corrupt native evidence %p', (mutation) => {
    expect(() =>
      assertRuntimeAdvisoryObservation(messageCase, { ...good(messageCase), ...mutation }),
    ).toThrow()
  })

  test('Codex continue:false requires zero model requests but still requires advisory UI', () => {
    const c = cases.find(
      (c) => c.agent === 'codex' && c.runtime === 'continue-false' && c.advisory === 'message',
    )!
    const result = good(c)
    expect(() => assertRuntimeAdvisoryObservation(c, result)).not.toThrow()
    for (const mutation of [
      { requestCount: 1 },
      { modelAdvisory: true },
      { terminalAdvisory: false },
      { terminalStop: false },
    ])
      expect(() => assertRuntimeAdvisoryObservation(c, { ...result, ...mutation })).toThrow()
  })

  test('Claude production skip enters both scripts once and makes no binary calls', () => {
    const c = cases.find((c) => c.advisory === 'skip')!
    const result = good(c)
    expect(() => assertRuntimeAdvisoryObservation(c, result)).not.toThrow()
    for (const mutation of [
      { binaryInvocations: ['runtime'] },
      { binaryInvocations: ['probe:eof'] },
      { terminalRuntime: true },
      { terminalAdvisory: true },
      { entries: [] },
    ])
      expect(() => assertRuntimeAdvisoryObservation(c, { ...result, ...mutation })).toThrow()
  })

  test('Codex production skip returns in the locator before runtime script entry', () => {
    const c = cases.find((c) => c.agent === 'codex' && c.advisory === 'skip')!
    const result = good(c)
    expect(result.entries).toEqual(['advisory:project'])
    expect(() => assertRuntimeAdvisoryObservation(c, result)).not.toThrow()
    expect(() =>
      assertRuntimeAdvisoryObservation(c, {
        ...result,
        entries: ['runtime:project', 'advisory:project'],
      }),
    ).toThrow()
    expect(() =>
      assertRuntimeAdvisoryObservation(c, { ...result, binaryInvocations: ['runtime'] }),
    ).toThrow()
    expect(() =>
      assertRuntimeAdvisoryObservation(c, { ...result, binaryInvocations: ['probe:eof'] }),
    ).toThrow()
  })

  test('non-debug terminal and model evidence are independent and title requests do not count', () => {
    const ui =
      'This project requires Clooks 0.3.0 or newer; installed: 0.0.1. Run $clooks:setup update, or update Clooks using its original installation method.'
    const context = ui + ' Tell the user; do not update automatically.'
    const request = {
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: fixturePrompt },
            { type: 'input_text', text: 'OLD_RUNTIME_CONTEXT' },
            { type: 'input_text', text: context },
          ],
        },
      ],
    }
    const title = {
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'Generate a concise, single-line task title of at most 36 characters.\n\nUser prompt:\n' +
                fixturePrompt,
            },
          ],
        },
      ],
      text: {
        format: { type: 'json_schema', schema: { properties: { title: { type: 'string' } } } },
      },
    }
    const transcript = '\u001b[32m' + ui + '\u001b[0m\nOLD_RUNTIME_VISIBLE\n' + completionToken
    const result = observeRuntimeAdvisory(
      messageCase,
      '0.3.0',
      transcript,
      [request, title],
      good(messageCase),
    )
    expect(() => assertRuntimeAdvisoryObservation(messageCase, result)).not.toThrow()
    expect(promptRequests([title])).toEqual([])
    expect(promptRequests([{ messages: request.input }])).toHaveLength(1)
    expect(
      promptRequests([
        {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: '<session>\n' + fixturePrompt + '\n</session>' }],
            },
          ],
        },
      ]),
    ).toEqual([])
    expect(promptRequests([request, request])).toHaveLength(2)
    const modelOnly = observeRuntimeAdvisory(
      messageCase,
      '0.3.0',
      completionToken,
      [request],
      good(messageCase),
    )
    expect(modelOnly.terminalAdvisory).toBe(false)
    expect(modelOnly.modelAdvisory).toBe(true)
    expect(() => assertRuntimeAdvisoryObservation(messageCase, modelOnly)).toThrow()
    const uiOnly = observeRuntimeAdvisory(
      messageCase,
      '0.3.0',
      transcript,
      [{ input: [{ role: 'user', content: fixturePrompt }] }],
      good(messageCase),
    )
    expect(uiOnly.modelAdvisory).toBe(false)
    expect(() => assertRuntimeAdvisoryObservation(messageCase, uiOnly)).toThrow()
  })

  test('selects exact generated groups without unrelated registrations or command rewriting', () => {
    const runtime: CommandGroup = {
      matcher: '*',
      hooks: [{ type: 'command', command: 'bash "/owned/entrypoint.sh"', timeout: 42 }],
    }
    const advisory: CommandGroup = {
      hooks: [{ type: 'command', command: 'bash "/owned/runtime-advisory.sh"' }],
    }
    const document = {
      hooks: { SessionStart: [runtime, advisory], PreToolUse: [{ hooks: [{ type: 'mcp_tool' }] }] },
    }
    const groups = sessionStartGroups(document)
    expect(groups.runtime).toBe(runtime)
    expect(groups.advisory).toBe(advisory)
    expect(
      selectSessionStartGroups(
        groups,
        { ...messageCase, scope: 'global', order: 'advisory-first' },
        'global',
      ),
    ).toEqual([advisory, runtime])
    expect(
      selectSessionStartGroups(groups, { ...messageCase, advisory: 'absent' }, 'project'),
    ).toEqual([runtime])
    expect(selectSessionStartGroups(groups, { ...messageCase, mixed: true }, 'project')).toEqual([
      advisory,
    ])
    expect(selectSessionStartGroups(groups, { ...messageCase, mixed: true }, 'global')).toEqual([
      runtime,
    ])
    expect(document.hooks.SessionStart).toEqual([runtime, advisory])
    for (const bad of [
      [],
      [runtime],
      [runtime, runtime],
      [runtime, advisory, advisory],
      [{ hooks: [...runtime.hooks, ...advisory.hooks] }, advisory],
    ])
      expect(() => sessionStartGroups({ hooks: { SessionStart: bad } })).toThrow()
  })

  test('reverse reminder requires UI and preserved hook output, never reminder model context', () => {
    const result: ReverseAdvisoryObservation = {
      nativeExit: 0,
      promptRequestCount: 1,
      completionSeen: true,
      terminalReminder: true,
      terminalSetup: true,
      terminalManual: true,
      terminalForwardAdvisory: false,
      modelHookContext: true,
      modelReminder: false,
      entries: ['runtime:project', 'advisory:project'],
      hookInvocations: ['SessionStart'],
    }
    expect(() => assertReverseAdvisoryObservation(result)).not.toThrow()
    expect(() => assertReverseAdvisoryObservation({ ...result, modelReminder: true })).not.toThrow()
    for (const mutation of [
      { terminalReminder: false },
      { terminalSetup: false },
      { terminalManual: false },
      { terminalForwardAdvisory: true },
      { modelHookContext: false },
      { hookInvocations: [] },
      { hookInvocations: ['SessionStart', 'SessionStart'] },
    ])
      expect(() => assertReverseAdvisoryObservation({ ...result, ...mutation })).toThrow()
  })
})

describe('controlled old binary and generated-script execution probes', () => {
  test.each([...runtimeBehaviors])(
    '%s preserves generated launcher semantics with detached advisory probe',
    (behavior) => {
      const root = temporary()
      const bin = join(root, 'bin'),
        scripts = join(root, '.clooks/bin')
      mkdirSync(bin)
      mkdirSync(scripts, { recursive: true })
      writeFileSync(join(bin, 'clooks'), oldRuntimeScript(root, behavior))
      chmodSync(join(bin, 'clooks'), 0o755)
      writeFileSync(join(scripts, 'entrypoint.sh'), ENTRYPOINT_SCRIPT)
      writeFileSync(join(scripts, 'runtime-advisory.sh'), renderRuntimeAdvisoryScript('project'))
      writeFileSync(join(root, 'probe.sh'), entryProbeScript(root, [{ scope: 'project', root }]))
      const env = { HOME: root, PATH: bin + ':/usr/bin:/bin', BASH_ENV: join(root, 'probe.sh') }
      const payload = { hook_event_name: 'SessionStart', session_id: 'fixture', cwd: root }
      const invoke = (name: string, extra = {}) =>
        Bun.spawnSync(['/bin/bash', join(scripts, name)], {
          env: { ...env, ...extra },
          stdin: Buffer.from(JSON.stringify(payload)),
          timeout: 3000,
        })
      const runtime = invoke('entrypoint.sh')
      const advisory = invoke('runtime-advisory.sh')
      expect(runtime.exitCode).toBe(['fail-output', 'stderr-only'].includes(behavior) ? 2 : 0)
      expect(runtime.stderr.toString()).toBe(
        ['fail-output', 'stderr-only'].includes(behavior) ? 'OLD_RUNTIME_STDERR\n' : '',
      )
      if (behavior === 'success-empty' || behavior === 'stderr-only')
        expect(runtime.stdout.toString()).toBe('')
      else if (behavior === 'continue-false')
        expect(JSON.parse(runtime.stdout.toString())).toEqual({
          continue: false,
          stopReason: 'OLD_RUNTIME_STOP',
        })
      else
        expect(JSON.parse(runtime.stdout.toString())).toEqual({
          systemMessage: 'OLD_RUNTIME_VISIBLE',
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: 'OLD_RUNTIME_CONTEXT',
          },
        })
      expect(advisory.exitCode).toBe(0)
      expect(advisory.stderr.toString()).toBe('')
      expect(JSON.parse(advisory.stdout.toString()).systemMessage).toContain('installed: 0.0.1')
      expect(JSON.parse(readFileSync(join(root, 'runtime-input.json'), 'utf8'))).toEqual(payload)
      expect(readFileSync(join(root, 'entry-invocations.log'), 'utf8')).toBe(
        'runtime:project\nadvisory:project\n',
      )
      expect(readFileSync(join(root, 'binary-invocations.log'), 'utf8')).toBe(
        'runtime\nprobe:eof\n',
      )
      rmSync(join(root, 'binary-invocations.log'))
      rmSync(join(root, 'runtime-input.json'))
      rmSync(join(root, 'entry-invocations.log'))
      for (const name of ['entrypoint.sh', 'runtime-advisory.sh']) {
        const skipped = invoke(name, { SKIP_CLOOKS: 'true' })
        expect(skipped.exitCode).toBe(0)
        expect(skipped.stdout.toString()).toBe('')
        expect(skipped.stderr.toString()).toBe('')
      }
      expect(readFileSync(join(root, 'entry-invocations.log'), 'utf8')).toBe(
        'runtime:project\nadvisory:project\n',
      )
      expect(existsSync(join(root, 'binary-invocations.log'))).toBe(false)
      expect(existsSync(join(root, 'runtime-input.json'))).toBe(false)
    },
  )

  test('old binary refuses MCP or other unexpected invocations', () => {
    const root = temporary(),
      script = join(root, 'clooks')
    writeFileSync(script, oldRuntimeScript(root, 'success-output'))
    const result = Bun.spawnSync(['/bin/bash', script, 'mcp'], {
      env: { HOME: root },
      timeout: 1000,
    })
    expect(result.exitCode).toBe(71)
    expect(result.stdout.toString()).toBe('')
    expect(readFileSync(join(root, 'binary-invocations.log'), 'utf8')).toBe('unexpected:mcp\n')
  })
})
