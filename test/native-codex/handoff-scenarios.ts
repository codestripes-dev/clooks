import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { startFixture, type CapturedRequest } from './fixture-server'
import {
  handoffCases,
  modelReadableText,
  requireSuccess,
  requireThat,
  run,
  save,
  sha256,
} from './harness'

export async function handoffScenario(
  [id, event, kind]: (typeof handoffCases)[number],
  logRoot: string,
) {
  const logs = join(logRoot, id)
  mkdirSync(logs)
  const base = mkdtempSync('/tmp/clooks native handoff ')
  const home = join(base, 'home')
  const codexHome = join(base, 'codex')
  const project = join(base, 'project')
  for (const dir of [home, codexHome, project]) mkdirSync(dir, dir === home ? { mode: 0o700 } : {})
  const clooksSha256 = sha256('/app/dist/clooks')
  const env = {
    HOME: home,
    CODEX_HOME: codexHome,
    CODEX_SQLITE_HOME: codexHome,
    CLOOKS_HOME_ROOT: home,
    PATH: '/app/dist:/native/bin:/native/codex-path:/usr/local/bin:/usr/bin:/bin',
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    TERM: 'dumb',
  }
  const payload = `Private handoff content for ${id}.\nRead this complete message.\n`
  const trigger = 'printf touched > handoff-effect'
  const message = {
    type: 'message',
    role: 'assistant',
    id: 'handoff_done',
    content: [{ type: 'output_text', text: 'done' }],
  }
  let pointerPath = ''
  const readPointer = (request: CapturedRequest) => {
    const triggerOutput = request.body.input
      .filter(
        (item: any) => item.type === 'function_call_output' && item.call_id === 'handoff_trigger',
      )
      .map((item: any) => (typeof item.output === 'string' ? item.output : ''))
      .join('\n')
    const text = [...modelReadableText(request.body.input), triggerOutput].join('\n')
    requireThat(!text.includes(payload), 'Full content leaked inline before the native read')
    const match = /\[clooks\] Hook "native-handoff": read (.+?) and follow its instructions\./.exec(
      text,
    )
    requireThat(match, `No model-readable handoff pointer for ${event}`)
    pointerPath = match[1]!
    requireThat(pointerPath.startsWith(join(project, '.clooks/tmp/handoff-')), 'Wrong handoff root')
    const quoted = `'${pointerPath.replaceAll("'", "'\\''")}'`
    return {
      type: 'function_call',
      call_id: 'handoff_read',
      name: 'exec_command',
      arguments: JSON.stringify({
        cmd: `cat -- ${quoted}`,
        workdir: project,
        max_output_tokens: 2000,
      }),
    }
  }
  const assertRead = (request: CapturedRequest) => {
    const result = request.body.input.find(
      (item: any) => item.type === 'function_call_output' && item.call_id === 'handoff_read',
    )
    requireThat(
      result && typeof result.output === 'string' && result.output.includes(payload),
      'Native file read did not deliver the full content to the model',
    )
    return { ...message, id: 'handoff_read_complete' }
  }
  const steps: unknown[] = [readPointer, assertRead]
  if (event === 'PreToolUse' || event === 'PostToolUse') {
    steps.unshift({
      type: 'function_call',
      call_id: 'handoff_trigger',
      name: 'exec_command',
      arguments: JSON.stringify({ cmd: trigger, workdir: project, max_output_tokens: 1000 }),
    })
  } else if (event === 'Stop') steps.unshift(message)
  const server = startFixture(steps, logs)
  try {
    requireSuccess(
      await run(
        ['/app/dist/clooks', 'init', '--agent', 'codex', '--json'],
        project,
        env,
        join(logs, 'init'),
        15_000,
      ),
    )
    const handler = `export const hook = {
  meta: { name: 'native-handoff' },
  ${event}(ctx) {
    ${event === 'Stop' ? 'if (ctx.turn.priorInterventions > 0) return ctx.skip()' : ''}
    ${event === 'PreToolUse' || event === 'PostToolUse' ? `if (ctx.toolInput.command !== ${JSON.stringify(trigger)}) return ctx.skip()` : ''}
    return ctx.${kind === 'block' ? 'block' : 'skip'}({ ${kind === 'block' ? 'reason' : 'injectContext'}: ${JSON.stringify(payload)} })
  }
}
`
    writeFileSync(join(project, '.clooks/hooks/native-handoff.ts'), handler)
    writeFileSync(join(logs, 'hook.ts.txt'), handler)
    writeFileSync(
      join(project, '.clooks/clooks.yml'),
      'version: "1.0.0"\nnative-handoff: { handoff: true }\n',
    )
    writeFileSync(
      join(codexHome, 'config.toml'),
      `model = "gpt-5.1-codex"
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
`,
    )
    const result = await run(
      [
        '/native/bin/codex',
        'exec',
        '--skip-git-repo-check',
        '--dangerously-bypass-hook-trust',
        '--json',
        '--sandbox',
        'workspace-write',
        'Follow the hook instructions, then finish.',
      ],
      project,
      env,
      join(logs, 'native'),
      60_000,
    )
    requireSuccess(result)
    server.assertComplete()
    requireThat(readFileSync(pointerPath, 'utf8') === payload, 'Handoff file contents changed')
    requireThat((statSync(pointerPath).mode & 0o777) === 0o600, 'Handoff file is not private')
    if (event === 'PreToolUse' || event === 'PostToolUse') {
      requireThat(
        existsSync(join(project, 'handoff-effect')) ===
          !(event === 'PreToolUse' && kind === 'block'),
        'Handoff altered the underlying tool decision',
      )
    }
    requireThat(sha256('/app/dist/clooks') === clooksSha256, 'Compiled binary changed')
    save(join(logs, 'passed.json'), {
      id,
      status: 'passed',
      clooksSha256,
      event,
      kind,
      pointerPath,
      nativeRead: true,
      sandbox: 'workspace-write',
      evidence: 'native CLI with synthetic model',
    })
  } catch (error) {
    save(join(logs, 'failure.json'), { error: String(error) })
    throw error
  } finally {
    await server.stop()
    rmSync(base, { recursive: true, force: true })
  }
}
