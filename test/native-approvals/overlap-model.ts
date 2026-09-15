import assert from 'node:assert/strict'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { identity, journal, log, read } from '../fixtures/interactive-approvals/channel'
import type { OverlapManifest } from '../fixtures/interactive-approvals/overlap-responder'
import { save } from './native'

export function advertisedTool(body: any, name: string, namespace?: string) {
  const tools = namespace
    ? body.tools?.find((tool: any) => tool.type === 'namespace' && tool.name === namespace)?.tools
    : body.tools
  const tool = tools?.find((tool: any) => tool.name === name)
  assert.ok(tool, `Native tool not advertised: ${namespace ? namespace + '.' : ''}${name}`)
  return tool.input_schema ?? tool.parameters
}

export function checkArguments(schema: any, args: Record<string, unknown>) {
  assert.ok(schema?.properties, 'Missing advertised input schema')
  for (const key of Object.keys(args)) {
    assert.ok(key in schema.properties, `Argument not advertised: ${key}`)
  }
  const result = new AjvJsonSchemaValidator().getValidator(schema)(args)
  assert.ok(result.valid, result.errorMessage)
}

export function claudeHello(provider: OverlapManifest['provider'], request: Request) {
  return (
    provider === 'claude' &&
    request.method === 'HEAD' &&
    new URL(request.url).pathname === '/api/hello'
  )
}

export function claudeSpawnId(directory: string, callId: string, output: any) {
  assert.ok(output.is_error === undefined || output.is_error === false)
  assert.equal(output.tool_use_id, callId)
  const posts = journal(directory).filter(
    (row) =>
      row.event === 'native-post' &&
      row.input?.hook_event_name === 'PostToolUse' &&
      row.input.tool_use_id === callId,
  )
  assert.equal(posts.length, 1)
  assert.equal(posts[0].input.tool_name, 'Agent')
  const result = posts[0].input.tool_response
  assert.equal(result.isAsync, true)
  assert.equal(result.status, 'async_launched')
  assert.ok(typeof result.agentId === 'string' && result.agentId.length > 0)
  const text =
    typeof output.content === 'string'
      ? output.content
      : output.content.map((entry: any) => entry.text ?? '').join('\n')
  assert.ok(
    text.includes(`agentId: ${result.agentId} `),
    'Native Agent result differs from its structured PostToolUse identity',
  )
  return result.agentId as string
}

export function assertColdChildRefusal(
  directory: string,
  manifest: OverlapManifest,
  callId: string,
  output: any,
) {
  assert.equal(manifest.provider, 'codex')
  assert.equal(manifest.serialChildControl, true)
  assert.equal(output.call_id, callId)
  assert.equal(
    output.output,
    `Command blocked by PreToolUse hook: Error: MCP peer unavailable. Command: ${manifest.calls[callId]!.operation.input.command}`,
  )
  const rows = journal(directory).filter((row) => row.key?.tool_use_id === callId)
  const commands = rows.filter((row) => row.event === 'command-start')
  assert.equal(commands.length, 1)
  const command = commands[0]
  const finished = rows.filter((row) => row.event === 'command-finished')
  assert.equal(finished.length, 1)
  assert.deepEqual(finished[0].output, {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Error: MCP peer unavailable',
    },
  })
  assert.ok(!rows.some((row) => row.event === 'mcp-call'))
  assert.ok(typeof command.input.agent_id === 'string' && command.input.agent_id.length > 0)
  const messages = readFileSync(join(directory, 'appserver.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const failures = messages.filter(
    (message) =>
      message.method === 'hook/completed' &&
      message.params.threadId === command.input.agent_id &&
      message.params.turnId === command.key.turn_id &&
      message.params.run.handlerType === 'mcpTool' &&
      message.params.run.id.endsWith(`:${callId}`),
  )
  assert.equal(failures.length, 1)
  assert.equal(failures[0].params.run.status, 'failed')
  assert.equal(failures[0].params.run.durationMs, 0)
  assert.deepEqual(failures[0].params.run.entries, [
    { kind: 'error', text: "MCP server 'checkpoints' is not connected" },
  ])
}

