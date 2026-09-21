import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { sse } from '../native-codex/fixture-server'
import { packCatalog } from '../native-codex/pack-scenarios'
import { save } from './native'
import {
  createRuntimeAdvisoryFixture,
  runtimeAdvisoryCases,
  runtimeBehaviors,
  sha256,
  type AdvisoryAgent,
  type RuntimeAdvisoryCase,
  type RuntimeAdvisoryNativeFixture,
} from './runtime-advisory'

export const fixturePrompt = 'Reply with the fixture completion token.'
export const completionToken = 'RUNTIME_ADVISORY_FIXTURE_COMPLETE'
export const pinnedVersions = { claude: '2.1.278 (Claude Code)', codex: 'codex-cli 0.154.0' }

export interface RuntimeAdvisoryObservation {
  nativeExit: number | null
  requestCount: number
  promptRequestCount: number
  completionSeen: boolean
  terminalStop: boolean
  terminalStderr: boolean
  terminalRuntime: boolean
  terminalAdvisory: boolean
  terminalAdvisoryComplete: boolean
  modelRuntime: boolean
  modelAdvisory: boolean
  modelAdvisoryComplete: boolean
  entries: readonly string[]
  binaryInvocations: readonly string[]
  runtimeInput?: { hook_event_name?: string; session_id?: string }
}
export interface RuntimeAdvisoryNativeResult
  extends RuntimeAdvisoryObservation, RuntimeAdvisoryCase {
  id: string
  passed: boolean
}

export function promptRequests(requests: unknown[]): unknown[] {
  return requests.filter((request) => {
    if (!request || typeof request !== 'object') return false
    const body = request as { input?: unknown; messages?: unknown }
    const messages = body.input ?? body.messages
    if (!Array.isArray(messages)) return false
    // Background title requests quote the prompt inside instructions. The
    // actual turn carries it as a complete user content block on both agents.
    return messages.some(
      (message) =>
        message?.role === 'user' &&
        (message.content === fixturePrompt ||
          (Array.isArray(message.content) &&
            message.content.some((part: any) => part?.text === fixturePrompt))),
    )
  })
}

export function observeRuntimeAdvisory(
  c: RuntimeAdvisoryCase,
  floor: string,
  terminal: string,
  requests: unknown[],
  execution: Pick<
    RuntimeAdvisoryObservation,
    'nativeExit' | 'entries' | 'binaryInvocations' | 'runtimeInput'
  >,
): RuntimeAdvisoryObservation {
  const visible = stripVTControlCharacters(terminal).replace(/\s+/g, ' ')
  const prompts = promptRequests(requests)
  const model = JSON.stringify(prompts)
  const subject = c.scope === 'global' ? 'This global installation' : 'This project'
  const fragments = [
    subject + ' requires Clooks ' + floor + ' or newer; installed: 0.0.1.',
    c.agent === 'claude' ? '/clooks:setup update' : '$clooks:setup update',
    'original installation method.',
  ]
  return {
    ...execution,
    requestCount: requests.length,
    promptRequestCount: prompts.length,
    completionSeen: visible.includes(completionToken),
    terminalStop: visible.includes('OLD_RUNTIME_STOP'),
    terminalStderr: visible.includes('OLD_RUNTIME_STDERR'),
    terminalRuntime: visible.includes('OLD_RUNTIME_VISIBLE'),
    terminalAdvisory: visible.includes('requires Clooks'),
    terminalAdvisoryComplete: fragments.every((part) => visible.includes(part)),
    modelRuntime: model.includes('OLD_RUNTIME_CONTEXT'),
    modelAdvisory: model.includes('requires Clooks'),
    modelAdvisoryComplete:
      fragments.every((part) => model.includes(part)) &&
      model.includes('Tell the user; do not update automatically.'),
  }
}

