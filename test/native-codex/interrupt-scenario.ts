import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { requireSuccess, requireThat, run, save, sha256 } from './harness'

export async function interruptScenario(logRoot: string) {
  const id = 'INTERRUPT'
  const logs = join(logRoot, id)
  mkdirSync(logs)
  const base = mkdtempSync('/tmp/clooks-native-interrupt-')
  const home = join(base, 'home'),
    codexHome = join(base, 'codex'),
    project = join(base, 'project')
  for (const dir of [home, codexHome, project]) mkdirSync(dir, dir === home ? { mode: 0o700 } : {})
  const marker = join(logs, 'interrupt.json')
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
  let requestStarted!: () => void
  const active = new Promise<void>((resolve) => {
    requestStarted = resolve
  })
  const requests: unknown[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      requireThat(!request.headers.has('authorization'), 'Unexpected real credentials')
      const body = await request.json()
      requests.push(body)
      save(join(logs, `request-${requests.length}.json`), body)
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'event: response.created\ndata: {"type":"response.created","response":{"id":"interrupt-pending"}}\n\n',
            ),
          )
          requestStarted()
        },
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  let child: ReturnType<typeof spawn> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let reaped: Promise<{ code: number | null; signal: string | null }> | undefined
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
    const registration = JSON.parse(readFileSync(join(project, '.codex/hooks.json'), 'utf8'))
    requireThat(
      registration.hooks.Interrupt?.[0]?.hooks?.[0]?.timeout === 3,
      'Interrupt registration missing three-second deadline',
    )
    writeFileSync(
      join(project, '.clooks/hooks/native-interrupt.ts'),
      `import { writeFileSync, readFileSync } from 'node:fs'
export const hook = { meta: { name: 'native-interrupt' }, Interrupt(ctx) {
  writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
    agent: ctx.agent, event: ctx.event, sessionId: ctx.sessionId,
    model: ctx.model, permissionMode: ctx.permissionMode,
    transcript: readFileSync(ctx.transcriptPath, 'utf8')
  }))
  return ctx.skip()
} }
`,
    )
    writeFileSync(join(project, '.clooks/clooks.yml'), 'version: "1.0.0"\nnative-interrupt: {}\n')
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
stream_idle_timeout_ms = 60000
`,
    )
    const argv = [
      '/native/bin/codex',
      'exec',
      '--skip-git-repo-check',
      '--dangerously-bypass-hook-trust',
      '--json',
      '--sandbox',
      'workspace-write',
      'native interruption transcript marker',
    ]
    save(join(logs, 'native.command.json'), { argv, cwd: project, env })
    child = spawn(argv[0]!, argv.slice(1), {
      cwd: project,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = [],
      stderr: Buffer[] = []
    child.stdout!.on('data', (data: Buffer) => stdout.push(data))
    child.stderr!.on('data', (data: Buffer) => stderr.push(data))
    child.once('spawn', () => save(join(logs, 'native.launched.json'), { pid: child!.pid }))
    reaped = new Promise((resolve, reject) => {
      child!.once('error', reject)
      child!.once('close', (code, signal) => resolve({ code, signal }))
    })
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Native interruption deadline exceeded')), 30_000)
    })
    await Promise.race([
      active,
      reaped.then(() => {
        throw new Error('Native exited before active turn')
      }),
      deadline,
    ])
    requireThat(child.kill('SIGINT'), 'Could not interrupt the native process')
    const result = await Promise.race([reaped, deadline])
    save(join(logs, 'native.result.json'), {
      ...result,
      stdout: Buffer.concat(stdout).toString(),
      stderr: Buffer.concat(stderr).toString(),
    })
    requireThat(
      result.signal === null && result.code === 1,
      'Interrupted Codex exec must exit 1 after graceful shutdown',
    )
    requireThat(existsSync(marker), 'Native interruption did not execute the Clooks hook')
    const observed = JSON.parse(readFileSync(marker, 'utf8'))
    requireThat(
      observed.event === 'Interrupt' && observed.agent === 'codex',
      'Wrong interrupt context',
    )
    requireThat(
      typeof observed.sessionId === 'string' && observed.sessionId.length > 0,
      'Missing session identity',
    )
    requireThat(
      typeof observed.model === 'string' &&
        observed.model.length > 0 &&
        typeof observed.permissionMode === 'string' &&
        observed.permissionMode.length > 0,
      'Missing model or permission mode',
    )
    requireThat(
      observed.transcript.includes('native interruption transcript marker'),
      'Interrupted prompt not flushed to transcript',
    )
    const transcript = observed.transcript
      .trim()
      .split('\n')
      .map((line: string) => JSON.parse(line))
    requireThat(
      transcript.some(
        (entry: any) =>
          entry.type === 'response_item' &&
          entry.payload?.role === 'user' &&
          entry.payload.content?.some(
            (part: any) => part.type === 'input_text' && part.text?.startsWith('<turn_aborted>'),
          ),
      ),
      'Native interruption marker not flushed before the hook',
    )
    requireThat(sha256('/app/dist/clooks') === clooksSha256, 'Compiled binary changed')
    save(join(logs, 'passed.json'), {
      id,
      status: 'passed',
      clooksSha256,
      nativeInterrupt: true,
      evidence: 'SIGINT during active native model request',
    })
  } catch (error) {
    save(join(logs, 'failure.json'), { error: String(error) })
    throw error
  } finally {
    clearTimeout(timer)
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* Already reaped. */
      }
    }
    await reaped?.catch(() => {})
    server.stop(true)
    rmSync(base, { recursive: true, force: true })
  }
}
