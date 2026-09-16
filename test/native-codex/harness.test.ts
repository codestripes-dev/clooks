import { afterAll, afterEach, expect, test } from 'bun:test'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { sse, startFixture } from './fixture-server'
import { nativeFeedback } from './native-feedback'
import {
  assertPackObservation,
  packCallId,
  packCommand,
  readToken,
  type PackObservation,
} from './pack-scenarios'
import {
  assertRewritePolicyObservation,
  patchControlCallId,
  patchOriginal,
  patchRewritten,
  rewriteCallId,
  shellOriginal,
  shellPolicyRule,
  shellRewritten,
  type RewritePolicyObservation,
} from './rewrite-policy-scenarios'
import {
  assertObservation,
  binaryPin,
  callId,
  commandA,
  commandB,
  denyReason,
  events,
  expectedUnitTests,
  exportSmokeBinary,
  mandatoryCases,
  readCaptures,
  requireSuccess,
  run,
  save,
  sha256,
  stopReason,
  tokens,
  verifyMetadata,
  type Observation,
  type PackCaseId,
} from './harness'

if (
  process.env.CLOOKS_E2E_DOCKER !== 'true' ||
  process.env.CLOOKS_NATIVE_MODE !== '--unit' ||
  !process.env.CLOOKS_NATIVE_LOGDIR
) {
  throw new Error('Use bash scripts/test-codex-native.sh --unit in disposable Docker')
}
const root = mkdtempSync('/tmp/clooks-native-units-')
let completed = 0
afterEach(() => {
  completed++
})
afterAll(() => {
  save(join(process.env.CLOOKS_NATIVE_LOGDIR!, 'completed.json'), {
    mode: '--unit',
    completed,
    evidence: 'harness units only',
  })
  rmSync(root, { recursive: true, force: true })
})
function directory() {
  return mkdtempSync(join(root, 'case-'))
}

function packObservation(id: PackCaseId): PackObservation {
  const shell = id === 'PACK-SHELL-READ',
    denied = id === 'PACK-PATCH-DENY'
  const encode = (s: string) => Buffer.from(s).toString('base64')
  const before: PackObservation['before'] = shell
    ? { 'readable.txt': encode(readToken) }
    : denied
      ? { nested: 'directory', 'nested/bun.lock': encode('before\n') }
      : { 'editable.txt': encode('before\n') }
  const response = shell
    ? readToken
    : 'Success. Updated the following files:\nA owned/safe-companion.txt\nM owned/editable.txt'
  const output = denied
    ? `Command blocked by PreToolUse hook: [no-edit-protected] Blocked: owned/nested/bun.lock\nRule: lock-files\nThis is a lock file managed by your package manager.. Command: ${packCommand(id)}`
    : shell
      ? `Process exited with code 0\n${response}`
      : `Exit code: 0\n${response}`
  return {
    payloads: (denied ? ['PreToolUse'] : ['PreToolUse', 'PostToolUse']).map((event) => ({
      hook_event_name: event,
      tool_use_id: packCallId(id),
      session_id: 'pack-session',
      tool_name: shell ? 'Bash' : 'apply_patch',
      tool_input: { command: packCommand(id) },
      tool_response: response,
    })),
    requests: [
      {
        method: 'POST',
        path: '/v1/responses',
        headers: {},
        body: { tools: [{ type: 'custom', name: 'apply_patch' }], input: [] },
      },
      {
        method: 'POST',
        path: '/v1/responses',
        headers: {},
        body: {
          input: [
            {
              type: shell ? 'function_call_output' : 'custom_tool_call_output',
              call_id: packCallId(id),
              output,
            },
          ],
        },
      },
    ],
    state: {
      scopes: {
        main: {
          [shell ? 'prefer-builtin-tools' : 'no-edit-protected']: [
            { event: 'PreToolUse', decision: denied ? 'block' : 'skip' },
          ],
        },
      },
    },
    before,
    after:
      denied || shell
        ? { ...before }
        : {
            'editable.txt': encode('after\n'),
            'safe-companion.txt': encode('safe\n'),
          },
  }
}

test('actual pack oracles reject missing advertisement, receipts, IDs and wrong feedback after positive controls', () => {
  for (const id of ['PACK-SHELL-READ', 'PACK-PATCH-ALLOW', 'PACK-PATCH-DENY'] as const) {
    expect(() => assertPackObservation(id, packObservation(id))).not.toThrow()
    for (const mutate of [
      (o: PackObservation) => {
        o.requests[0]!.body.tools = []
      },
      (o: PackObservation) => {
        o.state.scopes.main = {}
      },
      (o: PackObservation) => {
        Object.values(o.state.scopes.main).forEach((rs: any) =>
          rs.push({ event: 'Stop', decision: 'error' }),
        )
      },
      (o: PackObservation) => {
        delete o.payloads[0].tool_use_id
      },
      (o: PackObservation) => {
        o.payloads[0].tool_input.command = 'wrong'
      },
      (o: PackObservation) => {
        o.requests[1]!.body.input[0].call_id = 'wrong'
      },
      (o: PackObservation) => {
        o.requests[1]!.body.input[0].type =
          id === 'PACK-SHELL-READ' ? 'custom_tool_call_output' : 'function_call_output'
      },
      (o: PackObservation) => {
        o.requests[1]!.body.input[0].output = 'Error: unavailable tool'
      },
      (o: PackObservation) => {
        o.requests[1]!.body.input.push({ ...o.requests[1]!.body.input[0] })
      },
      (o: PackObservation) => {
        o.after.extra = 'unexpected'
      },
    ]) {
      const observed = packObservation(id)
      mutate(observed)
      expect(() => assertPackObservation(id, observed)).toThrow()
    }
  }
})

