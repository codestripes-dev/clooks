import { test } from 'bun:test'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { startFixture } from './fixture-server'
import { packScenario } from './pack-scenarios'
import {
  assertObservation,
  binaryPin,
  baselineCases,
  callId,
  commandA,
  commandB,
  denyReason,
  mandatoryCases,
  packCases,
  readCaptures,
  requireSuccess,
  requireThat,
  run,
  save,
  sha256,
  stopReason,
  tokens,
  verifyMetadata,
  type CaseId,
} from './harness'

const exported = process.env.CLOOKS_NATIVE_LOGDIR
if (
  process.env.CLOOKS_E2E_DOCKER !== 'true' ||
  process.env.CLOOKS_NATIVE_MODE !== '--smoke' ||
  !exported
) {
  throw new Error('Use bash scripts/test-codex-native.sh --smoke in disposable Docker')
}
const logRoot: string = exported

async function scenario(id: CaseId) {
  const clooksSha256 = sha256('/app/dist/clooks')
  const logs = join(logRoot, id)
  mkdirSync(logs)
  const base = mkdtempSync('/tmp/clooks-native-m1-')
  const home = mkdtempSync(join(base, 'home-'))
  const codexHome = mkdtempSync(join(base, 'codex-home-'))
  const project = mkdtempSync(join(base, 'project-'))
  const decoy = mkdtempSync(join(base, 'decoy-'))
  const payloadDir = join(logs, 'payloads')
  mkdirSync(payloadDir)
  const env: Record<string, string> = {
    HOME: home,
    CODEX_HOME: codexHome,
    CODEX_SQLITE_HOME: codexHome,
    CLOOKS_HOME_ROOT: home,
    CLOOKS_DEBUG: 'true',
    CLOOKS_LOGDIR: payloadDir,
    PATH: '/app/dist:/native/bin:/native/codex-path:/usr/local/bin:/usr/bin:/bin',
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    TERM: 'dumb',
  }
  const message = {
    type: 'message',
    role: 'assistant',
    id: 'native_m1_message',
    content: [{ type: 'output_text', text: 'done' }],
  }
  const items: unknown[] = [
    {
      type: 'function_call',
      call_id: callId,
      name: 'exec_command',
      arguments: JSON.stringify({
        cmd: commandA,
        workdir: project,
        yield_time_ms: 1000,
        max_output_tokens: 1000,
      }),
    },
    message,
  ]
  if (id === 'M1-STOP') items.push({ ...message, id: 'native_m1_continued' })
  const server = startFixture(items, logs)
  try {
    const init = await run(
      ['/app/dist/clooks', 'init', '--agent', 'codex', '--json'],
      project,
      env,
      join(logs, 'init'),
      15_000,
    )
    requireSuccess(init)
    requireThat(JSON.parse(init.stdout).ok === true, 'Generated init failed')
    cpSync(join(project, '.codex/hooks.json'), join(logs, 'generated-hooks.json'))
    cpSync(join(project, '.clooks/bin/entrypoint.sh'), join(logs, 'generated-entrypoint.sh'))
    const hookLog = join(logs, 'handlers.jsonl')
    const fixture = '/app/test/fixtures/codex/native/hook.ts'
    cpSync(fixture, join(project, '.clooks/hooks/native-m1.ts'))
    cpSync(fixture, join(logs, 'hook.ts.txt'))
    env.CLOOKS_NATIVE_CASE_CONFIG = join(logs, 'hook-config.json')
    save(env.CLOOKS_NATIVE_CASE_CONFIG, {
      id,
      handlerLog: hookLog,
      commandB,
      denyReason,
      stopReason,
      tokens,
    })
    writeFileSync(join(project, '.clooks/clooks.yml'), 'version: "1.0.0"\nnative-m1: {}\n')
    const config = `model = "gpt-5.1-codex"
model_provider = "native_fixture"
approval_policy = "never"
[projects.${JSON.stringify(project)}]
trust_level = "trusted"
[features]
enable_request_compression = false
[model_providers.native_fixture]
name = "Native fixture"
base_url = "http://127.0.0.1:${server.port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 15000
[shell_environment_policy]
inherit = "all"
ignore_default_excludes = true
`
    writeFileSync(join(codexHome, 'config.toml'), config)
    writeFileSync(join(logs, 'config.toml'), config, { flag: 'wx' })
    env.CLOOKS_PROJECT_ROOT = decoy
    const prompt = 'Run the scripted command once, then finish.'
    for (const token of [...Object.values(tokens), stopReason]) {
      requireThat(
        !JSON.stringify(items).includes(token) && !prompt.includes(token),
        'Oracle token leaked into fixture script',
      )
    }
    const result = await run(
      [
        '/native/bin/codex',
        'exec',
        '--skip-git-repo-check',
        '--dangerously-bypass-hook-trust',
        '--json',
        '--sandbox',
        'danger-full-access',
        prompt,
      ],
      project,
      env,
      join(logs, 'native'),
      60_000,
    )
    const observed = {
      ...readCaptures(payloadDir, hookLog),
      requests: server.requests,
      marker: existsSync(join(project, 'marker'))
        ? readFileSync(join(project, 'marker'), 'utf8')
        : null,
      rewrittenMarker: existsSync(join(project, 'rewritten-marker'))
        ? readFileSync(join(project, 'rewritten-marker'), 'utf8')
        : null,
    }
    save(join(logs, 'observed.json'), observed)
    requireSuccess(result)
    server.assertComplete()
    assertObservation(id, observed)
    requireThat(sha256('/app/dist/clooks') === clooksSha256, 'Clooks changed during case')
    save(join(logs, 'passed.json'), {
      id,
      status: 'passed',
      clooksSha256,
      evidence: 'native CLI with synthetic model',
      limitations: [
        'synthetic project trust',
        'hook-trust bypass',
        'danger-full-access',
        'inline transport only',
      ],
    })
  } catch (error) {
    save(join(logs, 'failure.json'), {
      id,
      status: 'failed',
      error: String(error),
      stack: error instanceof Error ? error.stack : null,
    })
    throw error
  } finally {
    await server.stop()
    rmSync(base, { recursive: true, force: true })
  }
}

test('nine mandatory native cases, baseline and patch positive controls first', async () => {
  requireThat(process.getuid!() !== 0, 'Native tests must run as non-root')
  requireThat(existsSync('/native/bin/codex'), 'Missing explicit native distribution')
  const actual = sha256('/native/bin/codex')
  save(join(logRoot, 'pin.json'), {
    expectedVersion: '0.153.4',
    expectedSha256: binaryPin,
    actualSha256: actual,
    versionEvidence: 'Parent separate M0 metadata preflight; no new version execution',
    model: 'gpt-5.1-codex',
    modelMetadataWarning: 'Native fallback metadata warning accepted; raw stderr retained',
  })
  verifyMetadata(actual)
  for (const id of baselineCases) await scenario(id)
  for (const id of packCases) await packScenario(id, logRoot)
  save(join(logRoot, 'completed.json'), {
    mode: '--smoke',
    completed: mandatoryCases.length,
    cases: mandatoryCases,
    evidence: 'native CLI with synthetic model',
  })
}, 180_000)