export function assertRuntimeAdvisoryObservation(
  c: RuntimeAdvisoryCase,
  r: RuntimeAdvisoryObservation,
): void {
  const skipped = c.advisory === 'skip'
  const stopped = c.agent === 'codex' && c.runtime === 'continue-false' && !skipped
  const runtimeVisible =
    !skipped &&
    (c.runtime === 'success-output' || (c.agent === 'claude' && c.runtime === 'fail-output'))
  assert.equal(r.nativeExit, 0, 'PTY driver failed')
  assert.equal(r.promptRequestCount, stopped ? 0 : 1, 'Wrong prompt-bearing request count')
  if (stopped) assert.equal(r.requestCount, 0, 'continue:false reached the model')
  else assert.ok(r.requestCount >= 1, 'No model request')
  assert.equal(r.completionSeen, !stopped, 'Changed completion semantics')
  assert.equal(r.terminalStop, stopped, 'Changed stop semantics')
  assert.equal(
    r.terminalStderr,
    !skipped && c.agent === 'claude' && ['fail-output', 'stderr-only'].includes(c.runtime),
    'Changed stderr semantics',
  )
  assert.equal(r.terminalRuntime, runtimeVisible, 'Changed runtime UI')
  assert.equal(r.modelRuntime, runtimeVisible, 'Changed runtime context')
  assert.equal(r.terminalAdvisory, c.advisory === 'message', 'Missing or unexpected advisory UI')
  assert.equal(r.terminalAdvisoryComplete, c.advisory === 'message', 'Incomplete advisory UI')
  assert.equal(
    r.modelAdvisory,
    c.advisory === 'message' && !stopped,
    'Wrong advisory model context',
  )
  assert.equal(
    r.modelAdvisoryComplete,
    c.advisory === 'message' && !stopped,
    'Incomplete advisory context',
  )
  assert.deepEqual(
    r.entries.toSorted(),
    [
      ...(skipped && c.agent === 'codex' ? [] : ['runtime:' + (c.mixed ? 'global' : c.scope)]),
      ...(c.advisory === 'absent' ? [] : ['advisory:' + c.scope]),
    ].toSorted(),
    'Unexpected generated entrypoint execution count',
  )
  assert.deepEqual(
    r.binaryInvocations.toSorted(),
    skipped ? [] : ['runtime', ...(c.advisory === 'message' ? ['probe:eof'] : [])].toSorted(),
    'Wrong runtime/probe invocation count or probe stdin was not EOF',
  )
  if (skipped) assert.equal(r.runtimeInput, undefined, 'SKIP reached the runtime')
  else {
    assert.equal(r.runtimeInput?.hook_event_name, 'SessionStart', 'Wrong runtime payload')
    assert.ok(r.runtimeInput?.session_id, 'Missing native session identity')
  }
}

export function assertRuntimeAdvisoryMatrix(results: RuntimeAdvisoryNativeResult[]): void {
  const cases = runtimeAdvisoryCases()
  assert.equal(results.length, cases.length, 'Incomplete native matrix')
  for (const c of cases) {
    const matches = results.filter(
      (r) =>
        r.agent === c.agent &&
        r.runtime === c.runtime &&
        r.scope === c.scope &&
        r.order === c.order &&
        r.advisory === c.advisory &&
        !!r.mixed === !!c.mixed,
    )
    assert.equal(matches.length, 1, 'Missing or duplicate native case: ' + JSON.stringify(c))
    assert.equal(matches[0]!.passed, true)
    assertRuntimeAdvisoryObservation(c, matches[0]!)
  }
  for (const agent of ['claude', 'codex'] as const)
    for (const runtime of runtimeBehaviors) {
      const baseline = results.find(
        (r) => r.agent === agent && r.runtime === runtime && r.advisory === 'absent',
      )!
      const advisory = results.find(
        (r) =>
          r.agent === agent &&
          r.runtime === runtime &&
          r.advisory === 'message' &&
          r.scope === 'project' &&
          !r.mixed,
      )!
      for (const field of [
        'terminalRuntime',
        'modelRuntime',
        'terminalStop',
        'terminalStderr',
        'completionSeen',
        'promptRequestCount',
        'nativeExit',
      ] as const)
        assert.equal(
          advisory[field],
          baseline[field],
          'Advisory changed ' + field + ': ' + agent + '/' + runtime,
        )
    }
}