test('pack effect controls reject partial patch application and false success', () => {
  for (const mutate of [
    (o: PackObservation) => {
      o.after['nested/bun.lock'] = Buffer.from('after\n').toString('base64')
    },
    (o: PackObservation) => {
      o.after['safe-companion.txt'] = Buffer.from('safe\n').toString('base64')
    },
    (o: PackObservation) => {
      o.payloads.push({ ...o.payloads[0], hook_event_name: 'PostToolUse' })
    },
  ]) {
    const o = packObservation('PACK-PATCH-DENY')
    mutate(o)
    expect(() => assertPackObservation('PACK-PATCH-DENY', o)).toThrow()
  }
  for (const id of ['PACK-SHELL-READ', 'PACK-PATCH-ALLOW'] as const) {
    const o = packObservation(id)
    o.payloads[1].tool_use_id = 'wrong'
    expect(() => assertPackObservation(id, o)).toThrow()
  }
  const o = packObservation('PACK-PATCH-ALLOW')
  o.after = { ...o.before }
  expect(() => assertPackObservation('PACK-PATCH-ALLOW', o)).toThrow()
})

test('binary export requires complete smoke hashes and exclusive writable destinations', () => {
  for (const failure of [
    'none',
    'unit',
    'missing',
    'hash',
    'partial',
    'unpublished',
    'copy',
    'metadata',
  ]) {
    const logs = directory(),
      binary = join(logs, 'candidate')
    writeFileSync(binary, 'test-owned executable bytes', { mode: 0o755 })
    const hash = sha256(binary)
    for (const id of mandatoryCases) {
      mkdirSync(join(logs, id))
      save(join(logs, id, 'passed.json'), {
        id,
        status: 'passed',
        clooksSha256: failure === 'hash' ? 'wrong' : hash,
      })
    }
    if (failure !== 'unpublished')
      save(join(logs, 'passed.json'), {
        passed: true,
        testExitCode: 0,
        mode: '--smoke',
        completed: mandatoryCases.length,
        cases: failure === 'partial' ? mandatoryCases.slice(1) : mandatoryCases,
      })
    if (failure === 'copy') mkdirSync(join(logs, 'clooks'))
    if (failure === 'metadata') mkdirSync(join(logs, 'binary.json'))
    const perform = () =>
      exportSmokeBinary(
        logs,
        failure === 'unit' ? '--unit' : '--smoke',
        failure === 'missing' ? join(logs, 'absent') : binary,
      )
    if (failure === 'none') {
      expect(perform).not.toThrow()
      expect(sha256(join(logs, 'clooks'))).toBe(hash)
      expect(JSON.parse(readFileSync(join(logs, 'binary.json'), 'utf8')).mode).toBe(0o755)
      expect(perform).toThrow()
    } else expect(perform).toThrow()
  }
})

test('container entrypoint preserves test, publication, export and seal failures; unit never exports', async () => {
  for (const failure of ['none', 'test', 'publish', 'export', 'seal', 'unit']) {
    const logs = directory(),
      out = join(logs, 'export'),
      bin = join(logs, 'bin')
    mkdirSync(out)
    mkdirSync(bin)
    const source = readFileSync('/app/test/native-codex/container-entrypoint.sh', 'utf8')
      .replaceAll('/export', out)
      .replace('test/docker-entrypoint.sh', join(logs, 'test.sh'))
    writeFileSync(join(logs, 'entry.sh'), source)
    writeFileSync(join(logs, 'test.sh'), '#!/bin/bash\n[[ "$FAILURE" != test ]] || exit 13\n')
    writeFileSync(join(bin, 'id'), '#!/bin/bash\nprintf "1000\\n"\n', {
      mode: 0o755,
    })
    writeFileSync(
      join(bin, 'find'),
      '#!/bin/bash\n[[ "$FAILURE" != seal ]] || exit 19\nexec /usr/bin/find "$@"\n',
      { mode: 0o755 },
    )
    writeFileSync(
      join(bin, 'bun'),
      `#!/bin/bash
if [[ "$1" == --version ]]; then printf 'unit-stub\\n'; exit 0; fi
if [[ "$2" == *publishPassed* ]]; then
  [[ "$FAILURE" != publish ]] || exit 17
  printf '{}' > "$CLOOKS_NATIVE_LOGDIR/passed.json"
else
  [[ "$FAILURE" != export ]] || exit 23
  printf 'exported' > "$CLOOKS_NATIVE_LOGDIR/clooks"
fi
`,
      { mode: 0o755 },
    )
    const result = await run(
      ['/bin/bash', join(logs, 'entry.sh'), '--inside'],
      logs,
      {
        PATH: `${bin}:/usr/bin:/bin`,
        CLOOKS_NATIVE_LOGDIR: out,
        CLOOKS_NATIVE_MODE: failure === 'unit' ? '--unit' : '--smoke',
        FAILURE: failure,
      },
      join(logs, 'entry'),
      3000,
    )
    expect(result.code).toBe(
      ({ test: 13, publish: 17, export: 23, seal: 74 } as Record<string, number>)[failure] ?? 0,
    )
    expect(existsSync(join(out, 'clooks'))).toBe(failure === 'none' || failure === 'seal')
    for (const path of readdirSync(out)) chmodSync(join(out, path), 0o700)
  }
}, 15000)

