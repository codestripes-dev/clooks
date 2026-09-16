import { isDeepStrictEqual } from 'node:util'
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
import { startFixture, type CapturedRequest } from './fixture-server'
import {
  readCaptures,
  requireSuccess,
  requireThat,
  run,
  save,
  sha256,
  verifyMetadata,
  type LocalToolCaseId,
} from './harness'
import { packCatalog } from './pack-scenarios'

export async function localToolRewriteScenario(id: LocalToolCaseId, logRoot: string) {
  requireThat(existsSync('/.dockerenv'), `${id} requires the native Docker runner`)
  verifyMetadata(sha256('/native/bin/codex'))
  const denied = id === 'LOCAL-DENY'
  const logs = join(logRoot, id)
  mkdirSync(logs)
  const base = mkdtempSync('/tmp/clooks-native-local-tool-')
  const home = join(base, 'home'),
    codexHome = join(base, 'codex'),
    project = join(base, 'project'),
    payloadDir = join(logs, 'payloads'),
    hookLog = join(logs, 'handlers.jsonl')
  for (const dir of [home, codexHome, project, payloadDir])
    mkdirSync(dir, dir === home ? { mode: 0o700 } : {})
  const clooksSha256 = sha256('/app/dist/clooks')
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
  const callId = id.toLowerCase().replaceAll('-', '_')
  const reason = `local-plan-denied-${callId}`
  const original = {
    explanation: `original-explanation-${callId}`,
    plan: [
      { step: `original-step-${callId}`, status: 'in_progress' },
      { step: `untouched-step-${callId}`, status: 'pending' },
    ],
  }
  const rewritten = {
    explanation: `rewritten-explanation-${callId}`,
    plan: [{ ...original.plan[0]!, step: `rewritten-step-${callId}` }, original.plan[1]!],
  }
  const expectedOutput = denied
    ? `Tool call blocked by PreToolUse hook: ${reason}. Tool: update_plan`
    : 'Plan updated'
  const invocation = {
    type: 'function_call',
    call_id: callId,
    name: 'update_plan',
    arguments: JSON.stringify(original),
  }
  const message = {
    type: 'message',
    role: 'assistant',
    id: `${callId}_done`,
    content: [{ type: 'output_text', text: 'Local tool check complete.' }],
  }
  // No tool result or rewritten content is supplied by the scripted assistant.
  const server = startFixture(
    [
      (request: CapturedRequest) => {
        const plans =
          request.body.tools?.filter(
            (tool: any) => tool.type === 'function' && tool.name === 'update_plan',
          ) ?? []
        requireThat(
          plans.length === 1 &&
            plans[0].parameters?.type === 'object' &&
            plans[0].parameters.properties?.explanation?.type === 'string' &&
            plans[0].parameters.properties?.plan?.type === 'array',
          'Native update_plan object tool with explanation and plan not advertised',
        )
        return invocation
      },
      (request: CapturedRequest) => {
        const outputs = request.body.input.filter(
          (item: any) => item.type === 'function_call_output',
        )
        requireThat(
          outputs.length === 1 &&
            outputs[0].call_id === callId &&
            outputs[0].output === expectedOutput,
          'Subsequent model request lacks exact native plan feedback on its call ID',
        )
        return message
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
      15000,
    )
    requireSuccess(init)
    requireThat(JSON.parse(init.stdout).ok === true, 'Local tool generated registration failed')
    const registrations = join(project, '.codex/hooks.json')
    const entrypoint = join(project, '.clooks/bin/entrypoint.sh')
    cpSync(registrations, join(logs, 'generated-hooks.json'))
    cpSync(entrypoint, join(logs, 'generated-entrypoint.sh'))
    const hook = `import { appendFileSync } from 'node:fs'
const capture = (ctx, decision) => appendFileSync(${JSON.stringify(hookLog)}, JSON.stringify({ event: ctx.event, callId: ctx.toolUseId, toolName: ctx.toolName, input: ctx.toolInput, response: ctx.toolResponse, decision }) + '\\n')
export const hook = {
  meta: { name: 'local-tool-rewrite' },
  PreToolUse(ctx) {
    if (ctx.toolName !== 'update_plan') return ctx.skip()
    capture(ctx, ${JSON.stringify(denied ? 'block' : 'allow')})
    ${
      denied
        ? `return ctx.block({ reason: ${JSON.stringify(reason)} })`
        : `return ctx.allow({ updatedInput: {
      ...ctx.toolInput,
      explanation: ${JSON.stringify(rewritten.explanation)},
      plan: ctx.toolInput.plan.map((entry, index) => index === 0 ? { ...entry, step: ${JSON.stringify(rewritten.plan[0]!.step)} } : entry)
    } })`
    }
  },
  PostToolUse(ctx) {
    if (ctx.toolName !== 'update_plan') return ctx.skip()
    capture(ctx, 'skip')
    return ctx.skip()
  }
}
`
    writeFileSync(join(project, '.clooks/hooks/local-tool-rewrite.ts'), hook)
    writeFileSync(join(logs, 'hook.ts.txt'), hook)
    const config = {
      version: '1.0.0',
      'local-tool-rewrite': {
        uses: './.clooks/hooks/local-tool-rewrite.ts',
        handoff: false,
        maxFailures: 0,
      },
    }
    writeFileSync(join(project, '.clooks/clooks.yml'), JSON.stringify(config))
    save(join(logs, 'clooks-config.json'), config)
    save(join(logs, 'expected.json'), { callId, original, rewritten, expectedOutput })
    save(join(codexHome, 'models.json'), packCatalog)
    cpSync(join(codexHome, 'models.json'), join(logs, 'models.json'))
    const toml = `model = "gpt-5.1-codex"
model_catalog_json = ${JSON.stringify(join(codexHome, 'models.json'))}
model_provider = "native_fixture"
approval_policy = "never"
[tools.update_plan]
enabled = true
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
    writeFileSync(join(codexHome, 'config.toml'), toml)
    writeFileSync(join(logs, 'config.toml'), toml)
    // JSON exec events omit explanation; the native human renderer prints the full PlanUpdate.
    const result = await run(
      [
        '/native/bin/codex',
        'exec',
        '--skip-git-repo-check',
        '--dangerously-bypass-hook-trust',
        '--color',
        'never',
        '--sandbox',
        'danger-full-access',
        'Execute the scripted local tool once, then finish.',
      ],
      project,
      env,
      join(logs, 'native'),
      60000,
    )
    requireSuccess(result)
    server.assertComplete()
    const captures = readCaptures(payloadDir, hookLog)
    save(join(logs, 'captures.json'), captures)
    const pre = captures.payloads.filter((p: any) => p.hook_event_name === 'PreToolUse')
    const post = captures.payloads.filter((p: any) => p.hook_event_name === 'PostToolUse')
    const preHandlers = captures.handlers.filter((h: any) => h.event === 'PreToolUse')
    const postHandlers = captures.handlers.filter((h: any) => h.event === 'PostToolUse')
    requireThat(
      pre.length === 1 &&
        pre[0].tool_use_id === callId &&
        pre[0].tool_name === 'update_plan' &&
        isDeepStrictEqual(pre[0].tool_input, original),
      'Native plan PreToolUse input or identity differs',
    )
    requireThat(
      preHandlers.length === 1 &&
        preHandlers[0].callId === callId &&
        preHandlers[0].toolName === 'update_plan' &&
        preHandlers[0].decision === (denied ? 'block' : 'allow') &&
        isDeepStrictEqual(preHandlers[0].input, original),
      'Normalized plan PreToolUse input or decision differs',
    )
    requireThat(
      typeof pre[0].session_id === 'string' &&
        pre[0].session_id.length > 0 &&
        pre[0].cwd === project,
      'Missing disposable native plan session identity',
    )
    const transcriptPath = pre[0].transcript_path
    requireThat(
      typeof transcriptPath === 'string' && existsSync(transcriptPath),
      'Missing native transcript',
    )
    cpSync(transcriptPath, join(logs, 'transcript.jsonl'))
    const transcript = readFileSync(transcriptPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const transcriptOutputs = transcript.filter(
      (item: any) =>
        item.type === 'response_item' &&
        item.payload?.type === 'function_call_output' &&
        item.payload.call_id === callId,
    )
    requireThat(
      transcriptOutputs.length === 1 && transcriptOutputs[0].payload.output === expectedOutput,
      'Native transcript lacks exact attributed tool output',
    )
    const nativeOutput = result.stdout + '\n' + result.stderr
    if (denied) {
      requireThat(post.length === 0 && postHandlers.length === 0, 'Denied plan emitted PostToolUse')
      for (const input of [original, rewritten]) {
        requireThat(
          !nativeOutput.includes(input.explanation) &&
            input.plan.every((entry) => !nativeOutput.includes(entry.step)),
          'Denied tool emitted a native plan update',
        )
      }
    } else {
      requireThat(
        post.length === 1 &&
          post[0].tool_use_id === callId &&
          post[0].session_id === pre[0].session_id &&
          post[0].tool_name === 'update_plan' &&
          isDeepStrictEqual(post[0].tool_input, rewritten) &&
          post[0].tool_response === 'Plan updated',
        'Native plan PostToolUse did not preserve exactly the rewritten arguments and output',
      )
      requireThat(
        postHandlers.length === 1 &&
          postHandlers[0].callId === callId &&
          postHandlers[0].toolName === 'update_plan' &&
          isDeepStrictEqual(postHandlers[0].input, rewritten) &&
          postHandlers[0].response === 'Plan updated',
        'Normalized plan PostToolUse differs',
      )
      const lines = result.stderr.split('\n')
      const explanationIndex = lines.indexOf(rewritten.explanation)
      requireThat(
        explanationIndex >= 0 &&
          lines.filter((line) => line === rewritten.explanation).length === 1 &&
          lines[explanationIndex + 1] === `  \u2192 ${rewritten.plan[0]!.step}` &&
          lines[explanationIndex + 2] === `  \u2022 ${rewritten.plan[1]!.step}` &&
          !nativeOutput.includes(original.explanation) &&
          !nativeOutput.includes(original.plan[0]!.step),
        'Native PlanUpdate renderer did not receive the rewritten explanation and exact preserved plan',
      )
    }
    requireThat(
      sha256(registrations) === sha256(join(logs, 'generated-hooks.json')) &&
        sha256(entrypoint) === sha256(join(logs, 'generated-entrypoint.sh')),
      'Generated registration changed during local tool scenario',
    )
    requireThat(
      sha256('/app/dist/clooks') === clooksSha256,
      'Clooks changed during local tool scenario',
    )
    save(join(logs, 'passed.json'), {
      id,
      status: 'passed',
      clooksSha256,
      callId,
      session: pre[0].session_id,
      nativeRequests: 2,
      planUpdates: denied ? 0 : 1,
      postToolUse: !denied,
      evidence:
        'Native update_plan renderer, raw/normalized hooks and call-ID-matched real tool feedback',
      limitations: [
        'synthetic local provider/catalog',
        'synthetic project trust',
        'hook-trust bypass',
        'danger-full-access',
        'no approval retry',
      ],
    })
  } catch (error) {
    save(join(logs, 'failure.json'), {
      id,
      error: String(error),
      stack: error instanceof Error ? error.stack : null,
    })
    throw error
  } finally {
    save(join(logs, 'fixture-errors.json'), server.errors)
    await server.stop()
    rmSync(base, { recursive: true, force: true })
  }
}
