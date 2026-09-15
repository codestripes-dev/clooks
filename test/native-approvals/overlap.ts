import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  journal,
  read,
  sharedHomeRoot,
  type Provider,
} from '../fixtures/interactive-approvals/channel'
import type { OverlapManifest } from '../fixtures/interactive-approvals/overlap-responder'
import { fixtures, launch, quote, save, setup } from './native'
import { launchOverlapCodex } from './overlap-codex'
import { overlapModel } from './overlap-model'

export type OverlapTopology =
  | OverlapManifest['topology']
  | 'serial-child-control'
  | 'primed-child-control'

export function assertOverlap(
  directory: string,
  manifest: OverlapManifest,
  native: { parent: string; child: string; spawned: string; task: string },
) {
  assert.ok(!manifest.serialChildControl, 'A serialized diagnostic cannot prove overlap')
  const rows = journal(directory)
  const a = Object.keys(manifest.calls).find((id) => manifest.calls[id]!.label === 'A')!
  const b = Object.keys(manifest.calls).find((id) => manifest.calls[id]!.label === 'B')!
  const forCall = (id: string) => rows.filter((row) => row.key?.tool_use_id === id)
  const one = (event: string, callId: string) => {
    const found = forCall(callId).filter((row) => row.event === event)
    assert.equal(found.length, 1, `${callId}: expected exactly one ${event}`)
    return found[0]
  }
  const commands = [one('command-start', a), one('command-start', b)]
  assert.notDeepEqual(commands[0].key, commands[1].key)
  assert.notEqual(commands[0].start.nonce, commands[1].start.nonce)
  assert.equal(rows.filter((row) => row.event === 'command-start').length, 2)
  assert.equal(
    rows.filter((row) => row.event === 'mcp-call').length,
    manifest.primedChildControl ? 3 : 2,
  )
  const replies = rows.filter((row) => row.event === 'ui-response')
  assert.deepEqual(
    replies.map((row) => [row.key.tool_use_id, row.ordinal, row.action]),
    [
      [a, 1, 'accept'],
      [a, 2, 'accept'],
      [b, 1, 'decline'],
    ],
  )
  const firstReply = rows.indexOf(replies[0])
  for (const id of [a, b]) {
    assert.ok(rows.indexOf(one('2-ask', id)) < firstReply)
    const questions = forCall(id).filter((row) => row.event === 'overlap-question')
    assert.deepEqual(
      questions.map((row) => row.ordinal),
      id === a ? [1, 2] : [1],
    )
    assert.equal(questions.filter((row) => row.ordinal === 1).length, 1)
    assert.ok(rows.indexOf(questions.find((row) => row.ordinal === 1)) < firstReply)
    const command = one('command-start', id)
    assert.equal(command.key.owner, manifest.owner)
    assert.equal(command.key.provider, manifest.provider)
    assert.equal(command.environment.HOME, manifest.home)
    assert.equal(command.ipcRoot, sharedHomeRoot(manifest.home))
    for (const packet of [
      ...questions,
      ...forCall(id).filter((row) => row.event === 'ui-response'),
    ]) {
      assert.deepEqual(packet.key, command.key)
      assert.equal(packet.nonce, command.start.nonce)
      assert.deepEqual(packet.operation, manifest.calls[id]!.operation)
    }
    const mcp = one('mcp-call', id)
    assert.deepEqual(mcp.key, command.key)
    const attached = one('mcp-attached', id)
    assert.equal(attached.nonce, command.start.nonce)
    assert.equal(attached.ipcRoot, command.ipcRoot)
    const events = forCall(id)
      .map((row) => row.event)
      .filter((event) => /^(?:[135]|[24]-ask|approve-[24])$/.test(event))
    assert.deepEqual(
      events,
      id === a ? ['1', '2-ask', 'approve-2', '3', '4-ask', 'approve-4', '5'] : ['1', '2-ask'],
    )
    const file = (name: string) =>
      read(
        join(
          command.ipcRoot,
          createHash('sha256').update(JSON.stringify(command.key)).digest('hex'),
          name + '.json',
        ),
      )
    for (const ordinal of id === a ? [1, 2] : [1]) {
      const reply = file(`reply-${ordinal}`)
      assert.deepEqual(reply, {
        version: 1,
        key: command.key,
        nonce: command.start.nonce,
        ordinal,
        confirmed: id === a,
      })
      assert.deepEqual(file(`ask-${ordinal}`).operation, manifest.calls[id]!.operation)
      assert.deepEqual(
        replies.find((row) => row.key.tool_use_id === id && row.ordinal === ordinal)?.operation,
        manifest.calls[id]!.operation,
      )
    }
    const actualReplies = forCall(id).filter((row) => row.event === 'mcp-response')
    assert.deepEqual(
      actualReplies.map((row) => [
        row.ordinal,
        row.reply.action,
        row.reply.content?.confirmed === true,
      ]),
      id === a
        ? [
            [1, 'accept', true],
            [2, 'accept', true],
          ]
        : [[1, 'decline', false]],
    )
    assert.equal(
      one('command-finished', id).output.hookSpecificOutput.permissionDecision,
      id === a ? 'allow' : 'deny',
    )
    const mcpOutput = one('mcp-finished', id).output
    if (id === a) assert.deepEqual(mcpOutput, {})
    else {
      assert.equal(mcpOutput.hookSpecificOutput.permissionDecision, 'deny')
      assert.deepEqual(mcpOutput, one('command-finished', id).output)
      assert.ok(
        mcpOutput.hookSpecificOutput.permissionDecisionReason.includes('Checkpoint 1 declined'),
      )
    }
  }
  const effect = one('overlap-native-effect', a)
  assert.ok(rows.indexOf(one('5', a)) < rows.indexOf(one('command-finished', a)))
  assert.ok(rows.indexOf(one('command-finished', a)) < rows.indexOf(effect))
  assert.ok(rows.indexOf(effect) < rows.indexOf(replies[2]))
  assert.equal(rows.filter((row) => row.event === 'overlap-native-effect').length, 1)
  assert.equal(readFileSync(manifest.calls[a]!.effect, 'utf8'), `overlap-native-effect:${a}\n`)
  assert.ok(!existsSync(manifest.calls[b]!.effect))
  const posts = rows.filter(
    (row) => row.event === 'native-post' && row.input?.hook_event_name === 'PostToolUse',
  )
  const postA = posts.filter((row) => row.input.tool_use_id === a)
  assert.equal(postA.length, 1)
  assert.equal(postA[0].input.tool_name, manifest.calls[a]!.operation.toolName)
  assert.deepEqual(postA[0].input.tool_input, manifest.calls[a]!.operation.input)
  assert.ok(JSON.stringify(postA[0].input.tool_response).includes(`overlap-native-effect:${a}`))
  assert.equal(posts.filter((row) => row.input.tool_use_id === b).length, 0)
  assert.ok(rows.indexOf(effect) < rows.indexOf(postA[0]))
  assert.deepEqual(
    rows
      .filter((row) => row.event === 'overlap-native-result')
      .map((row) => row.callId)
      .sort(),
    [a, b].sort(),
  )
  if (manifest.provider === 'codex') {
    const parent = read(join(directory, 'thread-start.json')).thread.id
    const turn = read(join(directory, 'turn-start.json')).turn.id
    assert.equal(native.parent, parent)
    assert.equal(commands[0].key.session_id, parent)
    assert.equal(commands[0].key.turn_id, turn)
    if (manifest.topology === 'same-session') {
      assert.equal(commands[1].key.session_id, parent)
      assert.equal(commands[1].key.turn_id, turn)
    } else {
      assert.equal(commands[1].key.session_id, parent)
      assert.equal(commands[1].input.agent_id, native.spawned)
      assert.equal(native.child, native.spawned)
      assert.notEqual(native.child, parent)
      const routing = readFileSync(join(directory, 'overlap-routing.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const childRequests = routing.filter((entry) => entry.recipient === 'child')
      assert.equal(childRequests.length, manifest.primedChildControl ? 3 : 2)
      for (const request of childRequests) {
        assert.equal(request.headers['x-client-request-id'], native.child)
        assert.equal(request.headers['x-codex-parent-thread-id'], parent)
        const metadata = JSON.parse(request.headers['x-codex-turn-metadata'])
        assert.equal(metadata.session_id, parent)
        assert.equal(metadata.thread_id, native.child)
        assert.equal(metadata.turn_id, commands[1].key.turn_id)
        assert.equal(metadata.parent_thread_id, parent)
        assert.equal(metadata.parent_turn_id, turn)
      }
      const messages = readFileSync(join(directory, 'appserver.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      if (manifest.primedChildControl) {
        const id = manifest.primedChildControl.callId
        assert.ok(!manifest.calls[id], 'Priming call must be distinct from approval operations')
        const priming = read(join(directory, 'overlap-priming-request.json'))
        assert.equal(priming.child, native.child)
        assert.deepEqual(priming.key, { ...commands[1].key, tool_use_id: id })
        assert.deepEqual(priming.args, { protocol: 1, ...priming.key })
        assert.deepEqual(
          forCall(id).map((row) => row.event),
          ['mcp-call', 'mcp-unmatched', 'mcp-finished'],
        )
        assert.deepEqual(one('mcp-call', id).params.arguments, priming.args)
        assert.deepEqual(one('mcp-unmatched', id).closed.key, priming.key)
        assert.deepEqual(one('mcp-finished', id).output, {})
        assert.equal(read(join(directory, 'overlap-priming-result.json')).call_id, id)
        const primerPosts = posts.filter((row) => row.input.tool_use_id === id)
        assert.equal(primerPosts.length, 1)
        const post = primerPosts[0].input
        assert.equal(post.tool_name, 'mcp__checkpoints__check')
        assert.deepEqual(post.tool_input, priming.args)
        assert.equal(post.session_id, native.parent)
        assert.equal(post.agent_id, native.child)
        assert.equal(post.turn_id, commands[1].key.turn_id)
        assert.deepEqual(post.tool_response.content, [{ type: 'text', text: '{}' }])
        assert.ok(post.tool_response.isError !== true)
        assert.ok(rows.indexOf(primerPosts[0]) < rows.indexOf(commands[1]))
        assert.notEqual(one('mcp-call', id).pid, one('mcp-call', a).pid)
        assert.equal(one('mcp-call', id).pid, one('mcp-call', b).pid)
        assert.ok(
          messages.some(
            (message) =>
              message.method === 'mcpServer/startupStatus/updated' &&
              message.params.threadId === native.child &&
              message.params.name === 'checkpoints' &&
              message.params.status === 'ready',
          ),
        )
      }
      assert.ok(
        messages.some(
          (message) =>
            message.method === 'turn/completed' &&
            message.params.threadId === native.child &&
            message.params.turn.id === commands[1].key.turn_id,
        ),
      )
    }
  } else {
    const session = JSON.parse(readFileSync(join(directory, 'stdout.log'), 'utf8')).session_id
    assert.ok(typeof session === 'string' && session.length)
    assert.equal(native.parent, session)
    assert.equal(commands[0].key.session_id, session)
    assert.equal(commands[1].key.session_id, session)
    if (manifest.topology === 'parent-child') {
      const starts = rows.filter(
        (row) => row.event === 'native-post' && row.input?.hook_event_name === 'SubagentStart',
      )
      assert.equal(starts.length, 1)
      assert.ok(starts[0].input.agent_id)
      assert.equal(commands[1].input.agent_id, starts[0].input.agent_id)
      assert.equal(native.task, starts[0].input.agent_id)
      assert.equal(native.child, native.task)
      assert.notEqual(commands[0].input.agent_id, starts[0].input.agent_id)
      const routing = readFileSync(join(directory, 'overlap-routing.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      assert.equal(routing.filter((row) => row.recipient === 'child').length, 2)
      for (const row of routing) {
        assert.equal(row.headers['x-claude-code-session-id'], session)
        assert.equal(
          row.headers['x-claude-code-agent-id'],
          row.recipient === 'child' ? native.task : undefined,
        )
      }
    }
  }
  const cleanup = read(join(directory, 'cleanup.json'))
  assert.deepEqual(cleanup.forcedContainment, [])
  assert.ok(cleanup.preTeardown.commands.every((entry: any) => !entry.alive))
  assert.equal(cleanup.preTeardown.commands.length, 2)
  return {
    commands: commands.map((row) => ({ key: row.key, nonce: row.start.nonce })),
    replies: replies.map((row) => ({
      key: row.key,
      nonce: row.nonce,
      ordinal: row.ordinal,
      action: row.action,
    })),
  }
}

export async function runOverlap(directory: string, provider: Provider, topology: OverlapTopology) {
  assert.equal(
    process.env.CLOOKS_E2E_DOCKER,
    'true',
    'Use existing test:approvals-native Docker runner',
  )
  assert.notEqual(process.getuid!(), 0)
  assert.ok(directory.startsWith('/export/'))
  assert.ok(
    ['same-session', 'parent-child', 'serial-child-control', 'primed-child-control'].includes(
      topology,
    ),
  )
  const serialChildControl = topology === 'serial-child-control'
  const primedChildControl = topology === 'primed-child-control'
  if (serialChildControl || primedChildControl) assert.equal(provider, 'codex')
  const r = setup(directory, provider, 'overlap', false)
  delete r.env.APPROVAL_ROOT
  r.env.APPROVAL_LOG_ROOT = directory
  r.env.APPROVAL_SHARED_HOME = '1'
  if (serialChildControl) r.env.RUST_LOG = 'debug'
  const manifest: OverlapManifest = {
    provider,
    topology: serialChildControl || primedChildControl ? 'parent-child' : topology,
    ...(serialChildControl ? { serialChildControl: true as const } : {}),
    ...(primedChildControl
      ? { primedChildControl: { callId: `overlap_priming_${randomUUID()}` } }
      : {}),
    owner: r.projectOwner,
    home: r.home,
    calls: {},
  }
  for (const label of ['A', 'B'] as const) {
    const id = `overlap_${label}_${randomUUID()}`
    manifest.calls[id] = {
      label,
      effect: join(r.project, `overlap-${label}.txt`),
      operation: {
        toolName: 'Bash',
        input: { command: `bun ${quote(join(fixtures, 'overlap-effect.ts'))} ${quote(id)}` },
      },
    }
  }
  save(join(directory, 'overlap-manifest.json'), manifest)
  r.hooks.hooks.PreToolUse[0]!.matcher = 'Bash'
  if (provider === 'claude') {
    r.hooks.hooks.Elicitation![0]!.hooks[0]!.command = `exec bun ${quote(join(fixtures, 'overlap-responder.ts'))}`
    const hooks = r.hooks.hooks as Record<string, unknown>
    hooks.SubagentStart = r.hooks.hooks.PostToolUse
    hooks.SubagentStop = r.hooks.hooks.PostToolUse
  }
  save(join(directory, 'hooks.json'), {
    ...r.hooks,
    permissions: { allow: ['Bash(*)', 'Agent', 'TaskOutput'] },
  })
  const version = Bun.spawnSync([`/native/${provider}`, '--version'], { env: r.env, timeout: 5000 })
  assert.equal(version.exitCode, 0)
  assert.ok(version.stdout.toString().includes(provider === 'claude' ? '2.1.272' : '0.154.0'))
  save(join(directory, 'overlap-version.json'), {
    version: version.stdout.toString().trim(),
    sha256: createHash('sha256')
      .update(readFileSync(`/native/${provider}`))
      .digest('hex'),
  })
  const model = overlapModel(directory, manifest)
  try {
    if (provider === 'codex') await launchOverlapCodex(r, model.port!, serialChildControl ? 2 : 3)
    else {
      save(join(directory, 'mcp.json'), {
        mcpServers: { checkpoints: { command: 'bun', args: [join(fixtures, 'mcp.ts')] } },
      })
      await launch(
        r,
        [
          '/native/claude',
          '-p',
          '--output-format',
          'json',
          '--permission-mode',
          'default',
          '--model',
          'claude-sonnet-4-6',
          '--tools',
          'Bash,Agent,TaskOutput',
          '--strict-mcp-config',
          '--mcp-config',
          join(directory, 'mcp.json'),
          '--setting-sources',
          '',
          '--settings',
          join(directory, 'hooks.json'),
          '--disable-slash-commands',
          '--debug-file',
          join(directory, 'debug.log'),
          'Run the local overlap test once.',
        ],
        {
          ...r.env,
          ANTHROPIC_API_KEY: 'local-test-only',
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${model.port}`,
        },
      )
    }
    const native = model.verify()
    if (serialChildControl) {
      const rows = journal(directory)
      const a = Object.keys(manifest.calls).find((id) => manifest.calls[id]!.label === 'A')!
      const b = Object.keys(manifest.calls).find((id) => manifest.calls[id]!.label === 'B')!
      const completedA = rows.findIndex(
        (row) => row.event === 'command-finished' && row.key.tool_use_id === a,
      )
      const postA = rows.findIndex(
        (row) => row.event === 'native-post' && row.input?.tool_use_id === a,
      )
      const childStart = rows.findIndex(
        (row) => row.event === 'command-start' && row.key.tool_use_id === b,
      )
      assert.ok(completedA >= 0 && completedA < postA && postA < childStart)
      const result = {
        passed: true,
        provider,
        topology,
        diagnosticOnly: true,
        overlapProof: false,
        outcome: 'cold-child-mcp-not-connected',
        native,
        productionEngine: false,
        milestoneComplete: false,
      }
      save(join(directory, 'result.json'), result)
      return result
    }
    const evidence = assertOverlap(directory, manifest, native)
    const result = {
      passed: true,
      provider,
      topology,
      native,
      evidence,
      ...(primedChildControl
        ? {
            diagnosticOnly: true,
            overlapProof: true,
            childReadiness: 'direct-native-check',
            ordinaryColdChildReadiness: false,
          }
        : {}),
      scriptedModel: true,
      scriptedUI: true,
      productionEngine: false,
      milestoneComplete: false,
    }
    save(join(directory, 'result.json'), result)
    return result
  } catch (error) {
    save(join(directory, 'result.json'), {
      passed: false,
      provider,
      topology,
      ...(serialChildControl ? { diagnosticOnly: true, overlapProof: false } : {}),
      ...(primedChildControl
        ? {
            diagnosticOnly: true,
            overlapProof: false,
            childReadiness: 'direct-native-check',
            ordinaryColdChildReadiness: false,
          }
        : {}),
      error: String(error),
      modelErrors: model.errors,
      observedOverlap: journal(directory)
        .filter((row) => row.event === 'overlap-question')
        .map((row) => ({ key: row.key, ordinal: row.ordinal })),
      limitation:
        'Absent simultaneous checkpoints is not proof of native serialization or a passing overlap case',
      milestoneComplete: false,
    })
    throw error
  } finally {
    model.stop()
  }
}