test('SSE is byte framed with three ordered Responses events', () => {
  const wire = sse('r1', { type: 'message', content: [] })
  expect(wire).toBe(
    'event: response.created\ndata: {"type":"response.created","response":{"id":"r1"}}\n\n' +
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"message","content":[]}}\n\n' +
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"r1","usage":{"input_tokens":0,"input_tokens_details":null,"output_tokens":0,"output_tokens_details":null,"total_tokens":0}}}\n\n',
  )
})

test('finite fixture queue captures raw requests and rejects exhaustion', async () => {
  const logs = directory()
  const server = startFixture([{ type: 'message', content: [] }], logs)
  const request = () =>
    fetch(`http://127.0.0.1:${server.port}/v1/responses`, {
      method: 'POST',
      body: '{"input":[]}',
    })
  try {
    expect(() => server.assertComplete()).toThrow('Fixture sequence')
    const response = await request()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toBe(readFileSync(join(logs, 'response-1.sse'), 'utf8'))
    expect(readFileSync(join(logs, 'request-1.body'), 'utf8')).toBe('{"input":[]}')
    expect(() => server.assertComplete()).not.toThrow()
    expect((await request()).status).toBe(409)
    expect(() => server.assertComplete()).toThrow('Script exhausted')
  } finally {
    await server.stop()
  }
})

