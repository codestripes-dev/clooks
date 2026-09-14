import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startFixture, type CapturedRequest } from './fixture-server'
import {
  modelReadableText,
  readCaptures,
  requireSuccess,
  requireThat,
  run,
  save,
  sha256,
  verifyMetadata,
} from './harness'
import { nativeFeedback } from './hybrid-scenarios'
import { packCatalog } from './pack-scenarios'

type Sandbox = 'danger-full-access' | 'workspace-write' | 'read-only'

// Invoke only from the existing network-disabled Docker smoke harness.
export async function handoffChildScenario(logRoot: string) {
  requireThat(existsSync('/.dockerenv'), 'HANDOFF-CHILD requires the native Docker runner')
  verifyMetadata(sha256('/native/bin/codex'))
  const id = 'HANDOFF-CHILD'
  const logs = join(logRoot, id)
  mkdirSync(logs)
  const clooksSha256 = sha256('/app/dist/clooks')
  const sandboxes = ['danger-full-access', 'workspace-write', 'read-only'] as const
  const attempts = []
  try {
    for (const sandbox of sandboxes) attempts.push(await childAttempt(join(logs, sandbox), sandbox))
    requireThat(
      attempts.length === sandboxes.length &&
        attempts.every(
          (attempt, index) => attempt.sandbox === sandboxes[index] && attempt.status === 'passed',
        ),
      'All three child sandbox attempts must pass',
    )
    requireThat(sha256('/app/dist/clooks') === clooksSha256, 'Clooks changed during child handoff')
    save(join(logs, 'passed.json'), {
      id,
      status: 'passed',
      clooksSha256,
      attempts,
      evidence: 'Native child requests contain handoff pointers and exact exec_command file output',
      limitations: [
        'synthetic local provider/catalog',
        'synthetic project trust',
        'hook-trust bypass',
      ],
    })
  } catch (error) {
    save(join(logs, 'failure.json'), {
      id,
      error: String(error),
      stack: error instanceof Error ? error.stack : null,
    })
    throw error
  }
}