export function overlapModel(directory: string, manifest: OverlapManifest) {
  const ids = Object.keys(manifest.calls)
  const a = ids.find((id) => manifest.calls[id]!.label === 'A')!
  const b = ids.find((id) => manifest.calls[id]!.label === 'B')!
  const childPrompt = `OVERLAP_CHILD_${b}`
  const spawnId = `overlap_spawn_${a}`
  const waitId = `overlap_wait_${a}`
  let parent = '',
    child = '',
    spawned = '',
    task = ''
  let parentStep = 0,
    childStep = 0,
    sequence = 0
  const errors: string[] = [],
    requests: any[] = []
  const results = new Map<string, any>()
  const observed = new Set<string>()
  const message = (text: string) =>
    manifest.provider === 'claude'
      ? { type: 'text' as const, text }
      : { type: 'message' as const, role: 'assistant', content: [{ type: 'output_text', text }] }
  const call = (
    body: any,
    id: string,
    name: string,
    args: Record<string, unknown>,
    namespace?: string,
  ) => {
    checkArguments(advertisedTool(body, name, namespace), args)
    return manifest.provider === 'claude'
      ? { type: 'tool_use' as const, id, name, input: args }
      : {
          type: 'function_call' as const,
          call_id: id,
          name,
          arguments: JSON.stringify(args),
          ...(namespace ? { namespace } : {}),
        }
  }
  const effect = (body: any, id: string) => {
    assert.ok(!observed.has(id), 'Script attempted to replay original native operation')
    observed.add(id)
    return manifest.provider === 'claude'
      ? call(body, id, 'Bash', manifest.calls[id]!.operation.input)
      : call(body, id, 'exec_command', {
          cmd: manifest.calls[id]!.operation.input.command,
          workdir: join(directory, 'project'),
          yield_time_ms: 1000,
        })
  }
  const feedback = (body: any, id: string) => {
    const outputs =
      manifest.provider === 'claude'
        ? body.messages
            .flatMap((entry: any) => (Array.isArray(entry.content) ? entry.content : []))
            .filter((entry: any) => entry.type === 'tool_result' && entry.tool_use_id === id)
        : body.input.filter(
            (entry: any) => entry.type === 'function_call_output' && entry.call_id === id,
          )
    assert.equal(outputs.length, 1, `Missing unique original native result: ${id}`)
    return outputs[0]
  }
  const recordEffect = (body: any, id: string, recipient: string) => {
    const output = feedback(body, id)
    if (id === a) {
      assert.ok(JSON.stringify(output).includes(`overlap-native-effect:${a}`))
      if (manifest.provider === 'claude') assert.equal(output.is_error, false)
      else assert.ok(output.output.includes('Process exited with code 0'))
    } else {
      if (manifest.serialChildControl) assertColdChildRefusal(directory, manifest, id, output)
      else assert.ok(JSON.stringify(output).includes('Checkpoint 1 declined'))
      if (manifest.provider === 'claude') assert.equal(output.is_error, true)
    }
    assert.ok(!results.has(id), 'Original result consumed twice')
    results.set(id, output)
    log('overlap-native-result', { callId: id, recipient, output }, directory)
  }
  const route = (body: any, headers: Record<string, string>, index: number) => {
    let isChild = false
    if (manifest.provider === 'codex') {
      const thread = headers['x-client-request-id']
      assert.ok(typeof thread === 'string' && thread.length)
      if (!parent) parent = thread
      isChild = thread !== parent
      if (isChild) {
        assert.ok(!child || child === thread, 'Unexpected third native thread')
        child = thread
        if (spawned) assert.equal(child, spawned)
      }
    } else {
      const session = headers['x-claude-code-session-id']
      assert.ok(typeof session === 'string' && session.length > 0)
      if (!parent) parent = session
      assert.equal(session, parent)
      const agent = headers['x-claude-code-agent-id']
      isChild = agent !== undefined
      if (agent !== undefined) {
        assert.ok(agent.length > 0 && (!child || child === agent))
        child = agent
        if (task) assert.equal(child, task)
      }
    }
    const recipient = isChild ? 'child' : 'parent'
    appendFileSync(
      join(directory, 'overlap-routing.jsonl'),
      JSON.stringify({
        request: index,
        recipient,
        parent,
        child,
        parentStep,
        childStep,
        headers,
      }) + '\n',
    )
    if (manifest.topology === 'same-session') {
      assert.ok(!isChild)
      if (parentStep++ === 0) return [effect(body, a), effect(body, b)]
      assert.equal(parentStep, 2)
      recordEffect(body, a, recipient)
      recordEffect(body, b, recipient)
      return [message('OVERLAP_COMPLETE')]
    }
    if (isChild) {
      if (manifest.primedChildControl) {
        const id = manifest.primedChildControl.callId
        if (childStep++ === 0) {
          const metadata = JSON.parse(headers['x-codex-turn-metadata']!)
          assert.equal(metadata.session_id, parent)
          assert.equal(metadata.thread_id, child)
          const args = {
            protocol: 1,
            provider: manifest.provider,
            owner: manifest.owner,
            session_id: metadata.session_id,
            turn_id: metadata.turn_id,
            tool_use_id: id,
          }
          const tool = call(body, id, 'check', args, 'mcp__checkpoints')
          save(join(directory, 'overlap-priming-request.json'), {
            child,
            key: identity(args),
            args,
          })
          return [tool]
        }
        if (childStep === 2) {
          const output = feedback(body, id)
          const text =
            typeof output.output === 'string'
              ? [output.output]
              : output.output
                  .filter((part: any) => part.type === 'input_text')
                  .map((part: any) => part.text)
          assert.ok(text.some((part: string) => part === '{}' || part.endsWith('\n{}')))
          const request = read(join(directory, 'overlap-priming-request.json'))
          const rows = journal(directory).filter((row) => row.key?.tool_use_id === id)
          assert.deepEqual(
            rows.map((row) => row.event),
            ['mcp-call', 'mcp-unmatched', 'mcp-finished'],
          )
          assert.deepEqual(rows[0].key, request.key)
          assert.deepEqual(rows[2].output, {})
          save(join(directory, 'overlap-priming-result.json'), output)
          return [effect(body, b)]
        }
        assert.equal(childStep, 3)
        recordEffect(body, b, recipient)
        return [message('OVERLAP_CHILD_COMPLETE')]
      }
      if (childStep++ === 0) return [effect(body, b)]
      assert.equal(childStep, 2)
      recordEffect(body, b, recipient)
      return [message('OVERLAP_CHILD_COMPLETE')]
    }
    const spawn = () => [
      manifest.provider === 'claude'
        ? call(body, spawnId, 'Agent', {
            description: 'Overlap approval child',
            prompt: childPrompt,
            subagent_type: 'general-purpose',
            run_in_background: true,
          })
        : call(
            body,
            spawnId,
            'spawn_agent',
            { message: childPrompt, fork_context: false },
            'multi_agent_v1',
          ),
    ]
    const captureSpawn = () => {
      const output = feedback(body, spawnId)
      save(join(directory, 'overlap-spawn-result.json'), output)
      if (manifest.provider === 'codex') {
        spawned = JSON.parse(output.output).agent_id
        assert.ok(typeof spawned === 'string' && spawned !== parent)
        if (child) assert.equal(child, spawned)
      } else {
        task = claudeSpawnId(directory, spawnId, output)
        if (child) assert.equal(child, task)
      }
    }
    const waitForChild = () => [
      manifest.provider === 'claude'
        ? call(body, waitId, 'TaskOutput', { task_id: task, block: true, timeout: 30000 })
        : call(
            body,
            waitId,
            'wait_agent',
            { targets: [spawned], timeout_ms: 30000 },
            'multi_agent_v1',
          ),
    ]
    switch (parentStep++) {
      case 0:
        return manifest.serialChildControl ? [effect(body, a)] : spawn()
      case 1:
        if (manifest.serialChildControl) {
          recordEffect(body, a, recipient)
          return spawn()
        }
        captureSpawn()
        return [effect(body, a)]
      case 2:
        if (manifest.serialChildControl) captureSpawn()
        else recordEffect(body, a, recipient)
        return waitForChild()
      case 3: {
        const output = feedback(body, waitId)
        assert.ok(JSON.stringify(output).includes('OVERLAP_CHILD_COMPLETE'))
        assert.equal(childStep, manifest.primedChildControl ? 3 : 2)
        save(join(directory, 'overlap-wait-result.json'), output)
        return [message('OVERLAP_COMPLETE')]
      }
      default:
        throw new Error('Unexpected parent continuation')
    }
  }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (claudeHello(manifest.provider, request)) {
        appendFileSync(
          join(directory, 'overlap-auxiliary.jsonl'),
          JSON.stringify({ method: request.method, path: '/api/hello', at: Date.now() }) + '\n',
        )
        return new Response(null, { status: 200 })
      }
      const index = ++sequence
      try {
        assert.equal(request.method, 'POST')
        assert.equal(
          new URL(request.url).pathname,
          manifest.provider === 'claude' ? '/v1/messages' : '/v1/responses',
        )
        const body = await request.json()
        const headers = Object.fromEntries(request.headers)
        save(join(directory, `overlap-request-${index}.json`), {
          body,
          headers,
          path: new URL(request.url).pathname,
        })
        requests.push(body)
        const items = route(body, headers, index)
        const event = (type: string, value: unknown) =>
          `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`
        let wire: string
        if (manifest.provider === 'codex') {
          const id = `overlap_response_${index}`
          wire =
            event('response.created', { type: 'response.created', response: { id } }) +
            items
              .map((item) =>
                event('response.output_item.done', { type: 'response.output_item.done', item }),
              )
              .join('') +
            event('response.completed', {
              type: 'response.completed',
              response: { id, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
            })
        } else {
          const stop = items.some((item) => item.type === 'tool_use') ? 'tool_use' : 'end_turn'
          const message = {
            id: `overlap_message_${index}`,
            type: 'message',
            role: 'assistant',
            model: body.model,
            content: items,
            stop_reason: stop,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10 },
          }
          if (!body.stream) return Response.json(message)
          wire = event('message_start', {
            type: 'message_start',
            message: { ...message, content: [], stop_reason: null },
          })
          items.forEach((item, index) => {
            assert.ok(item.type === 'tool_use' || item.type === 'text')
            const tool = item.type === 'tool_use'
            wire += event('content_block_start', {
              type: 'content_block_start',
              index,
              content_block: tool ? { ...item, input: {} } : { type: 'text', text: '' },
            })
            wire += event('content_block_delta', {
              type: 'content_block_delta',
              index,
              delta: tool
                ? { type: 'input_json_delta', partial_json: JSON.stringify(item.input) }
                : { type: 'text_delta', text: item.text },
            })
            wire += event('content_block_stop', { type: 'content_block_stop', index })
          })
          wire +=
            event('message_delta', {
              type: 'message_delta',
              delta: { stop_reason: stop, stop_sequence: null },
              usage: { output_tokens: 10 },
            }) + event('message_stop', { type: 'message_stop' })
        }
        save(join(directory, `overlap-response-${index}.json`), items)
        return new Response(wire, { headers: { 'content-type': 'text/event-stream' } })
      } catch (error) {
        errors.push(String(error))
        return Response.json({ error: String(error) }, { status: 400 })
      }
    },
  })
  return {
    port: server.port,
    results,
    errors,
    stop: () => server.stop(true),
    verify() {
      assert.deepEqual(errors, [])
      assert.equal(results.size, 2)
      assert.equal(parentStep, manifest.topology === 'same-session' ? 2 : 4)
      if (manifest.topology === 'parent-child') {
        assert.equal(childStep, manifest.primedChildControl ? 3 : 2)
        if (manifest.provider === 'codex') assert.equal(child, spawned)
      }
      return { parent, child, spawned, task, requests: requests.length }
    },
  }
}