test('unexpected routes, auth, malformed and encoded requests fail the sequence', async () => {
  for (const kind of ['route', 'auth', 'json', 'encoding']) {
    const server = startFixture([{}], directory())
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/${kind === 'route' ? 'unexpected' : 'v1/responses'}`,
        {
          method: 'POST',
          body: kind === 'json' ? 'invalid' : '{"input":[]}',
          headers:
            kind === 'auth'
              ? { authorization: 'synthetic-unit-only' }
              : kind === 'encoding'
                ? { 'content-encoding': 'gzip' }
                : {},
        },
      )
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(() => server.assertComplete()).toThrow('Fixture sequence')
    } finally {
      await server.stop()
    }
  }
})

test('binary metadata mismatch fails with a matching positive control and no binary dependency', () => {
  expect(() => verifyMetadata(binaryPin)).not.toThrow()
  expect(() => verifyMetadata('0'.repeat(64))).toThrow('SHA mismatch')
})

// Deliberately synthetic observations test the oracle; they never count as native evidence.
function baseline(): Observation {
  return {
    payloads: events.map((event) => ({
      hook_event_name: event,
      tool_use_id: callId,
      tool_input: { command: commandA },
      turn_id: 'unit-turn',
      prompt: 'Run the command once.',
    })),
    handlers: events.map((event) => ({
      event,
      toolName: 'Bash',
      toolInput: { command: commandA },
      priorInterventions: 0,
    })),
    requests: [
      [],
      [
        {
          type: 'function_call_output',
          call_id: callId,
          output: 'Process exited with code 0',
        },
      ],
    ].map((input) => ({
      method: 'POST',
      path: '/v1/responses',
      headers: {},
      body: { input },
    })),
    marker: 'native',
    rewrittenMarker: null,
  }
}

test('baseline oracle rejects missing marker, hook handler and call IDs after positive control', () => {
  expect(() => assertObservation('M1-BASE', baseline())).not.toThrow()
  for (const mutate of [
    (o: Observation) => {
      o.marker = null
    },
    (o: Observation) => {
      o.handlers = o.handlers.filter((h) => h.event !== 'PreToolUse')
    },
    (o: Observation) => {
      delete o.payloads.find((p) => p.hook_event_name === 'PreToolUse').tool_use_id
    },
    (o: Observation) => {
      delete o.payloads.find((p) => p.hook_event_name === 'PostToolUse').tool_use_id
    },
    (o: Observation) => {
      o.requests[1]!.body.input[0].call_id = 'wrong'
    },
  ]) {
    const observed = baseline()
    mutate(observed)
    expect(() => assertObservation('M1-BASE', observed)).toThrow()
  }
})

test('denial needs exact feedback, matching call ID and reached handler', () => {
  const denied = baseline()
  denied.marker = null
  denied.payloads = denied.payloads.filter((p) => p.hook_event_name !== 'PostToolUse')
  denied.handlers = denied.handlers.filter((h) => h.event !== 'PostToolUse')
  denied.requests[1]!.body.input[0].output = `Command blocked by PreToolUse hook: ${denyReason}. Command: ${commandA}`
  expect(() => assertObservation('M1-DENY', denied)).not.toThrow()
  for (const mutate of [
    (o: Observation) => {
      o.requests[1]!.body.input[0].output = denyReason
    },
    (o: Observation) => {
      delete o.requests[1]!.body.input[0].call_id
    },
    (o: Observation) => {
      o.payloads.find((p) => p.hook_event_name === 'PreToolUse').tool_use_id = 'wrong'
    },
    (o: Observation) => {
      o.handlers = []
    },
    (o: Observation) => {
      o.payloads.push({ hook_event_name: 'PostToolUse', tool_use_id: callId })
    },
  ]) {
    const observed = structuredClone(denied)
    mutate(observed)
    expect(() => assertObservation('M1-DENY', observed)).toThrow()
  }
})

test('rewrite oracle independently requires A/B effects, native result and normalized handler result', () => {
  const rewritten = baseline()
  rewritten.marker = null
  rewritten.rewrittenMarker = 'rewritten'
  const post = rewritten.payloads.find((p) => p.hook_event_name === 'PostToolUse')
  post.tool_input = { command: commandB }
  post.tool_response = 'rewritten-result'
  const handler = rewritten.handlers.find((h) => h.event === 'PostToolUse')
  handler.toolInput = { command: commandB }
  handler.toolResponse = 'rewritten-result'
  rewritten.requests[1]!.body.input[0].output =
    'Process exited with code 0\nOutput:\nrewritten-result'
  expect(() => assertObservation('M1-REWRITE', rewritten)).not.toThrow()
  for (const mutate of [
    (o: Observation) => {
      o.marker = 'native'
    },
    (o: Observation) => {
      o.rewrittenMarker = null
    },
    (o: Observation) => {
      o.payloads.find((p) => p.hook_event_name === 'PreToolUse').tool_input.command = commandB
    },
    (o: Observation) => {
      o.payloads.find((p) => p.hook_event_name === 'PostToolUse').tool_response = ''
    },
    (o: Observation) => {
      o.handlers.find((h) => h.event === 'PostToolUse').toolName = 'exec_command'
    },
    (o: Observation) => {
      o.handlers.find((h) => h.event === 'PostToolUse').toolInput.command = commandA
    },
    (o: Observation) => {
      delete o.handlers.find((h) => h.event === 'PostToolUse').toolResponse
    },
    (o: Observation) => {
      o.requests[1]!.body.input[0].output = 'Process exited with code 0'
    },
  ]) {
    const observed = structuredClone(rewritten)
    mutate(observed)
    expect(() => assertObservation('M1-REWRITE', observed)).toThrow()
  }
})

test('ask oracle requires attributed non-positive-confirmation decline without effects', () => {
  const asked = baseline()
  asked.marker = null
  asked.payloads = asked.payloads.filter((p) => p.hook_event_name !== 'PostToolUse')
  asked.handlers = asked.handlers.filter((h) => h.event !== 'PostToolUse')
  asked.requests[1]!.body.input[0].output =
    'Command blocked by PreToolUse hook: clooks: Codex PreToolUse hook "native-m1" ' +
    'capability "approval": clooks: Approval declined: Approval was not positively ' +
    `confirmed Pending call denial requested.. Command: ${commandA}`
  expect(() => assertObservation('M1-ASK', asked)).not.toThrow()
  for (const mutate of [
    (o: Observation) => {
      o.requests[1]!.body.input[0].output = `Command blocked by PreToolUse hook: MCP peer unavailable. Command: ${commandA}`
    },
    (o: Observation) => {
      o.requests[1]!.body.input[0].call_id = 'wrong'
    },
    (o: Observation) => {
      o.marker = 'native'
    },
    (o: Observation) => {
      o.payloads.push({ hook_event_name: 'PostToolUse', tool_use_id: callId })
    },
    (o: Observation) => {
      o.requests[1]!.body.input[0].output = o.requests[1]!.body.input[0].output.replace(
        'Approval was not positively confirmed',
        'MCP peer unavailable',
      )
    },
    (o: Observation) => {
      o.requests[1]!.body.input[0].output =
        `Command blocked by PreToolUse hook: Hook "native-m1": m1-ask-request\n` +
        `Ask the user and wait for explicit approval.. Command: ${commandA}`
    },
  ]) {
    const observed = structuredClone(asked)
    mutate(observed)
    expect(() => assertObservation('M1-ASK', observed)).toThrow()
  }
})

test('native feedback requires exact call attribution and output type', () => {
  const output = 'native tool output'
  for (const shell of [true, false]) {
    const request = {
      method: 'POST',
      path: '/v1/responses',
      headers: {},
      body: {
        input: [
          {
            type: shell ? 'function_call_output' : 'custom_tool_call_output',
            call_id: 'retry',
            output,
          },
        ],
      },
    }
    expect(nativeFeedback(request, 'retry', shell)).toBe(output)
    for (const replacement of [
      { ...request.body.input[0], call_id: undefined },
      { ...request.body.input[0], role: 'assistant' },
      { ...request.body.input[0], call_id: 'unrelated' },
      {
        ...request.body.input[0],
        type: shell ? 'custom_tool_call_output' : 'function_call_output',
      },
      {
        type: 'message',
        role: 'assistant',
        call_id: 'retry',
        content: [{ type: 'output_text', text: output }],
      },
      { type: 'function_call', call_id: 'retry', arguments: JSON.stringify({ output }) },
      { type: 'message', role: 'developer', metadata: { output }, content: [] },
    ]) {
      expect(() =>
        nativeFeedback({ ...request, body: { input: [replacement] } }, 'retry', shell),
      ).toThrow()
    }
    expect(() =>
      nativeFeedback(
        { ...request, body: { input: [...request.body.input, ...request.body.input] } },
        'retry',
        shell,
      ),
    ).toThrow()
  }
})

function rewritePolicyObservation(shell: boolean): RewritePolicyObservation {
  const toolName = shell ? 'Bash' : 'apply_patch'
  const outputType = shell ? 'function_call_output' : 'custom_tool_call_output'
  const targetOutput = shell
    ? 'policy forbids commands starting with `touch owned/rewritten`'
    : 'patch rejected: writing is blocked by read-only sandbox; rejected by user approval settings'
  const targetPre = {
    hook_event_name: 'PreToolUse',
    tool_use_id: rewriteCallId,
    session_id: 'rewrite-session',
    tool_name: toolName,
    tool_input: { command: shell ? shellOriginal : patchOriginal },
  }
  const targetHandler = {
    callId: rewriteCallId,
    toolName,
    original: shell ? shellOriginal : patchOriginal,
    decision: 'allow-rewrite',
    updated: shell ? shellRewritten : patchRewritten,
  }
  if (shell)
    return {
      payloads: [targetPre],
      handlers: [targetHandler],
      requests: [
        { method: 'POST', path: '/v1/responses', headers: {}, body: { input: [] } },
        {
          method: 'POST',
          path: '/v1/responses',
          headers: {},
          body: {
            input: [{ type: outputType, call_id: rewriteCallId, output: targetOutput }],
          },
        },
      ],
      before: {},
      after: {},
      sandbox: 'danger-full-access',
      policyRule: shellPolicyRule,
    }
  return {
    payloads: [
      {
        ...targetPre,
        tool_use_id: patchControlCallId,
        tool_input: { command: patchOriginal.trimEnd() },
      },
      targetPre,
    ],
    handlers: [
      {
        callId: patchControlCallId,
        toolName,
        original: patchOriginal.trimEnd(),
        decision: 'skip-control',
      },
      targetHandler,
    ],
    requests: [
      {
        method: 'POST',
        path: '/v1/responses',
        headers: {},
        body: { tools: [{ type: 'custom', name: 'apply_patch' }], input: [] },
      },
      {
        method: 'POST',
        path: '/v1/responses',
        headers: {},
        body: {
          input: [
            {
              type: outputType,
              call_id: patchControlCallId,
              output: 'patch rejected: empty patch',
            },
          ],
        },
      },
      {
        method: 'POST',
        path: '/v1/responses',
        headers: {},
        body: {
          input: [{ type: outputType, call_id: rewriteCallId, output: targetOutput }],
        },
      },
    ],
    before: {},
    after: {},
    sandbox: 'read-only',
  }
}

test('shell rewrite policy oracle binds the allowed original to the forbidden rewrite and no effect', () => {
  const id = 'REWRITE-SHELL-NATIVE-DENY'
  expect(() => assertRewritePolicyObservation(id, rewritePolicyObservation(true))).not.toThrow()
  for (const mutate of [
    (o: RewritePolicyObservation) => {
      o.sandbox = 'read-only'
    },
    (o: RewritePolicyObservation) => {
      o.policyRule = shellPolicyRule.replace('owned/rewritten', 'owned/original')
    },
    (o: RewritePolicyObservation) => {
      o.payloads[0].tool_input.command = shellRewritten
    },
    (o: RewritePolicyObservation) => {
      o.payloads[0].tool_use_id = 'wrong'
    },
    (o: RewritePolicyObservation) => {
      o.payloads[0].session_id = ''
    },
    (o: RewritePolicyObservation) => {
      o.payloads.push({ ...o.payloads[0] })
    },
    (o: RewritePolicyObservation) => {
      o.handlers[0].callId = 'wrong'
    },
    (o: RewritePolicyObservation) => {
      o.handlers[0].updated = shellOriginal
    },
    (o: RewritePolicyObservation) => {
      o.handlers[0].decision = 'skip-control'
    },
    (o: RewritePolicyObservation) => {
      o.requests[1]!.body.input[0].output =
        'policy forbids commands starting with `touch owned/original`'
    },
    (o: RewritePolicyObservation) => {
      o.requests[1]!.body.input[0].output += '\nProcess exited with code 0'
    },
    (o: RewritePolicyObservation) => {
      o.requests[1]!.body.input[0].output =
        'Command blocked by PreToolUse hook: policy forbids commands starting with `touch owned/rewritten`'
    },
    (o: RewritePolicyObservation) => {
      o.requests.push(structuredClone(o.requests[1]!))
    },
    (o: RewritePolicyObservation) => {
      o.payloads.push({ hook_event_name: 'PostToolUse', tool_use_id: rewriteCallId })
    },
    (o: RewritePolicyObservation) => {
      o.after = { original: '' }
    },
  ]) {
    const observed = rewritePolicyObservation(true)
    mutate(observed)
    expect(() => assertRewritePolicyObservation(id, observed)).toThrow()
  }
})

test('patch rewrite policy oracle requires the empty-patch control before read-only denial', () => {
  const id = 'REWRITE-PATCH-NATIVE-DENY'
  expect(() => assertRewritePolicyObservation(id, rewritePolicyObservation(false))).not.toThrow()
  for (const mutate of [
    (o: RewritePolicyObservation) => {
      o.sandbox = 'danger-full-access'
    },
    (o: RewritePolicyObservation) => {
      o.policyRule = shellPolicyRule
    },
    (o: RewritePolicyObservation) => {
      o.requests[0]!.body.tools = []
    },
    (o: RewritePolicyObservation) => {
      o.payloads[0].tool_input.command = patchOriginal
    },
    (o: RewritePolicyObservation) => {
      o.payloads[1].tool_input.command = patchRewritten
    },
    (o: RewritePolicyObservation) => {
      o.payloads.push({ ...o.payloads[1] })
    },
    (o: RewritePolicyObservation) => {
      o.handlers[1].updated = patchOriginal
    },
    (o: RewritePolicyObservation) => {
      o.requests[1]!.body.input[0].output =
        'patch rejected: writing is blocked by read-only sandbox; rejected by user approval settings'
    },
    (o: RewritePolicyObservation) => {
      o.requests[2]!.body.input[0].output = 'patch rejected: empty patch'
    },
    (o: RewritePolicyObservation) => {
      o.requests[2]!.body.input[0].output = 'Command blocked by PreToolUse hook: read-only sandbox'
    },
    (o: RewritePolicyObservation) => {
      o.requests.push(structuredClone(o.requests[2]!))
    },
    (o: RewritePolicyObservation) => {
      o.payloads.push({ hook_event_name: 'PostToolUse', tool_use_id: rewriteCallId })
    },
    (o: RewritePolicyObservation) => {
      o.after = { rewritten: Buffer.from('native\n').toString('base64') }
    },
    (o: RewritePolicyObservation) => {
      o.payloads[1].session_id = 'different'
    },
  ]) {
    const observed = rewritePolicyObservation(false)
    mutate(observed)
    expect(() => assertRewritePolicyObservation(id, observed)).toThrow()
  }
})

test('fixture callback uses captured native output and awaits bounded completion', async () => {
  const logs = directory()
  let observed = false
  const server = startFixture(
    [
      async (request: any) => {
        expect(nativeFeedback(request, 'retry', true)).toBe('native-only')
        await Promise.resolve()
        observed = true
        return { type: 'message', role: 'assistant', content: [] }
      },
    ],
    logs,
  )
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/v1/responses`, {
      method: 'POST',
      body: JSON.stringify({
        input: [{ type: 'function_call_output', call_id: 'retry', output: 'native-only' }],
      }),
    })
    expect(response.status).toBe(200)
    expect(observed).toBe(true)
    expect(await response.text()).toBe(readFileSync(join(logs, 'response-1.sse'), 'utf8'))
    expect(() => server.assertComplete()).not.toThrow()
  } finally {
    await server.stop()
  }
})

