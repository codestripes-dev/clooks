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
} from './harness'
import { packCatalog } from './pack-scenarios'

export async function mcpObservationScenario(logRoot: string) {
  requireThat(existsSync('/.dockerenv'), 'MCP-OBSERVATION requires the native Docker runner')
  verifyMetadata(sha256('/native/bin/codex'))
  const id = 'MCP-OBSERVATION',
    logs = join(logRoot, id)
  mkdirSync(logs)
  const base = mkdtempSync('/tmp/clooks-native-mcp-')
  const home = join(base, 'home'),
    codexHome = join(base, 'codex'),
    project = join(base, 'project')
  const payloadDir = join(logs, 'payloads'),
    hookLog = join(logs, 'handlers.jsonl'),
    rpcLog = join(logs, 'mcp.jsonl')
  for (const dir of [home, codexHome, project, payloadDir]) mkdirSync(dir)
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
  const toolName = 'mcp__observation__echo'
  const malformed = [
    { label: 'null', arguments: 'null', value: null },
    {
      label: 'array',
      arguments: '[1,null,{"nested":[false,"opaque"]}]',
      value: [1, null, { nested: [false, 'opaque'] }],
    },
    { label: 'number', arguments: '42.5', value: 42.5 },
    { label: 'boolean', arguments: 'false', value: false },
    { label: 'json-string', arguments: '"literal MCP string"', value: 'literal MCP string' },
    {
      label: 'raw-string',
      arguments: '  {not-valid-json:\nraw-MCP-input  ',
      value: '  {not-valid-json:\nraw-MCP-input  ',
    },
  ]
  const original = { message: 'original-object', nested: { preserve: [null, false, 7] } }
  const rewritten = { message: 'rewritten-object', nested: original.nested }
  const cases = [
    ...malformed,
    { label: 'rewrite', arguments: JSON.stringify(original), value: original },
  ]
  const observations: unknown[] = []
  const rpc = () =>
    readFileSync(rpcLog, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  const calls = () =>
    rpc().filter(
      (entry: any) => entry.direction === 'request' && entry.message.method === 'tools/call',
    )
  const invocation = (index: number) => ({
    type: 'function_call',
    call_id: `mcp_observe_${index}`,
    namespace: 'mcp__observation',
    name: 'echo',
    arguments: cases[index]!.arguments,
  })
  const observe = (request: CapturedRequest, index: number) => {
    const entry = cases[index]!,
      callId = `mcp_observe_${index}`
    const captures = readCaptures(payloadDir, hookLog)
    const pre = captures.payloads.filter(
      (p: any) => p.hook_event_name === 'PreToolUse' && p.tool_use_id === callId,
    )
    const handlers = captures.handlers.filter(
      (h: any) => h.event === 'PreToolUse' && h.callId === callId,
    )
    const post = captures.payloads.filter(
      (p: any) => p.hook_event_name === 'PostToolUse' && p.tool_use_id === callId,
    )
    const postHandlers = captures.handlers.filter(
      (h: any) => h.event === 'PostToolUse' && h.callId === callId,
    )
    const outputs = request.body.input.filter(
      (item: any) => item.type === 'function_call_output' && item.call_id === callId,
    )
    requireThat(outputs.length === 1, `Missing native MCP feedback: ${entry.label}`)
    observations.push({
      label: entry.label,
      callId,
      pre,
      handlers,
      post,
      postHandlers,
      output: outputs[0].output,
    })
    requireThat(
      pre.length === 1 &&
        pre[0].tool_name === toolName &&
        Object.hasOwn(pre[0], 'tool_input') &&
        isDeepStrictEqual(pre[0].tool_input, entry.value),
      `Native MCP input differs: ${entry.label}`,
    )
    requireThat(
      handlers.length === 1 &&
        handlers[0].toolName === toolName &&
        Object.hasOwn(handlers[0], 'input') &&
        isDeepStrictEqual(handlers[0].input, entry.value),
      `Normalized MCP input differs: ${entry.label}`,
    )
    if (index < malformed.length) {
      requireThat(
        handlers[0].decision === 'block' &&
          typeof outputs[0].output === 'string' &&
          outputs[0].output ===
            `Tool call blocked by PreToolUse hook: mcp-observation-block-${callId}. Tool: ${toolName}`,
        `Malformed MCP input not blocked by hook: ${entry.label}`,
      )
      requireThat(
        calls().length === 0 && post.length === 0 && postHandlers.length === 0,
        `Blocked MCP call executed: ${entry.label}`,
      )
    } else {
      const executed = calls()
      requireThat(
        handlers[0].decision === 'allow' &&
          executed.length === 1 &&
          executed[0].message.params.name === 'echo' &&
          isDeepStrictEqual(executed[0].message.params.arguments, rewritten),
        'MCP server did not receive exactly the rewritten object',
      )
      const responses = rpc().filter(
        (record: any) =>
          record.direction === 'response' && record.message.id === executed[0].message.id,
      )
      requireThat(
        responses.length === 1 && responses[0].message.result?.isError === false,
        'Missing successful stdio MCP response',
      )
      const result = responses[0].message.result
      const returned = JSON.parse(result.content[0].text)
      requireThat(
        isDeepStrictEqual(returned.received, rewritten) &&
          typeof returned.receipt === 'string' &&
          returned.receipt.length > 0,
        'Invalid server-generated receipt',
      )
      const output = outputs[0].output
      const text =
        typeof output === 'string'
          ? [output]
          : Array.isArray(output)
            ? output.filter((part: any) => part.type === 'input_text').map((part: any) => part.text)
            : []
      requireThat(
        text.some(
          (part: string) =>
            part === result.content[0].text || part.endsWith('\n' + result.content[0].text),
        ),
        'Real MCP server response missing from subsequent native model request',
      )
      requireThat(
        post.length === 1 &&
          post[0].tool_name === toolName &&
          isDeepStrictEqual(post[0].tool_input, rewritten) &&
          isDeepStrictEqual(post[0].tool_response, result),
        'Native MCP PostToolUse differs from server result',
      )
      requireThat(
        postHandlers.length === 1 &&
          postHandlers[0].toolName === toolName &&
          isDeepStrictEqual(postHandlers[0].input, rewritten) &&
          isDeepStrictEqual(postHandlers[0].response, result),
        'Normalized MCP PostToolUse differs from server result',
      )
    }
  }
  const steps: unknown[] = [
    (request: CapturedRequest) => {
      requireThat(
        request.body.tools?.some(
          (tool: any) =>
            tool.type === 'namespace' &&
            tool.name === 'mcp__observation' &&
            tool.tools?.some(
              (child: any) => child.name === 'echo' && child.parameters?.type === 'object',
            ),
        ),
        'Native MCP object-schema tool not advertised',
      )
      return invocation(0)
    },
  ]
  for (let index = 0; index < cases.length; index++)
    steps.push((request: CapturedRequest) => {
      observe(request, index)
      return index + 1 < cases.length
        ? invocation(index + 1)
        : {
            type: 'message',
            role: 'assistant',
            id: 'mcp_observation_done',
            content: [{ type: 'output_text', text: 'MCP observation complete.' }],
          }
    })
  const server = startFixture(steps, logs)
  try {
    const init = await run(
      ['/app/dist/clooks', 'init', '--agent', 'codex', '--json'],
      project,
      env,
      join(logs, 'init'),
      15000,
    )
    requireSuccess(init)
    requireThat(JSON.parse(init.stdout).ok === true, 'MCP generated Codex registration failed')
    cpSync(join(project, '.codex/hooks.json'), join(logs, 'generated-hooks.json'))
    cpSync(join(project, '.clooks/bin/entrypoint.sh'), join(logs, 'generated-entrypoint.sh'))
    const helper = `import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
const log = (direction, message) => appendFileSync(${JSON.stringify(rpcLog)}, JSON.stringify({ direction, message }) + '\\n')
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  const request = JSON.parse(line)
  log('request', request)
  if (!Object.hasOwn(request, 'id')) continue
  let result, error
  switch (request.method) {
    case 'initialize': result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'native-observation', version: '1.0.0' } }; break
    case 'ping': result = {}; break
    case 'tools/list': result = { tools: [{ name: 'echo', description: 'Return the supplied object.', inputSchema: { type: 'object', properties: { message: { type: 'string' }, nested: { type: 'object' } }, required: ['message'] } }] }; break
    case 'tools/call': {
      const args = request.params.arguments
      if (request.params.name !== 'echo' || args === null || typeof args !== 'object' || Array.isArray(args) || typeof args.message !== 'string') error = { code: -32602, message: 'echo requires an object with message' }
      else result = { content: [{ type: 'text', text: JSON.stringify({ received: args, receipt: randomUUID() }) }], isError: false }
      break
    }
    default: error = { code: -32601, message: 'Method not found' }
  }
  const response = { jsonrpc: '2.0', id: request.id, ...(error ? { error } : { result }) }
  log('response', response)
  process.stdout.write(JSON.stringify(response) + '\\n')
}
`
    const hook = `import { appendFileSync } from 'node:fs'
const capture = (ctx, decision) => appendFileSync(${JSON.stringify(hookLog)}, JSON.stringify({ event: ctx.event, callId: ctx.toolUseId, toolName: ctx.toolName, input: ctx.toolInput, response: ctx.toolResponse, decision }) + '\\n')
export const hook = {
  meta: { name: 'mcp-observation' },
  PreToolUse(ctx) {
    if (ctx.toolName !== ${JSON.stringify(toolName)}) return ctx.skip()
    if (ctx.toolUseId === 'mcp_observe_${malformed.length}') {
      capture(ctx, 'allow')
      return ctx.allow({ updatedInput: ${JSON.stringify(rewritten)} })
    }
    capture(ctx, 'block')
    return ctx.block({ reason: 'mcp-observation-block-' + ctx.toolUseId })
  },
  PostToolUse(ctx) {
    if (ctx.toolName !== ${JSON.stringify(toolName)}) return ctx.skip()
    capture(ctx, 'skip')
    return ctx.skip()
  }
}
`
    writeFileSync(join(project, 'mcp-server.ts'), helper)
    writeFileSync(join(logs, 'mcp-server.ts.txt'), helper)
    writeFileSync(join(project, '.clooks/hooks/mcp-observation.ts'), hook)
    writeFileSync(join(logs, 'hook.ts.txt'), hook)
    const config = {
      version: '1.0.0',
      'mcp-observation': {
        uses: './.clooks/hooks/mcp-observation.ts',
        handoff: false,
        maxFailures: 0,
      },
    }
    writeFileSync(join(project, '.clooks/clooks.yml'), JSON.stringify(config))
    save(join(logs, 'clooks-config.json'), config)
    save(join(logs, 'expected.json'), { cases, rewritten })
    save(join(codexHome, 'models.json'), packCatalog)
    const toml = `model = "gpt-5.1-codex"
model_catalog_json = ${JSON.stringify(join(codexHome, 'models.json'))}
model_provider = "native_fixture"
approval_policy = "never"
[projects.${JSON.stringify(project)}]
trust_level = "trusted"
[features]
enable_request_compression = false
[mcp_servers.observation]
command = "bun"
args = [${JSON.stringify(join(project, 'mcp-server.ts'))}]
required = true
startup_timeout_sec = 10
tool_timeout_sec = 10
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
        'danger-full-access',
        'Execute the scripted local MCP observation sequence, then finish.',
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
    requireThat(
      pre.length === cases.length && post.length === 1 && calls().length === 1,
      'Unexpected native MCP execution count',
    )
    const sessions = new Set(pre.map((p: any) => p.session_id))
    requireThat(
      sessions.size === 1 &&
        typeof pre[0].session_id === 'string' &&
        pre[0].session_id.length > 0 &&
        post[0].session_id === pre[0].session_id,
      'MCP observation left its native session',
    )
    requireThat(
      sha256('/app/dist/clooks') === clooksSha256,
      'Clooks changed during MCP observation',
    )
    save(join(logs, 'passed.json'), {
      id,
      status: 'passed',
      clooksSha256,
      session: pre[0].session_id,
      blockedShapes: malformed.map((entry) => entry.label),
      nativeRequests: steps.length,
      serverExecutions: 1,
      rewritten,
      postToolUse: true,
      upstream:
        'core/src/tools/handlers/mcp.rs: mcp_hook_tool_input preserves parsed JSON or the original invalid JSON string before MCP execution',
      limitations: [
        'synthetic local provider/catalog',
        'local stdio MCP server',
        'synthetic project trust',
        'hook-trust bypass',
        'danger-full-access',
        'malformed arguments blocked before server schema validation',
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
    save(join(logs, 'observed.json'), { observations, fixtureErrors: server.errors })
    await server.stop()
    rmSync(base, { recursive: true, force: true })
  }
}