async function childAttempt(logs: string, sandbox: Sandbox) {
  mkdirSync(logs)
  const base = mkdtempSync('/tmp/clooks-native-child-')
  const home = join(base, 'home'),
    codexHome = join(base, 'codex'),
    project = join(base, 'project')
  const payloadDir = join(logs, 'payloads'),
    handlerLog = join(logs, 'handlers.jsonl')
  for (const dir of [home, codexHome, project, payloadDir]) mkdirSync(dir)
  const env = {
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
  const payloads = {
    start: `Private SubagentStart payload ${randomUUID()}.\nRead this entire child-only message.\n`,
    stop: `Private SubagentStop payload ${randomUUID()}.\nComplete this child-only continuation.\n`,
  }
  const pointers: Record<string, string> = {}
  const reads: unknown[] = [],
    routing: unknown[] = []
  let parent = '',
    child = '',
    spawned = '',
    parentStep = 0,
    childStep = 0
  const message = (name: string) => ({
    type: 'message',
    role: 'assistant',
    id: `child_handoff_${name}`,
    content: [{ type: 'output_text', text: name }],
  })
  const call = (callId: string, name: string, args: unknown, namespace?: string) => ({
    type: 'function_call',
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
    ...(namespace ? { namespace } : {}),
  })
  const readPointer = (request: CapturedRequest, phase: keyof typeof payloads) => {
    const text = modelReadableText(request.body.input).join('\n')
    requireThat(!text.includes(payloads[phase]), `${phase} payload leaked inline before child read`)
    const matches = [
      ...text.matchAll(
        /\[clooks\] Hook "child-handoff": read (.+?) and follow its instructions\./g,
      ),
    ]
    const paths = [...new Set(matches.map((match) => match[1]!))].filter(
      (path) => phase === 'start' || path !== pointers.start,
    )
    requireThat(paths.length === 1, `Missing unique ${phase} pointer in child request`)
    const path = paths[0]!
    requireThat(
      path.startsWith(join(project, '.clooks/tmp/handoff-child-handoff-')) && path.endsWith('.md'),
      'Unexpected child handoff path',
    )
    pointers[phase] = path
    const quoted = `'${path.replaceAll("'", "'\\''")}'`
    return call(`child_read_${phase}`, 'exec_command', {
      cmd: `cat -- ${quoted}`,
      workdir: project,
      yield_time_ms: 1000,
      max_output_tokens: 2000,
    })
  }
  const assertRead = (request: CapturedRequest, phase: keyof typeof payloads) => {
    const output = nativeFeedback(request, `child_read_${phase}`, true)
    reads.push({ phase, thread: child, output, path: pointers[phase] })
    requireThat(
      output.includes('Process exited with code 0'),
      `Native ${phase} read failed: ${output}`,
    )
    const marker = '\nOutput:\n'
    requireThat(
      output.includes(marker) &&
        output.slice(output.indexOf(marker) + marker.length) === payloads[phase],
      `Native ${phase} output differs from exact payload`,
    )
    return message(phase === 'start' ? 'child-first-finish' : 'child-read-complete')
  }
  // All callbacks are synchronous: global fixture consumption cannot race on async routing.
  const route = (request: CapturedRequest) => {
    const thread = request.headers['x-client-request-id']
    requireThat(typeof thread === 'string' && thread.length > 0, 'Missing native request thread ID')
    if (!parent) parent = thread
    const isParent = thread === parent
    routing.push({
      request: routing.length + 1,
      thread,
      recipient: isParent ? 'parent' : 'child',
      step: isParent ? parentStep : childStep,
    })
    if (isParent) {
      requireThat(
        !JSON.stringify(request.body.input).includes('child_read_'),
        'Child tool history leaked into parent',
      )
      if (parentStep++ === 0) {
        requireThat(
          request.body.tools?.some(
            (tool: any) =>
              tool.type === 'namespace' &&
              tool.name === 'multi_agent_v1' &&
              tool.tools?.some((entry: any) => entry.name === 'spawn_agent'),
          ),
          'Native multi_agent_v1 spawn tool not advertised',
        )
        return call(
          'child_spawn',
          'spawn_agent',
          {
            message: 'Read your hook instructions and finish.',
            agent_type: 'default',
            fork_context: false,
          },
          'multi_agent_v1',
        )
      }
      if (parentStep === 2) {
        const feedback = JSON.parse(nativeFeedback(request, 'child_spawn', true))
        requireThat(
          typeof feedback.agent_id === 'string' && feedback.agent_id !== parent,
          'Missing real spawned child ID',
        )
        spawned = feedback.agent_id
        if (child) requireThat(child === spawned, 'Spawned ID differs from requesting child')
        return call(
          'child_wait',
          'wait_agent',
          { targets: [spawned], timeout_ms: 30000 },
          'multi_agent_v1',
        )
      }
      requireThat(
        parentStep === 3 && childStep === 4,
        'Parent finished before child read continuation',
      )
      const waited = JSON.parse(nativeFeedback(request, 'child_wait', true))
      requireThat(
        waited.timed_out === false && waited.status?.[spawned]?.completed === 'child-read-complete',
        'Native wait did not observe completed child',
      )
      return message('parent-complete')
    }
    if (!child) child = thread
    requireThat(
      thread === child && (!spawned || thread === spawned),
      'Unexpected third native thread',
    )
    switch (childStep++) {
      case 0:
        return readPointer(request, 'start')
      case 1:
        return assertRead(request, 'start')
      case 2:
        return readPointer(request, 'stop')
      case 3:
        return assertRead(request, 'stop')
      default:
        throw new Error('Unexpected child continuation')
    }
  }
  const server = startFixture(
    Array.from({ length: 7 }, () => route),
    logs,
  )
  try {
    const init = await run(
      ['/app/dist/clooks', 'init', '--agent', 'codex', '--json'],
      project,
      env,
      join(logs, 'init'),
      15000,
    )
    requireSuccess(init)
    requireThat(JSON.parse(init.stdout).ok === true, 'Generated Codex registration failed')
    cpSync(join(project, '.codex/hooks.json'), join(logs, 'generated-hooks.json'))
    cpSync(join(project, '.clooks/bin/entrypoint.sh'), join(logs, 'generated-entrypoint.sh'))
    const hook = `import { appendFileSync } from 'node:fs'
const record = (ctx, decision) => appendFileSync(${JSON.stringify(handlerLog)}, JSON.stringify({ event: ctx.event, agentId: ctx.agentId, turn: ctx.turn, decision }) + '\\n')
export const hook = {
  meta: { name: 'child-handoff' },
  SubagentStart(ctx) {
    record(ctx, 'skip')
    return ctx.skip({ injectContext: ${JSON.stringify(payloads.start)} })
  },
  SubagentStop(ctx) {
    const prior = ctx.turn.priorInterventions
    record(ctx, prior > 0 ? 'skip' : 'block')
    if (prior > 0) return ctx.skip()
    return ctx.block({ reason: ${JSON.stringify(payloads.stop)} })
  }
}
`
    writeFileSync(join(project, '.clooks/hooks/child-handoff.ts'), hook)
    writeFileSync(join(logs, 'hook.ts.txt'), hook)
    const config = {
      version: '1.0.0',
      'child-handoff': { uses: './.clooks/hooks/child-handoff.ts', handoff: true, maxFailures: 0 },
    }
    writeFileSync(join(project, '.clooks/clooks.yml'), JSON.stringify(config))
    save(join(logs, 'clooks-config.json'), config)
    save(join(logs, 'expected-payloads.json'), payloads)
    save(join(codexHome, 'models.json'), packCatalog)
    const toml = `model = "gpt-5.1-codex"
model_catalog_json = ${JSON.stringify(join(codexHome, 'models.json'))}
model_provider = "native_fixture"
approval_policy = "never"
[projects.${JSON.stringify(project)}]
trust_level = "trusted"
[features]
multi_agent = true
multi_agent_v2 = false
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
    writeFileSync(join(codexHome, 'config.toml'), toml)
    writeFileSync(join(logs, 'config.toml'), toml)
    const result = await run(
      [
        '/native/bin/codex',
        'exec',
        '--skip-git-repo-check',
        '--dangerously-bypass-hook-trust',
        '--json',
        '--sandbox',
        sandbox,
        'Spawn one child to follow its hook instructions, wait for it, then finish.',
      ],
      project,
      env,
      join(logs, 'native'),
      60000,
    )
    requireSuccess(result)
    server.assertComplete()
    requireThat(
      parentStep === 3 && childStep === 4 && child === spawned,
      'Incomplete child handoff sequence',
    )
    const captures = readCaptures(payloadDir, handlerLog)
    save(join(logs, 'captures.json'), captures)
    const starts = captures.payloads.filter((p: any) => p.hook_event_name === 'SubagentStart')
    const stops = captures.payloads.filter((p: any) => p.hook_event_name === 'SubagentStop')
    requireThat(
      starts.length === 1 &&
        stops.length === 2 &&
        [...starts, ...stops].every((p: any) => p.agent_id === child),
      'Missing child lifecycle attribution',
    )
    requireThat(
      stops[0].turn_id && stops[0].turn_id === stops[1].turn_id,
      'Child continuation changed native turn',
    )
    const history = captures.handlers.filter((h: any) => h.event === 'SubagentStop')
    requireThat(
      history.length === 2 &&
        history[0].turn.priorInterventions === 0 &&
        history[0].decision === 'block' &&
        history[1].turn.priorInterventions === 1 &&
        history[1].decision === 'skip' &&
        history[1].turn.prior.some(
          (p: any) => p.event === 'SubagentStop' && p.decision === 'block',
        ),
      'Child stop history did not block then skip',
    )
    for (const phase of ['start', 'stop']) {
      const post = captures.payloads.filter(
        (p: any) => p.hook_event_name === 'PostToolUse' && p.tool_use_id === `child_read_${phase}`,
      )
      requireThat(
        post.length === 1 &&
          post[0].agent_id === child &&
          post[0].tool_response === payloads[phase as keyof typeof payloads],
        `Missing exact child ${phase} PostToolUse output`,
      )
    }
    return { sandbox, status: 'passed', parent, child, expectedRequests: 7, nativeReads: 2 }
  } catch (error) {
    save(join(logs, 'failure.json'), { error: String(error) })
    throw error
  } finally {
    save(join(logs, 'observed.json'), {
      parent,
      child,
      spawned,
      parentStep,
      childStep,
      pointers,
      reads,
      routing,
      fixtureErrors: server.errors,
    })
    await server.stop()
    rmSync(base, { recursive: true, force: true })
  }
}