test('fixture callback assertion failure remains a failed sequence without emitting a scripted retry', async () => {
  const logs = directory()
  const server = startFixture(
    [
      () => {
        throw new Error('effect appeared before approval')
      },
    ],
    logs,
  )
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/v1/responses`, {
      method: 'POST',
      body: '{"input":[]}',
    })
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('effect appeared before approval')
    expect(existsSync(join(logs, 'response-1.sse'))).toBe(false)
    expect(() => server.assertComplete()).toThrow('Fixture assertion')
  } finally {
    await server.stop()
  }
})

function message(text: string) {
  return {
    type: 'message',
    role: 'developer',
    content: [{ type: 'input_text', text }],
  }
}

test('context oracle reads attributed message text, excluding metadata, arguments and assistant content', () => {
  const contextual = baseline()
  for (const [event, token] of Object.entries(tokens)) {
    const index = event === 'SessionStart' || event === 'UserPromptSubmit' ? 0 : 1
    contextual.requests[index]!.body.input.push(message(token))
    contextual.handlers.find((h) => h.event === event).contextToken = token
  }
  expect(() => assertObservation('M1-CONTEXT', contextual)).not.toThrow()
  for (const [event, token] of Object.entries(tokens)) {
    const index = event === 'SessionStart' || event === 'UserPromptSubmit' ? 0 : 1
    for (const replacement of [
      { type: 'message', role: 'developer', id: token, content: [] },
      { type: 'message', role: 'developer', metadata: { token }, content: [] },
      {
        type: 'function_call',
        call_id: 'other',
        name: 'exec_command',
        arguments: JSON.stringify({ text: token }),
      },
      { ...message(token), role: 'assistant' },
      {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_image', text: token }],
      },
      message('unrelated'),
    ]) {
      const observed = structuredClone(contextual)
      observed.requests[index]!.body.input = observed.requests[index]!.body.input.map(
        (item: any) => (item.content?.[0]?.text === token ? replacement : item),
      )
      expect(() => assertObservation('M1-CONTEXT', observed)).toThrow(`Missing ${event} context`)
    }
    const misplaced = structuredClone(contextual)
    misplaced.requests[index]!.body.input = misplaced.requests[index]!.body.input.filter(
      (item: any) => item.content?.[0]?.text !== token,
    )
    misplaced.requests[1 - index]!.body.input.push(message(token))
    expect(() => assertObservation('M1-CONTEXT', misplaced)).toThrow()
    const unattributed = structuredClone(contextual)
    unattributed.handlers.find((h) => h.event === event).contextToken = 'wrong'
    expect(() => assertObservation('M1-CONTEXT', unattributed)).toThrow('attribution')
  }
})

test('Stop oracle requires one real-text reminder in the same turn with history 0 to 1', () => {
  const stopped = baseline()
  stopped.payloads.push({
    ...stopped.payloads.find((p) => p.hook_event_name === 'Stop'),
  })
  stopped.handlers.push({
    ...stopped.handlers.find((h) => h.event === 'Stop'),
    priorInterventions: 1,
  })
  stopped.requests.push({
    ...structuredClone(stopped.requests[1]!),
    body: { input: [message(stopReason)] },
  })
  expect(() => assertObservation('M1-STOP', stopped)).not.toThrow()
  for (const mutate of [
    (o: Observation) => {
      o.payloads[o.payloads.length - 1].turn_id = 'different'
    },
    (o: Observation) => {
      o.payloads.push({
        hook_event_name: 'UserPromptSubmit',
        turn_id: 'unit-turn',
      })
    },
    (o: Observation) => {
      o.handlers.push({ event: 'UserPromptSubmit' })
    },
    (o: Observation) => {
      o.handlers[o.handlers.length - 1].priorInterventions = 0
    },
    (o: Observation) => {
      o.handlers.find((h) => h.event === 'Stop').priorInterventions = 1
    },
    (o: Observation) => {
      o.requests.push(structuredClone(o.requests[2]!))
    },
    (o: Observation) => {
      o.requests[1]!.body.input.push(message(stopReason))
    },
    (o: Observation) => {
      o.requests[2]!.body.input = [message('unrelated')]
    },
    (o: Observation) => {
      o.requests[2]!.body.input = [
        {
          ...message('unrelated'),
          id: stopReason,
          metadata: { reason: stopReason },
        },
      ]
    },
    (o: Observation) => {
      o.requests[2]!.body.input = [
        {
          type: 'function_call',
          arguments: JSON.stringify({ reason: stopReason }),
        },
      ]
    },
    (o: Observation) => {
      o.requests[2]!.body.input = [{ ...message(stopReason), role: 'assistant' }]
    },
  ]) {
    const observed = structuredClone(stopped)
    mutate(observed)
    expect(() => assertObservation('M1-STOP', observed)).toThrow()
  }
})

test('completion publication propagates failing subprocess status and refuses absent, zero or partial counts', async () => {
  for (const sample of [
    {
      code: 0,
      mode: '--unit',
      completion: { mode: '--unit', completed: expectedUnitTests },
      expected: 0,
    },
    {
      code: 7,
      mode: '--unit',
      completion: { mode: '--unit', completed: expectedUnitTests },
      expected: 7,
    },
    { code: 0, mode: '--unit', completion: null, expected: 1 },
    {
      code: 0,
      mode: '--unit',
      completion: { mode: '--unit', completed: 0 },
      expected: 1,
    },
    {
      code: 0,
      mode: '--unit',
      completion: { mode: '--unit', completed: expectedUnitTests - 1 },
      expected: 1,
    },
    {
      code: 0,
      mode: '--smoke',
      completion: {
        mode: '--smoke',
        completed: mandatoryCases.length,
        cases: mandatoryCases,
      },
      expected: 0,
    },
    {
      code: 1,
      mode: '--smoke',
      completion: {
        mode: '--smoke',
        completed: mandatoryCases.length,
        cases: mandatoryCases,
      },
      expected: 1,
    },
  ]) {
    const logs = directory()
    if (sample.completion) save(join(logs, 'completed.json'), sample.completion)
    const code = `import { publishPassed } from '/app/test/native-codex/harness.ts'; process.exit(publishPassed(${JSON.stringify(logs)}, ${JSON.stringify(sample.mode)}, ${sample.code}));`
    const result = await run(
      [process.execPath, '-e', code],
      logs,
      { PATH: '/usr/local/bin:/usr/bin:/bin' },
      join(logs, 'publication'),
      2000,
    )
    expect(result.code).toBe(sample.expected)
    expect(existsSync(join(logs, 'passed.json'))).toBe(sample.expected === 0)
  }
}, 15000)

// Execute the real shell runner against a tiny disposable checkout and a Docker stub.
// These exercise exit composition only: no Docker daemon, build or native binary is invoked.
async function shellStatus(failure: string) {
  const logs = directory()
  const repo = join(logs, 'repo')
  const bin = join(logs, 'bin')
  mkdirSync(bin)
  for (const path of ['scripts', 'src', 'test', 'schemas', '.clooks/vendor/plugin'])
    mkdirSync(join(repo, path), { recursive: true })
  for (const path of ['tsconfig.json', 'bunfig.toml', 'package.json', 'bun.lock'])
    writeFileSync(join(repo, path), '{}\n')
  cpSync('/app/scripts/test-codex-native.sh', join(repo, 'scripts/test-codex-native.sh'))
  const stubs = {
    git: '#!/bin/bash\nif [[ "$STUB_FAILURE" == setup ]]; then exit 17; fi\nprintf "unit-revision\\n"\n',
    chmod:
      '#!/bin/bash\nif [[ "$STUB_FAILURE" == seal && "$1" == a-w && "$2" == */export ]]; then exit 31; fi\nexec /bin/chmod "$@"\n',
    sha256sum:
      '#!/bin/bash\nif [[ "$STUB_FAILURE" == hash && "$1" == -c ]]; then exit 37; fi\nexec /usr/bin/sha256sum "$@"\n',
    docker: `#!/bin/bash
set -eu
case "$1" in
  image) printf 'sha256:unit-stub-only\\n' ;;
  rm) if [[ "$STUB_FAILURE" == cleanup ]]; then exit 29; fi ;;
  run)
    if [[ "$STUB_FAILURE" == docker ]]; then exit 23; fi
    export_path=
    for arg in "$@"; do
      if [[ "$arg" == type=bind,src=*,dst=/export ]]; then
        export_path=$(printf '%s' "$arg" | cut -d , -f2 | cut -d = -f2-)
      fi
    done
    [[ -n "$export_path" ]]
    if [[ "$STUB_FAILURE" != absent-pass ]]; then printf '{}\\n' > "$export_path/passed.json"; fi
    printf '0\\n' > "$export_path/test.rc"
    if [[ "$STUB_FAILURE" == status ]]; then mkdir "$(dirname "$export_path")/final.rc"; fi
    if [[ "$STUB_FAILURE" != export ]]; then /bin/chmod a-w "$export_path/"*; fi
    ;;
  *) exit 99 ;;
