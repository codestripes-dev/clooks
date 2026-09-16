import {
  chmodSync,
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
import { assertShutdownObservation } from './session-end-observation'
import {
  binaryPin,
  readCaptures,
  requireSuccess,
  requireThat,
  run,
  save,
  sha256,
  verifyMetadata,
} from './harness'

export async function sessionEndScenario(logRoot: string) {
  requireThat(process.getuid!() !== 0, 'Native shutdown must run non-root')
  verifyMetadata(sha256('/native/bin/codex'))
  const clooksSha256 = sha256('/app/dist/clooks')
  const logs = join(logRoot, 'SESSION-END')
  mkdirSync(logs)
  const base = mkdtempSync('/tmp/clooks-native-session-end-')
  const home = join(base, 'home')
  const codexHome = join(base, 'codex')
  const project = join(base, 'project')
  const bin = join(base, 'bin')
  const payloadDir = join(logs, 'payloads')
  for (const directory of [home, codexHome, project, bin, payloadDir])
    mkdirSync(directory, directory === home ? { mode: 0o700 } : {})
  const timeline = join(logs, 'timeline.jsonl')
  const marker = join(project, 'pending-shutdown')
  const env: Record<string, string> = {
    HOME: home,
    CODEX_HOME: codexHome,
    CODEX_SQLITE_HOME: codexHome,
    CLOOKS_HOME_ROOT: home,
    CLOOKS_DEBUG: 'true',
    CLOOKS_LOGDIR: payloadDir,
    PATH: `${bin}:/app/dist:/native/bin:/native/codex-path:/usr/local/bin:/usr/bin:/bin`,
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    TMUX: '/inert/no-real-socket,1,0',
    TMUX_PANE: '%4',
  }
  const server = startFixture(
    [
      {
        type: 'message',
        role: 'assistant',
        id: 'shutdown_done',
        content: [{ type: 'output_text', text: 'shutdown fixture complete' }],
      },
    ],
    logs,
  )
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
    const hooksPath = join(project, '.codex/hooks.json')
    const registered = readFileSync(hooksPath, 'utf8')
    const hooks = JSON.parse(registered).hooks
    requireThat(
      Object.keys(hooks).length === 12 && hooks.SessionEnd[0].hooks[0].timeout === 3,
      'Missing generated SessionEnd registration',
    )
    cpSync(hooksPath, join(logs, 'generated-hooks.json'))
    cpSync(join(project, '.clooks/bin/entrypoint.sh'), join(logs, 'generated-entrypoint.sh'))
    cpSync(
      '/app/.clooks/vendor/plugin/clooks-core-hooks/tmux-notifications.ts',
      join(project, '.clooks/hooks/tmux-notifications.ts'),
    )
    writeFileSync(
      join(bin, 'tmux'),
      `#!/usr/local/bin/bun
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(timeline)}, JSON.stringify({ args }) + '\\n')
if (args[0] === 'display-message') console.log('@7')
if (args[0] === 'show-options') console.log('on')
`,
    )
    chmodSync(join(bin, 'tmux'), 0o755)
    writeFileSync(marker, 'pending\n')
    const observer = `import { appendFileSync, unlinkSync } from 'node:fs'
function record(ctx) {
  appendFileSync(${JSON.stringify(timeline)}, JSON.stringify({ event: ctx.event, sessionId: ctx.sessionId, reason: ctx.reason }) + '\\n')
  return ctx.skip()
}
export const hook = {
  meta: { name: 'native-shutdown' },
  SessionStart: record,
  Stop: record,
  SessionEnd(ctx) { const result = record(ctx); unlinkSync(${JSON.stringify(marker)}); return result },
}
`
    writeFileSync(join(project, '.clooks/hooks/native-shutdown.ts'), observer)
    writeFileSync(join(logs, 'observer.ts.txt'), observer)
    writeFileSync(
      join(project, '.clooks/clooks.yml'),
      `version: "1.0.0"
tmux-notifications: {}
native-shutdown: {}
SessionStart:
  order: [tmux-notifications, native-shutdown]
Stop:
  order: [tmux-notifications, native-shutdown]
SessionEnd:
  order: [tmux-notifications, native-shutdown]
`,
    )
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
    writeFileSync(join(logs, 'config.toml'), config)
    save(join(logs, 'pin.json'), { version: '0.153.4', sha256: binaryPin, clooksSha256 })
    const result = await run(
      [
        '/native/bin/codex',
        'exec',
        '--skip-git-repo-check',
        '--dangerously-bypass-hook-trust',
        '--json',
        '--sandbox',
        'danger-full-access',
        'Reply briefly, then finish.',
      ],
      project,
      env,
      join(logs, 'native'),
      60_000,
    )
    const captures = readCaptures(payloadDir, timeline)
    const observed = {
      payloads: captures.payloads,
      timeline: captures.handlers,
      markerExists: existsSync(marker),
    }
    save(join(logs, 'observed.json'), observed)
    requireSuccess(result)
    server.assertComplete()
    assertShutdownObservation(observed)
    requireThat(
      readFileSync(hooksPath, 'utf8') === registered,
      'Generated registration changed during native run',
    )
    requireThat(sha256('/app/dist/clooks') === clooksSha256, 'Compiled Clooks changed')
    save(join(logs, 'passed.json'), {
      id: 'SESSION-END',
      status: 'passed',
      clooksSha256,
      evidence: 'real pinned Codex exec orderly shutdown with synthetic model and fake tmux',
      limitations: [
        'synthetic project trust',
        'hook-trust bypass',
        'danger-full-access',
        'no live tmux server',
        'not all closure paths or failure variants',
      ],
    })
  } catch (error) {
    save(join(logs, 'failure.json'), {
      error: String(error),
      stack: error instanceof Error ? error.stack : null,
    })
    throw error
  } finally {
    await server.stop()
    rmSync(base, { recursive: true, force: true })
    save(join(logs, 'cleanup.json'), { removed: !existsSync(base) })
  }
}
