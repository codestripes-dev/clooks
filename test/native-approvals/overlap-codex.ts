import assert from 'node:assert/strict'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { journal, log, read } from '../fixtures/interactive-approvals/channel'
import {
  completeOverlapTurn,
  loadOverlap,
  respondOverlap,
} from '../fixtures/interactive-approvals/overlap-responder'
import { packCatalog } from '../native-codex/pack-scenarios'
import { fixtures, launch, save, setup } from './native'

export async function launchOverlapCodex(
  r: ReturnType<typeof setup>,
  port: number,
  expectedResponses = 3,
) {
  save(join(r.config, 'hooks.json'), r.hooks)
  save(join(r.config, 'models.json'), packCatalog)
  writeFileSync(
    join(r.config, 'config.toml'),
    `model = "gpt-5.1-codex"
model_catalog_json = ${JSON.stringify(join(r.config, 'models.json'))}
model_provider = "native_fixture"
approval_policy = "on-request"
[projects.${JSON.stringify(r.project)}]
trust_level = "trusted"
[features]
multi_agent = true
multi_agent_v2 = false
enable_request_compression = false
remote_plugin = false
[mcp_servers.checkpoints]
command = "bun"
args = ${JSON.stringify([join(fixtures, 'mcp.ts')])}
startup_timeout_sec = 10
tool_timeout_sec = 330
[mcp_servers.checkpoints.env]
HOME = ${JSON.stringify(r.home)}
APPROVAL_LOG_ROOT = ${JSON.stringify(r.root)}
APPROVAL_SHARED_HOME = "1"
APPROVAL_CASE = "overlap"
[model_providers.native_fixture]
name = "Local fixture"
base_url = "http://127.0.0.1:${port}/v1"
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
  await launch(r, ['/native/codex', 'app-server'], r.env, async (child, signal) => {
    const pending = new Map<
      number,
      { resolve: (result: any) => void; reject: (error: Error) => void }
    >()
    const turns = new Map<string, AbortController>()
    const ended = new Set<string>()
    const tasks: Promise<void>[] = []
    const errors: string[] = []
    let sequence = 0,
      settled = 0,
      parent = ''
    let complete!: () => void, fail!: (error: unknown) => void
    const done = new Promise<void>((resolve, reject) => {
      complete = resolve
      fail = reject
    })
    void done.catch(() => {})
    const send = (message: unknown) => {
      appendFileSync(join(r.root, 'outgoing.jsonl'), JSON.stringify(message) + '\n')
      child.stdin!.write(JSON.stringify(message) + '\n')
    }
    const rpc = (method: string, params: unknown) =>
      new Promise<any>((resolve, reject) => {
        const id = ++sequence
        pending.set(id, { resolve, reject })
        send({ id, method, params })
      })
    const failed = (error: unknown) => {
      errors.push(String(error))
      fail(error)
    }
    let parentCompleted = false
    let primingPermissionResponded = false
    const exited = (code: number | null, signal: NodeJS.Signals | null) => {
      if (!parentCompleted)
        failed(new Error(`Native app-server exited before parent completion: ${code}/${signal}`))
    }
    child.once('exit', exited)
    const aborted = () => fail(signal.reason)
    signal.addEventListener('abort', aborted, { once: true })
    const reader = createInterface({ input: child.stdout! }).on('line', (line) => {
      try {
        const message = JSON.parse(line)
        appendFileSync(join(r.root, 'appserver.jsonl'), line + '\n')
        if (!message.method && pending.has(message.id)) {
          const callback = pending.get(message.id)!
          pending.delete(message.id)
          if (message.error) callback.reject(new Error(JSON.stringify(message.error)))
          else callback.resolve(message.result)
        }
        if (message.method === 'mcpServer/elicitation/request') {
          assert.equal(message.params.serverName, 'checkpoints')
          if (message.params._meta?.codex_approval_kind === 'mcp_tool_call') {
            const manifest = loadOverlap(r.root)
            assert.equal(manifest.agent, 'codex')
            assert.equal(manifest.topology, 'parent-child')
            assert.ok(manifest.primedChildControl && !manifest.serialChildControl)
            assert.ok(!primingPermissionResponded, 'Repeated native priming permission')
            const priming = read(join(r.root, 'overlap-priming-request.json'))
            assert.ok(priming)
            assert.equal(priming.args.tool_use_id, manifest.primedChildControl.callId)
            assert.ok(!manifest.calls[priming.args.tool_use_id])
            assert.equal(priming.args.agent, manifest.agent)
            assert.equal(priming.args.owner, manifest.owner)
            assert.equal(priming.args.session_id, parent)
            assert.notEqual(priming.child, parent)
            assert.equal(message.params.threadId, priming.child)
            assert.equal(message.params.turnId, priming.args.turn_id)
            assert.ok(!ended.has(JSON.stringify([priming.child, priming.args.turn_id])))
            assert.deepEqual(message.params._meta.tool_params, priming.args)
            assert.equal(message.params.mode, 'form')
            assert.equal(
              message.params.message,
              'Allow the checkpoints MCP server to run tool "check"?',
            )
            assert.deepEqual(message.params.requestedSchema, { type: 'object', properties: {} })
            const result = { action: 'accept', content: {}, _meta: null }
            primingPermissionResponded = true
            send({ id: message.id, result })
            log(
              'native-priming-permission-response',
              {
                requestId: message.id,
                threadId: priming.child,
                turnId: priming.args.turn_id,
                callId: priming.args.tool_use_id,
                result,
                diagnosticOnly: true,
              },
              r.root,
            )
            return
          }
          const question = JSON.parse(message.params.message)
          const commands = journal(r.root).filter(
            (row) =>
              row.event === 'command-start' && row.key.tool_use_id === question.key.tool_use_id,
          )
          assert.equal(commands.length, 1)
          assert.deepEqual(question.key, commands[0].key)
          assert.equal(
            message.params.threadId,
            commands[0].input.agent_id ?? commands[0].input.session_id,
          )
          assert.equal(message.params.turnId, commands[0].input.turn_id)
          const turn = JSON.stringify([message.params.threadId, message.params.turnId])
          assert.ok(!ended.has(turn), 'Elicitation after its native turn ended')
          let controller = turns.get(turn)
          if (!controller) {
            controller = new AbortController()
            turns.set(turn, controller)
          }
          const responseSignal = AbortSignal.any([signal, controller.signal])
          tasks.push(
            respondOverlap(message.params.message, { directory: r.root, signal: responseSignal })
              .then((result) => {
                responseSignal.throwIfAborted()
                send({ id: message.id, result: { ...result, _meta: null } })
              })
              .catch((error) => {
                if (
                  !responseSignal.aborted ||
                  (error !== responseSignal.reason && error?.name !== 'AbortError')
                )
                  failed(error)
              })
              .finally(() => {
                settled++
              }),
          )
        } else if (message.method && message.id !== undefined)
          throw new Error(`Unexpected native request ${message.method}`)
        if (message.method === 'turn/completed') {
          assert.equal(message.params.turn.status, 'completed')
          // A real child's completion cannot cancel the parent's pending response.
          completeOverlapTurn(turns, ended, message.params.threadId, message.params.turn.id)
          if (message.params.threadId === parent) {
            parentCompleted = true
            complete()
          }
        }
      } catch (error) {
        failed(error)
      }
    })
    const flow = async () => {
      signal.throwIfAborted()
      await rpc('initialize', {
        clientInfo: { name: 'm1_native_overlap', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      })
      send({ method: 'initialized', params: {} })
      const thread = await rpc('thread/start', {
        cwd: r.project,
        model: 'gpt-5.1-codex',
        modelProvider: 'native_fixture',
        approvalPolicy: 'on-request',
        sandbox: 'danger-full-access',
        config: { bypass_hook_trust: true },
      })
      parent = thread.thread.id
      save(join(r.root, 'thread-start.json'), thread)
      const turn = await rpc('turn/start', {
        threadId: parent,
        input: [{ type: 'text', text: 'Run the local overlap test once.', text_elements: [] }],
      })
      save(join(r.root, 'turn-start.json'), turn)
      await done
    }
    const running = flow()
    try {
      await Promise.race([running, done])
    } finally {
      for (const controller of turns.values())
        controller.abort(new Error('Native overlap driver closed'))
      reader.close()
      child.removeListener('exit', exited)
      signal.removeEventListener('abort', aborted)
      for (const callback of pending.values())
        callback.reject(new Error('Native overlap driver closed'))
      pending.clear()
      await running.catch(() => {})
      await Promise.all(tasks)
      save(join(r.root, 'responders.json'), {
        started: tasks.length,
        settled,
        pending: tasks.length - settled,
        errors,
        turns: [...turns.keys()],
        ended: [...ended],
        at: Date.now(),
      })
    }
    assert.deepEqual(errors, [])
    assert.equal(tasks.length, expectedResponses)
    assert.equal(settled, expectedResponses)
  })
}