esac
`,
  }
  for (const [name, source] of Object.entries(stubs))
    writeFileSync(join(bin, name), source, { mode: 0o755 })
  try {
    const result = await run(
      ['/bin/bash', join(repo, 'scripts/test-codex-native.sh'), '--unit'],
      repo,
      { PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`, STUB_FAILURE: failure },
      join(logs, 'runner'),
      5000,
    )
    const attempts = join(repo, 'tmp/codex-native-m1')
    const names = readdirSync(attempts)
    expect(names).toHaveLength(1)
    const attempt = join(attempts, names[0]!)
    const status = (name: string) => readFileSync(join(attempt, name), 'utf8').trim()
    return { result, status, attempt }
  } finally {
    // The tested runner deliberately removes write bits from its snapshots and exports.
    for (const path of readdirSync(repo, { recursive: true }))
      chmodSync(join(repo, String(path)), 0o700)
  }
}

test('shell runner preserves actual setup and Docker failures and rejects a missing pass artifact', async () => {
  for (const [failure, expected] of [
    ['none', 0],
    ['setup', 17],
    ['docker', 23],
    ['absent-pass', 66],
  ] as const) {
    const { result, status } = await shellStatus(failure)
    expect(result.code).toBe(expected)
    expect(status('rc')).toBe(String(expected))
    expect(status('runner.rc')).toBe(String(expected))
    expect(status('setup.rc')).toBe(failure === 'setup' ? '17' : '0')
    expect(status('docker.rc')).toBe(
      failure === 'setup' ? 'not-started' : failure === 'docker' ? '23' : '0',
    )
    expect(status('native-launch-count')).toBe('0')
  }
}, 30000)