function claudeResponse(body: any, text: string): Response {
  const message = {
    id: 'msg_runtime_advisory',
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  }
  if (!body.stream) return Response.json(message)
  const event = (type: string, value: unknown) =>
    'event: ' + type + '\ndata: ' + JSON.stringify(value) + '\n\n'
  return new Response(
    event('message_start', {
      type: 'message_start',
      message: { ...message, content: [], stop_reason: null },
    }) +
      event('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }) +
      event('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text },
      }) +
      event('content_block_stop', { type: 'content_block_stop', index: 0 }) +
      event('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 5 },
      }) +
      event('message_stop', { type: 'message_stop' }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

// Reuse the proven Claude stream shape and permanent Codex Responses fixture
// encoder; permit title requests without treating them as the actual turn.
export function startAdvisoryProvider(agent: AdvisoryAgent, root: string) {
  const requests: unknown[] = [],
    errors: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (agent === 'claude' && path === '/api/hello') return Response.json({})
      const reject = (message: string) => {
        errors.push(message)
        return new Response(message, { status: 400 })
      }
      if (
        request.method !== 'POST' ||
        path !== (agent === 'claude' ? '/v1/messages' : '/v1/responses')
      )
        return reject('Unexpected fixture route: ' + request.method + ' ' + path)
      if (
        request.headers.has('authorization') ||
        (request.headers.has('x-api-key') &&
          (agent !== 'claude' || request.headers.get('x-api-key') !== 'local-test-only'))
      )
        return reject('Unexpected fixture credentials')
      let body: any
      try {
        body = await request.json()
      } catch {
        return reject('Invalid fixture JSON')
      }
      if (!Array.isArray(agent === 'claude' ? body.messages : body.input))
        return reject('Invalid model input')
      requests.push(body)
      save(join(root, 'request-' + requests.length + '.json'), body)
      const title = promptRequests([body]).length === 0
      const text = title ? '{"title":"Runtime advisory"}' : completionToken
      if (agent === 'claude') return claudeResponse(body, text)
      return new Response(
        sse('advisory_response_' + requests.length, {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    },
  })
  return { port: server.port, requests, errors, stop: () => server.stop(true) }
}

function configureNative(
  f: RuntimeAdvisoryNativeFixture,
  c: RuntimeAdvisoryCase,
  port: number,
): string[] {
  if (c.agent === 'claude') {
    save(join(f.home, '.claude.json'), {
      hasCompletedOnboarding: true,
      theme: 'dark',
      customApiKeyResponses: { approved: ['local-test-only'], rejected: [] },
      projects: { [f.project]: { hasTrustDialogAccepted: true } },
    })
    f.env.ANTHROPIC_API_KEY = 'local-test-only'
    f.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + port
    return [
      '/native/claude',
      '--permission-mode',
      'default',
      '--model',
      'claude-sonnet-4-6',
      '--tools',
      '',
    ]
  }
  save(join(f.codexHome, 'models.json'), packCatalog)
  writeFileSync(
    join(f.codexHome, 'config.toml'),
    [
      'model = "gpt-5.1-codex"',
      'model_catalog_json = ' + JSON.stringify(join(f.codexHome, 'models.json')),
      'model_provider = "native_fixture"',
      'approval_policy = "never"',
      '[projects.' + JSON.stringify(f.project) + ']',
      'trust_level = "trusted"',
      '[features]',
      'enable_request_compression = false',
      'remote_plugin = false',
      '[model_providers.native_fixture]',
      'name = "Local fixture"',
      'base_url = "http://127.0.0.1:' + port + '/v1"',
      'wire_api = "responses"',
      'requires_openai_auth = false',
      'supports_websockets = false',
      'request_max_retries = 0',
      'stream_max_retries = 0',
      '',
    ].join('\n'),
  )
  return [
    '/native/codex',
    '--no-alt-screen',
    '--sandbox',
    'danger-full-access',
    '--ask-for-approval',
    'never',
  ]
}

const readLines = (path: string): string[] =>
  existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean) : []

async function launchPty(f: RuntimeAdvisoryNativeFixture, c: RuntimeAdvisoryCase, argv: string[]) {
  const pidPath = join(f.root, 'native.pid')
  const args = [
    '/app/test/native-approvals/runtime-advisory.exp',
    c.agent,
    join(f.root, 'terminal.log'),
    completionToken,
    pidPath,
    ...argv,
  ]
  save(join(f.root, 'native-command.json'), {
    executable: 'expect',
    args,
    cwd: f.project,
    env: f.env,
    debug: false,
  })
  const child = spawn('expect', args, {
    cwd: f.project,
    env: f.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '',
    stderr = '',
    timedOut = false
  child.stdout.on('data', (b) => {
    stdout += b
  })
  child.stderr.on('data', (b) => {
    stderr += b
  })
  const kill = (pid: number) => {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  const contain = () => {
    if (existsSync(pidPath)) {
      const nativePid = Number(readFileSync(pidPath, 'utf8').trim())
      assert.ok(Number.isInteger(nativePid) && nativePid > 1)
      kill(-nativePid)
      kill(nativePid)
    }
    if (child.pid) kill(-child.pid)
  }
  const timer = setTimeout(() => {
    timedOut = true
    contain()
  }, 90000)
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    assert.equal(timedOut, false, 'Native PTY exceeded its deadline')
    return code
  } finally {
    clearTimeout(timer)
    contain()
    writeFileSync(join(f.root, 'driver.stdout.log'), stdout)
    writeFileSync(join(f.root, 'driver.stderr.log'), stderr)
    save(join(f.root, 'cleanup.json'), {
      timedOut,
      expectPid: child.pid,
      nativePid: readLines(pidPath)[0] ?? null,
      containmentComplete: true,
    })
  }
}

async function runCase(
  root: string,
  binary: string,
  c: RuntimeAdvisoryCase,
  id: string,
): Promise<RuntimeAdvisoryNativeResult> {
  const f = createRuntimeAdvisoryFixture(join(root, id), c, binary)
  const server = startAdvisoryProvider(c.agent, f.root)
  try {
    const argv = configureNative(f, c, server.port!)
    const nativeExit = await launchPty(f, c, argv)
    const result: RuntimeAdvisoryNativeResult = {
      id,
      ...c,
      passed: false,
      ...observeRuntimeAdvisory(
        c,
        f.floor,
        readFileSync(join(f.root, 'terminal.log'), 'utf8'),
        server.requests,
        {
          nativeExit,
          entries: readLines(join(f.root, 'entry-invocations.log')),
          binaryInvocations: readLines(join(f.root, 'binary-invocations.log')),
          runtimeInput: existsSync(join(f.root, 'runtime-input.json'))
            ? JSON.parse(readFileSync(join(f.root, 'runtime-input.json'), 'utf8'))
            : undefined,
        },
      ),
    }
    save(join(f.root, 'observation.json'), result)
    assert.deepEqual(server.errors, [], 'Offline provider errors')
    assertRuntimeAdvisoryObservation(c, result)
    for (const file of f.managed)
      assert.equal(sha256(file.path), file.sha256, 'Generated artifact changed: ' + file.path)
    result.passed = true
    save(join(f.root, 'result.json'), result)
    return result
  } finally {
    await server.stop()
    save(join(f.root, 'provider.json'), { requests: server.requests, errors: server.errors })
  }
}

export interface ReverseAdvisoryObservation {
  nativeExit: number | null
  promptRequestCount: number
  completionSeen: boolean
  terminalReminder: boolean
  terminalSetup: boolean
  terminalManual: boolean
  terminalForwardAdvisory: boolean
  modelHookContext: boolean
  modelReminder: boolean
  entries: string[]
  hookInvocations: string[]
}

export function assertReverseAdvisoryObservation(r: ReverseAdvisoryObservation): void {
  assert.equal(r.nativeExit, 0)
  assert.equal(r.promptRequestCount, 1)
  assert.equal(r.completionSeen, true, 'Candidate hook prevented completion')
  assert.equal(r.terminalReminder, true, 'Reverse reminder not visible in native UI')
  assert.equal(r.terminalSetup, true, 'Missing agent-specific update route')
  assert.equal(r.terminalManual, true, 'Missing manual refresh route')
  assert.equal(r.terminalForwardAdvisory, false, 'Compatible candidate emitted forward warning')
  assert.equal(r.modelHookContext, true, 'Existing hook output was lost')
  // Reverse reminders currently use systemMessage only. Model delivery of the
  // reminder is an observation, never a required transport contract.
  assert.deepEqual(r.entries.toSorted(), ['advisory:project', 'runtime:project'])
  assert.deepEqual(r.hookInvocations, ['SessionStart'])
}

async function runReverseCase(root: string, binary: string, agent: AdvisoryAgent) {
  const id = 'reverse-' + agent
  const c: RuntimeAdvisoryCase = {
    agent,
    scope: 'project',
    order: 'runtime-first',
    advisory: 'message',
    runtime: 'success-output',
  }
  const f = createRuntimeAdvisoryFixture(join(root, id), c, binary, 'candidate')
  const launcher = join(f.project, '.clooks/bin/entrypoint.sh')
  const generated = readFileSync(launcher, 'utf8')
  assert.match(generated, /^# clooks launcher revision: [1-9][0-9]*$/m)
  writeFileSync(
    launcher,
    generated.replace(
      /^# clooks launcher revision: [1-9][0-9]*$/m,
      '# clooks launcher revision: 0',
    ),
  )
  const launcherReceipt = f.managed.find((file) => file.path === launcher)!
  const generatedSha256 = launcherReceipt.sha256
  launcherReceipt.sha256 = sha256(launcher)
  const hookPath = join(f.project, '.clooks/hooks/native-session-output.ts')
  mkdirSync(join(f.project, '.clooks/hooks'), { recursive: true })
  writeFileSync(
    hookPath,
    [
      "import { appendFileSync } from 'node:fs'",
      'export const hook = {',
      "  meta: { name: 'native-session-output' },",
      '  SessionStart() {',
      '    appendFileSync(' +
        JSON.stringify(join(f.root, 'hook-invocations.log')) +
        ', "SessionStart\\n")',
      "    return { result: 'skip', injectContext: 'CANDIDATE_SESSION_CONTEXT_PRESERVED' }",
      '  },',
      '}',
      '',
    ].join('\n'),
  )
  const configPath = join(f.project, '.clooks/clooks.yml')
  writeFileSync(configPath, 'version: "1.0.0"\nnative-session-output: {}\n')
  for (const path of [hookPath, configPath]) f.managed.push({ path, sha256: sha256(path) })
  save(join(f.root, 'reverse-fixture.json'), {
    generatedSha256,
    legacySha256: launcherReceipt.sha256,
    revision: 0,
    candidateBinarySha256: sha256(binary),
    managed: f.managed,
    reminderModelContextRequired: false,
    evidence:
      'Reverse delivery and preserved hook output; omitted MCP may also affect inspection, so not sole legacy classification proof',
  })
  const server = startAdvisoryProvider(agent, f.root)
  try {
    const nativeExit = await launchPty(f, c, configureNative(f, c, server.port!))
    const terminal = stripVTControlCharacters(
      readFileSync(join(f.root, 'terminal.log'), 'utf8'),
    ).replace(/\s+/g, ' ')
    const prompts = promptRequests(server.requests)
    const model = JSON.stringify(prompts)
    const result = {
      id,
      agent,
      passed: false,
      nativeExit,
      promptRequestCount: prompts.length,
      completionSeen: terminal.includes(completionToken),
      terminalReminder: terminal.includes("This project's Clooks integration is outdated"),
      terminalSetup: terminal.includes(
        agent === 'claude' ? '/clooks:setup update' : '$clooks:setup update',
      ),
      terminalManual:
        terminal.includes('refresh manually with') &&
        terminal.includes("'init'") &&
        terminal.includes("'--agent' 'all'"),
      terminalForwardAdvisory: terminal.includes('requires Clooks'),
      modelHookContext: model.includes('CANDIDATE_SESSION_CONTEXT_PRESERVED'),
      modelReminder: model.includes("This project's Clooks integration is outdated"),
      entries: readLines(join(f.root, 'entry-invocations.log')),
      hookInvocations: readLines(join(f.root, 'hook-invocations.log')),
    }
    save(join(f.root, 'observation.json'), result)
    assert.deepEqual(server.errors, [])
    assertReverseAdvisoryObservation(result)
    for (const file of f.managed)
      assert.equal(sha256(file.path), file.sha256, 'Reverse fixture was changed: ' + file.path)
    result.passed = true
    save(join(f.root, 'result.json'), result)
    return result
  } finally {
    await server.stop()
    save(join(f.root, 'provider.json'), { requests: server.requests, errors: server.errors })
  }
}

export async function runGeneratedRuntimeAdvisoryCases(root: string, binary: string) {
  assert.equal(process.env.CLOOKS_E2E_DOCKER, 'true')
  assert.notEqual(process.getuid!(), 0)
  const versionHome = join(root, 'version-home')
  mkdirSync(versionHome, { recursive: true })
  for (const agent of ['claude', 'codex'] as const) {
    const path = '/native/' + agent
    const version = Bun.spawnSync([path, '--version'], {
      env: {
        HOME: versionHome,
        CODEX_HOME: join(versionHome, '.codex'),
        PATH: '/usr/local/bin:/usr/bin:/bin',
        DISABLE_AUTOUPDATER: '1',
      },
      timeout: 5000,
    })
    const text = version.stdout.toString().trim()
    save(join(root, agent + '-version.json'), {
      version: text,
      exitCode: version.exitCode,
      sha256: sha256(path),
    })
    assert.equal(version.exitCode, 0)
    assert.equal(text, pinnedVersions[agent], 'Unreviewed native version')
  }
  const results: RuntimeAdvisoryNativeResult[] = []
  const failures: { id: string; case: RuntimeAdvisoryCase; error: string }[] = []
  const cases = runtimeAdvisoryCases()
  for (const [index, c] of cases.entries()) {
    const id = [
      String(index + 1).padStart(2, '0'),
      c.agent,
      c.order,
      c.mixed ? 'mixed' : c.scope,
      c.advisory,
      c.runtime,
    ].join('-')
    try {
      results.push(await runCase(root, binary, c, id))
    } catch (error) {
      failures.push({
        id,
        case: c,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      })
    }
    save(join(root, 'results.json'), { cases: cases.length, results, failures })
    console.log(id + ': ' + (failures.some((f) => f.id === id) ? 'FAIL' : 'PASS'))
  }
  assert.deepEqual(failures, [], 'Native advisory case failures')
  assertRuntimeAdvisoryMatrix(results)
  const reverse = []
  for (const agent of ['claude', 'codex'] as const) {
    reverse.push(await runReverseCase(root, binary, agent))
    save(join(root, 'reverse-results.json'), reverse)
  }
  save(join(root, 'passed.json'), {
    mode: '--runtime-advisory',
    passed: true,
    forward: results,
    reverse,
  })
  return { forward: results, reverse }
}