test('shell cleanup, export, hash and status-write failures cannot turn into success', async () => {
  for (const [failure, expected, rawStatus] of [
    ['cleanup', 29, 'cleanup.rc'],
    ['seal', 31, 'seal.rc'],
    ['export', 74, 'export-seal.rc'],
    ['hash', 37, 'hash.rc'],
    ['status', 74, 'status-write.rc'],
  ] as const) {
    const { result, status } = await shellStatus(failure)
    expect(result.code).toBe(expected)
    expect(status('runner.rc')).toBe('0')
    expect(status('docker.rc')).toBe('0')
    expect(status(rawStatus)).toBe(failure === 'status' ? '1' : String(expected))
    expect(status('rc')).toBe(String(expected))
  }
}, 30000)

test('missing and empty captures fail; valid captures remain readable', () => {
  const logs = directory()
  const payloads = join(logs, 'payloads')
  const handlers = join(logs, 'handlers.jsonl')
  expect(() => readCaptures(payloads, handlers)).toThrow('Missing')
  mkdirSync(payloads)
  writeFileSync(handlers, '')
  expect(() => readCaptures(payloads, handlers)).toThrow('Empty')
  save(join(payloads, '1.json'), { hook_event_name: 'Stop' })
  writeFileSync(handlers, '{"event":"Stop"}\n')
  expect(readCaptures(payloads, handlers).handlers).toEqual([{ event: 'Stop' }])
})

test('subprocess nonzero and spawn failure propagate with raw capture', async () => {
  const logs = directory()
  const ok = await run(
    ['/bin/bash', '-c', 'printf control'],
    logs,
    { PATH: '/usr/bin:/bin' },
    join(logs, 'ok'),
    2000,
  )
  expect(() => requireSuccess(ok)).not.toThrow()
  expect(ok.stdout).toBe('control')
  const bad = await run(
    ['/bin/bash', '-c', 'printf failure >&2; exit 7'],
    logs,
    { PATH: '/usr/bin:/bin' },
    join(logs, 'bad'),
    2000,
  )
  expect(bad.code).toBe(7)
  expect(bad.stderr).toBe('failure')
  expect(() => requireSuccess(bad)).toThrow('Subprocess failed')
  expect(JSON.parse(readFileSync(join(logs, 'bad.result.json'), 'utf8')).code).toBe(7)
  await expect(
    run(['/missing-native-unit-executable'], logs, {}, join(logs, 'missing'), 2000),
  ).rejects.toThrow()
  expect(existsSync(join(logs, 'missing.error.json'))).toBe(true)
})

test('timeout kills the detached descendant group and reaps the direct child', async () => {
  const logs = directory()
  const result = await run(
    ['/bin/bash', '-c', 'sleep 30 & printf "%s" "$!"; wait'],
    logs,
    { PATH: '/usr/bin:/bin' },
    join(logs, 'timeout'),
    200,
  )
  expect(result.timedOut).toBe(true)
  expect(result.signal).toBe('SIGKILL')
  expect(result.reaped).toBe(true)
  expect(result.elapsedMs).toBeLessThan(3000)
  expect(() => requireSuccess(result)).toThrow()
  const pid = Number(result.stdout)
  expect(pid).toBeGreaterThan(0)
  const stat = `/proc/${pid}/stat`
  if (existsSync(stat)) expect(readFileSync(stat, 'utf8').split(') ')[1]![0]).toBe('Z')
  else expect(() => process.kill(pid, 0)).toThrow()
}, 5000)

test('normal parent exit also closes inherited pipes by killing remaining children', async () => {
  const logs = directory()
  const result = await run(
    ['/bin/bash', '-c', 'sleep 30 & printf finished; exit 0'],
    logs,
    { PATH: '/usr/bin:/bin' },
    join(logs, 'orphan'),
    2000,
  )
  requireSuccess(result)
  expect(result.stdout).toBe('finished')
  expect(result.elapsedMs).toBeLessThan(3000)
}, 5000)
