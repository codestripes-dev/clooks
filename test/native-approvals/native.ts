import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  alive,
  budgets,
  journal,
  signalProcess,
  wait,
  type Provider,
} from '../fixtures/interactive-approvals/channel'
import { respond } from '../fixtures/interactive-approvals/responder'
import { startFixture } from '../native-codex/fixture-server'
import { packCatalog } from '../native-codex/pack-scenarios'
import { holdBoundary } from './boundary'
import type { GeneratedRuntime } from './generated'
import {
  claimPids as productionClaimPids,
  packets as productionPackets,
  respond as productionRespond,
} from '../fixtures/production-approvals/evidence'
import { rows as productionRows } from '../fixtures/production-approvals/records'

export const fixtures = '/app/test/fixtures/interactive-approvals'
export const save = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
export const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
export type InteractiveConfig = 'cli' | 'disk' | 'cli-no-tools' | 'cli-restart' | 'cli-second-turn'
export type InteractiveReadiness = 'input-render' | 'mcp-status'
export function setup(
  root: string,
  provider: Provider,
  mode: string,
  reverse: boolean,
  interactiveConfig: InteractiveConfig = 'cli',
  interactiveReadiness: InteractiveReadiness = 'input-render',
) {
  const project = join(root, 'project'),
    home = join(root, 'home'),
    config = join(home, provider === 'codex' ? '.codex' : '.claude')
  for (const dir of [project, config, join(root, 'temp')]) mkdirSync(dir, { recursive: true })
  const env: Record<string, string> = {
    HOME: home,
    CODEX_HOME: config,
    CLAUDE_CONFIG_DIR: config,
    TMPDIR: join(root, 'temp'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_DATA_HOME: join(home, '.local/share'),
    PATH: '/usr/local/bin:/usr/bin:/bin',
    SHELL: '/bin/bash',
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    APPROVAL_ROOT: root,
    APPROVAL_CASE: mode,
    APPROVAL_UI_READINESS: interactiveReadiness,
    CLOOKS_HOME_ROOT: join(root, 'config-root-override'),
  }
  if (mode === 'deadline') env.APPROVAL_BUDGET_MS = '6500'
  const interactive = mode.startsWith('defer-interactive')
  const scoped = mode.startsWith('scope-')
  const globalScope = mode.startsWith('scope-global-')
  const projectOwner = scoped ? `project:${randomUUID().replaceAll('-', '')}` : 'project:m1'
  if (scoped) {
    delete env.APPROVAL_ROOT
    env.APPROVAL_LOG_ROOT = root
    env.APPROVAL_SHARED_HOME = '1'
    mkdirSync(join(project, '.clooks'), { recursive: true })
    save(join(project, '.clooks', 'fixture-registration.json'), { owner: projectOwner })
    save(join(root, 'scope.json'), {
      projectOwner,
      globalScope,
      dispositionSource: 'explicit-fixture-not-launcher-predicate',
    })
  }
  const command = {
    type: 'command',
    command: `exec bun ${quote(join(fixtures, 'command.ts'))} ${provider} ${projectOwner} 1${globalScope ? ' suppressed' : ''}`,
    timeout: mode === 'boundary-timeout' ? 2 : budgets.native,
  }
  const mcp = {
    type: 'mcp_tool',
    server: 'checkpoints',
    tool: 'check',
    input: {
      protocol: 1,
      provider,
      owner: projectOwner,
      session_id: '${session_id}',
      tool_use_id: '${tool_use_id}',
      ...(provider === 'codex' ? { turn_id: '${turn_id}' } : {}),
    },
    timeout: mode === 'boundary-timeout' ? 2 : budgets.native,
  }
  if (mode === 'wrong-owner') mcp.input.owner = 'foreign:m1'
  const pair = reverse ? [mcp, command] : [command, mcp]
  const globalCommand = {
    ...command,
    command: `exec bun ${quote(join(fixtures, 'command.ts'))} ${provider} global 1`,
  }
  const globalMcp = { ...mcp, input: { ...mcp.input, owner: 'global' } }
  const globalHooks = {
    hooks: globalScope
      ? {
          PreToolUse: [
            {
              matcher: '*',
              hooks: reverse ? [globalMcp, globalCommand] : [globalCommand, globalMcp],
            },
          ],
        }
      : {},
  }
  const hooks = {
    hooks: {
      PreToolUse: [{ matcher: '*', hooks: pair }],
      PostToolUse: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: `exec bun ${quote(join(fixtures, 'observe.ts'))}`,
              timeout: 5,
            },
          ],
        },
      ],
      ...(provider === 'claude'
        ? {
            Elicitation: [
              {
                hooks: [
                  {
                    type: 'command',
                    command: `exec bun ${quote(mode.startsWith('boundary-') ? '/app/test/native-approvals/boundary.ts' : join(fixtures, 'responder.ts'))}`,
                    timeout: 90,
                  },
                ],
              },
            ],
          }
        : {}),
    },
  }
  save(
    join(root, 'hooks.json'),
    interactive || mode.startsWith('bootstrap-') || mode.startsWith('boundary-')
      ? { ...hooks, permissions: { allow: ['Bash(*)'] } }
      : hooks,
  )
  if (interactiveConfig === 'disk' || (scoped && provider === 'claude')) {
    assert.ok(provider === 'claude' && (interactive || scoped))
    mkdirSync(join(project, '.claude'), { recursive: true })
    save(join(project, '.claude/settings.local.json'), {
      ...hooks,
      permissions: { allow: ['Bash(*)'] },
      enabledMcpjsonServers: ['checkpoints'],
    })
  }
  if (scoped) {
    if (provider === 'claude') save(join(config, 'settings.json'), globalHooks)
    else {
      mkdirSync(join(project, '.codex'), { recursive: true })
      save(join(project, '.codex', 'hooks.json'), hooks)
    }
  }
  if (interactive || (scoped && provider === 'claude'))
    save(join(config, '.claude.json'), {
      hasCompletedOnboarding: true,
      theme: 'dark',
      customApiKeyResponses: { approved: ['local-test-only'], rejected: [] },
      projects: { [project]: { hasTrustDialogAccepted: true } },
    })
  if (mode.endsWith('disabled') && provider === 'claude')
    save(join(config, '.claude.json'), {
      projects: { [project]: { disabledMcpServers: ['checkpoints'] } },
    })
  const callId = `m1_native_call_${randomUUID()}`
  const cmd = `bun ${quote(join(fixtures, 'effect.ts'))}`
  const patch = '*** Begin Patch\n*** Add File: effect.txt\n+native-effect\n*** End Patch\n'
  save(
    join(root, 'operation.json'),
    mode === 'non-shell'
      ? provider === 'claude'
        ? {
            toolName: 'Write',
            input: { file_path: join(project, 'effect.txt'), content: 'native-effect\n' },
          }
        : { toolName: 'apply_patch', input: { command: patch } }
      : { toolName: 'Bash', input: { command: cmd } },
  )
  return {
    kind: 'illustrative' as const,
    root,
    provider,
    project,
    home,
    config,
    env,
    hooks,
    callId,
    cmd,
    interactiveConfig,
    interactiveReadiness,
    scoped,
    globalScope,
    projectOwner,
    globalHooks,
  }
}
type Runtime = ReturnType<typeof setup> | GeneratedRuntime
function anthropic(body: any, content: any, stop: string) {
  const message = {
    id: 'msg_m1',
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [content],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  }
  if (!body.stream) return Response.json(message)
  const event = (type: string, value: any) => `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`
  const tool = content.type === 'tool_use'
  return new Response(
    event('message_start', {
      type: 'message_start',
      message: { ...message, content: [], stop_reason: null },
    }) +
      event('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: tool ? { ...content, input: {} } : { type: 'text', text: '' },
      }) +
      event('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: tool
          ? { type: 'input_json_delta', partial_json: JSON.stringify(content.input) }
          : { type: 'text_delta', text: content.text },
      }) +
      event('content_block_stop', { type: 'content_block_stop', index: 0 }) +
      event('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stop, stop_sequence: null },
        usage: { output_tokens: 10 },
      }) +
      event('message_stop', { type: 'message_stop' }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}
export function finishPrimingFailure(body: any, error: unknown, errors: string[]) {
  errors.push(String(error))
  return anthropic(body, { type: 'text', text: 'NATIVE_INTERACTIVE_COMPLETE' }, 'end_turn')
}

export async function claude(r: Runtime) {
  const interactive = r.env.APPROVAL_CASE!.startsWith('defer-interactive')
  let primingCallId: string | undefined
  const requests: any[] = [],
    errors: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === '/api/hello') return Response.json({})
      try {
        assert.equal(new URL(req.url).pathname, '/v1/messages')
        const body: any = await req.json()
        if (interactive && !body.tools?.some((tool: any) => tool.name === 'Bash')) {
          assert.ok(
            JSON.stringify(body.messages).includes('Write the title'),
            'Unexpected auxiliary native request',
          )
          assert.ok(JSON.stringify(body.system).includes('You are naming a coding session'))
          assert.deepEqual(body.output_config?.format?.schema?.required, ['title'])
          appendFileSync(join(r.root, 'auxiliary.jsonl'), JSON.stringify(body) + '\n')
          return anthropic(
            body,
            { type: 'text', text: JSON.stringify({ title: 'Native approvals' }) },
            'end_turn',
          )
        }
        requests.push(body)
        save(join(r.root, `request-${requests.length}.json`), body)
        assert.ok(requests.length <= 2, 'Model attempted replay')
        if (interactive && requests.length === 1) {
          const ready = JSON.parse(readFileSync(join(r.root, 'interactive-ready.json'), 'utf8'))
          assert.equal(ready.kind, r.interactiveReadiness)
          assert.ok(ready.connectionObservedAt <= ready.promptObservedAt)
          if (r.interactiveReadiness === 'mcp-status') {
            assert.ok(ready.promptObservedAt <= ready.mcpStatusObservedAt)
            assert.ok(ready.mcpStatusObservedAt <= ready.inputEchoObservedAt)
          } else assert.ok(ready.promptObservedAt <= ready.inputEchoObservedAt)
          assert.ok(ready.inputEchoObservedAt <= ready.submittedAt)
          assert.ok(ready.submittedAt <= Date.now())
          await wait(
            () =>
              existsSync(join(r.root, 'debug.log')) &&
              readFileSync(join(r.root, 'debug.log'), 'utf8').includes(
                'MCP server "checkpoints": Connection established with capabilities:',
              )
                ? true
                : undefined,
            Date.now() + 10000,
          )
          save(join(r.root, 'connection-barrier.json'), {
            nativeConnectionObservedBeforeModelTool: true,
            at: Date.now(),
          })
        }
        if (r.interactiveConfig === 'cli-second-turn' && !primingCallId && requests.length === 2) {
          const outputs = body.messages
            .flatMap((message: any) => (Array.isArray(message.content) ? message.content : []))
            .filter((block: any) => block.type === 'tool_result')
          const rows = journal(r.root)
          const commands = rows.filter((row) => row.event === 'command-start')
          const denials = rows.filter((row) => row.event === 'command-denied')
          const completions = rows.filter((row) => row.event === 'command-finished')
          try {
            assert.equal(outputs.length, 1)
            assert.equal(outputs[0].tool_use_id, r.callId)
            assert.equal(
              outputs[0].is_error,
              true,
              'This discriminator requires a denied priming turn',
            )
            assert.equal(commands.length, 1)
            assert.equal(commands[0].key.tool_use_id, r.callId)
            assert.equal(denials.length, 1)
            assert.equal(completions.length, 1)
            assert.equal(denials[0].pid, commands[0].pid)
            assert.equal(completions[0].pid, commands[0].pid)
            assert.deepEqual(denials[0].key, commands[0].key)
            assert.deepEqual(completions[0].key, commands[0].key)
            assert.equal(denials[0].error, 'Error: MCP peer unavailable')
            assert.deepEqual(completions[0].output, {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: denials[0].error,
              },
            })
            const feedback =
              typeof outputs[0].content === 'string'
                ? outputs[0].content
                : outputs[0].content.map((block: any) => block.text ?? '').join('\n')
            assert.ok(feedback.includes(denials[0].error))
            for (const event of [
              'mcp-call',
              'mcp-prompt',
              'mcp-response',
              'ui-response',
              'native-effect',
              'native-post',
            ])
              assert.equal(rows.filter((row) => row.event === event).length, 0)
            assert.deepEqual(
              rows
                .map((row) => row.event)
                .filter((event) => /^(?:[1-5](?:-ask)?|approve-[24])$/.test(event)),
              ['1', '2-ask'],
            )
            await wait(
              () => (commands.every((row) => !alive(row.pid)) ? true : undefined),
              Date.now() + 2000,
            )
            assert.ok(!existsSync(join(r.project, 'effect.txt')))
          } catch (error) {
            save(join(r.root, 'diagnostic-precondition.json'), {
              status: 'precondition-not-reproduced',
              callId: r.callId,
              output: outputs[0],
              error: String(error),
              at: Date.now(),
            })
            return finishPrimingFailure(body, error, errors)
          }
          const prime = join(r.root, 'priming')
          mkdirSync(prime)
          save(join(prime, 'summary.json'), {
            phase: 'denied-first-turn-priming-only',
            callId: r.callId,
            output: outputs[0],
            denial: denials[0],
            commandsSettledAt: Date.now(),
            nativePid: JSON.parse(readFileSync(join(r.root, 'native-pid.json'), 'utf8')).pid,
          })
          for (const entry of readdirSync(r.root))
            if (
              /^[a-f0-9]{64}$/.test(entry) ||
              [
                'request-1.json',
                'request-2.json',
                'journal.jsonl',
                'connection-barrier.json',
                'auxiliary.jsonl',
              ].includes(entry)
            )
              renameSync(join(r.root, entry), join(prime, entry))
          // The same server is still alive; retain its actual birth record for final cleanup.
          const births = rows.filter((row) => row.event === 'mcp-start')
          writeFileSync(
            join(r.root, 'journal.jsonl'),
            births.map((row) => JSON.stringify(row) + '\n').join(''),
            { flag: 'wx' },
          )
          primingCallId = r.callId
          r.callId = `m1_native_call_${randomUUID()}`
          requests.length = 0
          save(join(r.root, 'second-turn.json'), {
            primingCallId,
            callId: r.callId,
            sameProcess: true,
            fullDebugLog: join(r.root, 'debug.log'),
            primingEvidence: prime,
          })
          return anthropic(body, { type: 'text', text: 'NATIVE_INTERACTIVE_PRIMED' }, 'end_turn')
        }
        return anthropic(
          body,
          requests.length === 1
            ? {
                type: 'tool_use',
                id: r.callId,
                name: r.env.APPROVAL_CASE === 'non-shell' ? 'Write' : 'Bash',
                input:
                  r.env.APPROVAL_CASE === 'non-shell'
                    ? { file_path: join(r.project, 'effect.txt'), content: 'native-effect\n' }
                    : { command: r.cmd },
              }
            : { type: 'text', text: interactive ? 'NATIVE_INTERACTIVE_COMPLETE' : 'Done.' },
          requests.length === 1 ? 'tool_use' : 'end_turn',
        )
      } catch (error) {
        errors.push(String(error))
        return Response.json({ error: String(error) }, { status: 400 })
      }
    },
  })
  const env = {
    ...r.env,
    ANTHROPIC_API_KEY: 'local-test-only',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`,
  }
  const mcpConfig = {
    mcpServers: r.env.APPROVAL_CASE!.endsWith('missing')
      ? {}
      : { checkpoints: { command: 'bun', args: [join(fixtures, 'mcp.ts')] } },
  }
  if (r.kind === 'illustrative') {
    save(join(r.root, 'mcp.json'), mcpConfig)
    if (r.interactiveConfig === 'disk' || r.scoped) save(join(r.project, '.mcp.json'), mcpConfig)
  }
  const argv = [
    ...(interactive ? ['expect', '/app/test/native-approvals/interactive.exp'] : []),
    '/native/claude',
    ...(interactive ? [] : ['-p', '--output-format', 'json']),
    '--permission-mode',
    'default',
    '--model',
    'claude-sonnet-4-6',
    ...(r.interactiveConfig === 'cli-no-tools' ? [] : ['--tools', 'Bash,Write']),
    ...(r.interactiveConfig === 'disk' || r.scoped
      ? []
      : [
          '--strict-mcp-config',
          '--mcp-config',
          join(r.root, 'mcp.json'),
          '--setting-sources',
          '',
          '--settings',
          join(r.root, 'hooks.json'),
        ]),
    ...(interactive && r.interactiveReadiness === 'mcp-status' ? [] : ['--disable-slash-commands']),
    '--debug-file',
    join(r.root, 'debug.log'),
    ...(interactive ? [] : ['Run the local test once.']),
  ]
  try {
    if (r.interactiveConfig === 'cli-restart') {
      const configs = ['hooks.json', 'mcp.json'].map((name) => ({
        name,
        text: readFileSync(join(r.root, name), 'utf8'),
      }))
      await launch(r, argv, env)
      assert.deepEqual(errors, [])
      assert.equal(requests.length, 2, 'Priming launch must complete its original tool turn')
      const outputs = requests[1].messages
        .flatMap((message: any) => (Array.isArray(message.content) ? message.content : []))
        .filter((block: any) => block.type === 'tool_result')
      assert.equal(outputs.length, 1)
      assert.equal(outputs[0].tool_use_id, r.callId)
      const cache = join(r.config, 'mcp-discovery-cache')
      const prime = join(r.root, 'priming')
      mkdirSync(prime)
      // Preserve HOME/config/argv; move attempt evidence so readiness and replies are fresh.
      const retained = new Set([
        'home',
        'project',
        'temp',
        'hooks.json',
        'mcp.json',
        'operation.json',
        'priming',
      ])
      for (const entry of readdirSync(r.root))
        if (!retained.has(entry)) renameSync(join(r.root, entry), join(prime, entry))
      if (existsSync(join(r.project, 'effect.txt')))
        renameSync(join(r.project, 'effect.txt'), join(prime, 'effect.txt'))
      save(join(prime, 'summary.json'), {
        phase: 'priming-only-not-a-passing-scenario',
        callId: r.callId,
        output: outputs[0],
        configs,
        nativeConfig: JSON.parse(readFileSync(join(r.config, '.claude.json'), 'utf8')),
        discoveryCache: {
          path: cache,
          exists: existsSync(cache),
          entries: existsSync(cache) ? readdirSync(cache, { recursive: true }) : [],
        },
      })
      for (const config of configs)
        assert.equal(readFileSync(join(r.root, config.name), 'utf8'), config.text)
      const previousCallId = r.callId
      r.callId = `m1_native_call_${randomUUID()}`
      requests.length = 0
      assert.ok(!existsSync(join(r.root, 'debug.log')))
      assert.deepEqual(journal(r.root), [])
      save(join(r.root, 'restart.json'), {
        previousCallId,
        callId: r.callId,
        unchangedHome: r.home,
        unchangedConfigPaths: configs.map(({ name }) => join(r.root, name)),
        unchangedArgv: argv,
        unchangedEnv: env,
        oldEvidence: prime,
      })
    }
    await launch(r, argv, env)
    if (!interactive) {
      const output = JSON.parse(readFileSync(join(r.root, 'stdout.log'), 'utf8'))
      assert.equal(typeof output.session_id, 'string')
      assert.ok(output.session_id.length > 0)
      save(join(r.root, 'native-identity.json'), {
        provider: 'claude',
        session_id: output.session_id,
        tool_use_id: r.callId,
      })
    }
    assert.deepEqual(errors, [])
    if (r.env.APPROVAL_CASE === 'native-interrupt') {
      assert.equal(requests.length, 1)
      const status = JSON.parse(readFileSync(join(r.root, 'exit.json'), 'utf8'))
      const native = JSON.parse(readFileSync(join(r.root, 'stdout.log'), 'utf8'))
      assert.equal(native.terminal_reason, 'aborted_tools')
      assert.equal(native.is_error, true)
      return { output: { interrupted: true, status, native }, requests: requests.length }
    }
    if (r.env.APPROVAL_CASE === 'defer') {
      const native = JSON.parse(readFileSync(join(r.root, 'stdout.log'), 'utf8'))
      assert.equal(requests.length, 1)
      assert.equal(native.stop_reason, 'tool_deferred')
      assert.equal(native.deferred_tool_use.id, r.callId)
      return { output: native, requests: requests.length }
    }
    assert.equal(requests.length, 2)
    const outputs = requests[1].messages
      .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
      .filter((b: any) => b.type === 'tool_result')
    assert.equal(outputs.length, primingCallId ? 2 : 1)
    if (primingCallId)
      assert.equal(outputs.filter((output: any) => output.tool_use_id === primingCallId).length, 1)
    const original = outputs.filter((output: any) => output.tool_use_id === r.callId)
    assert.equal(original.length, 1)
    return {
      output: original[0],
      requests: requests.length,
      ...(primingCallId ? { primingRequests: 2 } : {}),
    }
  } finally {
    server.stop(true)
  }
}

export async function codex(r: Runtime) {
  const nonShell = r.env.APPROVAL_CASE === 'non-shell'
  const model = startFixture(
    [
      nonShell
        ? {
            type: 'custom_tool_call',
            name: 'apply_patch',
            call_id: r.callId,
            input: '*** Begin Patch\n*** Add File: effect.txt\n+native-effect\n*** End Patch\n',
          }
        : {
            type: 'function_call',
            name: 'exec_command',
            call_id: r.callId,
            arguments: JSON.stringify({ cmd: r.cmd, workdir: r.project, yield_time_ms: 1000 }),
          },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] },
    ],
    r.root,
  )
  if (r.kind === 'illustrative')
    save(join(r.config, 'hooks.json'), r.scoped ? r.globalHooks : r.hooks)
  save(join(r.config, 'models.json'), packCatalog)
  let config = `model = "gpt-5.1-codex"
model_catalog_json = ${JSON.stringify(join(r.config, 'models.json'))}
model_provider = "native_fixture"
approval_policy = "on-request"
[projects.${JSON.stringify(r.project)}]
trust_level = "trusted"
[features]
enable_request_compression = false
remote_plugin = false
${
  r.kind === 'generated'
    ? ''
    : `
[mcp_servers.checkpoints]
enabled = ${!r.env.APPROVAL_CASE!.endsWith('disabled')}
command = "bun"
args = ${JSON.stringify([join(fixtures, 'mcp.ts')])}
startup_timeout_sec = 10
tool_timeout_sec = 330
[mcp_servers.checkpoints.env]
${r.scoped ? 'APPROVAL_LOG_ROOT' : 'APPROVAL_ROOT'} = ${JSON.stringify(r.root)}
APPROVAL_CASE = ${JSON.stringify(r.env.APPROVAL_CASE)}
${r.scoped ? 'APPROVAL_SHARED_HOME = "1"' : ''}
`
}
[model_providers.native_fixture]
name = "Local fixture"
base_url = "http://127.0.0.1:${model.port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 15000
`
  if (r.env.APPROVAL_CASE!.endsWith('missing')) {
    const first = config.indexOf('[mcp_servers.checkpoints]')
    const last = config.indexOf('[model_providers.native_fixture]')
    config = config.slice(0, first) + config.slice(last)
  }
  writeFileSync(join(r.config, 'config.toml'), config)
  const messages: any[] = []
  try {
    await launch(r, ['/native/codex', 'app-server'], r.env, async (child, signal) => {
      const responseAbort = new AbortController()
      const responseTasks: Promise<void>[] = []
      const responseErrors: unknown[] = []
      let settledResponses = 0
      const pending = new Map<
        number,
        { resolve: (value: any) => void; reject: (error: Error) => void }
      >()
      let sequence = 0
      const send = (message: any) => {
        appendFileSync(join(r.root, 'outgoing.jsonl'), JSON.stringify(message) + '\n')
        child.stdin!.write(JSON.stringify(message) + '\n')
      }
      const rpc = (method: string, params: any) =>
        new Promise<any>((resolve, reject) => {
          const id = ++sequence
          pending.set(id, { resolve, reject })
          send({ id, method, params })
        })
      let complete!: () => void, fail!: (error: Error) => void
      const done = new Promise<void>((resolve, reject) => {
        complete = resolve
        fail = reject
      })
      void done.catch(() => {})
      const abort = () => fail(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      const reader = createInterface({ input: child.stdout! }).on('line', (line) => {
        try {
          const message = JSON.parse(line)
          messages.push(message)
          appendFileSync(join(r.root, 'appserver.jsonl'), line + '\n')
          if (!message.method && pending.has(message.id)) {
            const callback = pending.get(message.id)!
            pending.delete(message.id)
            message.error
              ? callback.reject(new Error(JSON.stringify(message.error)))
              : callback.resolve(message.result)
          }
          if (message.method === 'mcpServer/elicitation/request') {
            assert.ok(!responseAbort.signal.aborted, 'Elicitation after native turn ended')
            assert.equal(
              message.params.serverName,
              r.kind === 'generated' ? 'clooks' : 'checkpoints',
            )
            if (r.env.APPROVAL_CASE === 'native-interrupt') {
              const prompt = JSON.parse(message.params.message)
              assert.equal(prompt.ordinal, 1)
              assert.ok(!existsSync(join(r.project, 'effect.txt')))
              save(join(r.root, 'interrupt.json'), {
                threadId: message.params.threadId,
                turnId: prompt.key.turn_id,
                requestId: message.id,
              })
              void rpc('turn/interrupt', {
                threadId: prompt.key.session_id,
                turnId: prompt.key.turn_id,
              }).catch(fail)
            } else {
              responseTasks.push(
                (r.kind === 'generated'
                  ? productionRespond(message.params.message, r.c, responseAbort.signal)
                  : r.env.APPROVAL_CASE!.startsWith('boundary-')
                    ? holdBoundary(
                        message.params.message,
                        r.root,
                        r.env.APPROVAL_CASE!,
                        responseAbort.signal,
                      )
                    : respond(message.params.message, {
                        directory: r.root,
                        mode: r.env.APPROVAL_CASE,
                        ...(r.scoped ? { sharedHome: r.home } : {}),
                        signal: responseAbort.signal,
                      })
                )
                  .then((result) => {
                    responseAbort.signal.throwIfAborted()
                    send({ id: message.id, result: { ...result, _meta: null } })
                  })
                  .catch((error) => {
                    if (
                      responseAbort.signal.aborted &&
                      (error === responseAbort.signal.reason || error?.name === 'AbortError')
                    )
                      return
                    responseErrors.push(error)
                    fail(error)
                  })
                  .finally(() => {
                    settledResponses++
                  }),
              )
            }
          } else if (message.method && message.id !== undefined)
            throw new Error(`Unexpected native request ${message.method}`)
          if (message.method === 'turn/completed') {
            assert.equal(
              message.params.turn.status,
              r.env.APPROVAL_CASE === 'native-interrupt' ? 'interrupted' : 'completed',
            )
            responseAbort.abort(new Error('Native turn completed'))
            complete()
          }
        } catch (error) {
          responseErrors.push(error)
          fail(error as Error)
        }
      })
      const flow = async () => {
        await rpc('initialize', {
          clientInfo: { name: 'm1_native_approvals', version: '1.0.0' },
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
        save(join(r.root, 'thread-start.json'), thread)
        const turn = await rpc('turn/start', {
          threadId: thread.thread.id,
          input: [{ type: 'text', text: 'Run the local test once.', text_elements: [] }],
        })
        save(join(r.root, 'turn-start.json'), turn)
        save(join(r.root, 'native-identity.json'), {
          provider: 'codex',
          session_id: thread.thread.id,
          turn_id: turn.turn.id,
          tool_use_id: r.callId,
        })
        await done
      }
      try {
        signal.throwIfAborted()
        await Promise.race([flow(), done.then(() => {})])
      } finally {
        responseAbort.abort(new Error('Native driver closed'))
        reader.close()
        signal.removeEventListener('abort', abort)
        for (const callback of pending.values()) callback.reject(new Error('Native driver closed'))
        pending.clear()
        await Promise.all(responseTasks)
        save(join(r.root, 'responders.json'), {
          started: responseTasks.length,
          settled: settledResponses,
          pending: responseTasks.length - settledResponses,
          errors: responseErrors.map(String),
          at: Date.now(),
        })
      }
      assert.deepEqual(responseErrors, [])
    })
    if (r.env.APPROVAL_CASE === 'native-interrupt') {
      assert.equal(model.requests.length, 1)
      assert.deepEqual(model.errors, [])
      return { output: { interrupted: true }, messages, requests: model.requests.length }
    }
    model.assertComplete()
    const outputs = model.requests[1]!.body.input.filter(
      (item: any) => item.type === (nonShell ? 'custom_tool_call_output' : 'function_call_output'),
    )
    assert.equal(outputs.length, 1)
    assert.equal(outputs[0].call_id, r.callId)
    return { output: outputs[0], messages, requests: model.requests.length }
  } finally {
    model.stop()
  }
}

export async function launch(
  r: Runtime,
  argv: string[],
  env: Record<string, string>,
  drive?: (child: ChildProcess, signal: AbortSignal) => Promise<void>,
) {
  const boundary = r.env.APPROVAL_CASE!.startsWith('boundary-')
  const timeoutMs = boundary ? 20000 : 110000
  save(join(r.root, 'launch.json'), { argv, env, cwd: r.project, timeoutMs })
  const child = spawn(argv[0]!, argv.slice(1), {
    cwd: r.project,
    env,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  assert.ok(child.pid)
  save(join(r.root, 'native-pid.json'), { pid: child.pid })
  let exited = false
  const exit = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      exited = true
      save(join(r.root, 'exit.json'), { code, signal })
      resolve()
    })
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Native case exceeded ${timeoutMs / 1000}s outer deadline`)),
      timeoutMs,
    )
  })
  child.stderr!.on('data', (bytes) => appendFileSync(join(r.root, 'stderr.log'), bytes))
  if (!drive) child.stdout!.on('data', (bytes) => appendFileSync(join(r.root, 'stdout.log'), bytes))
  let primary: unknown
  let preTeardown: any
  const commandPids = () =>
    r.kind === 'generated'
      ? productionPackets(r.home)
          .filter((box) => box.command)
          .map((box) => box.command.pid as number)
      : journal(r.root)
          .filter((row) => row.event === 'command-start')
          .map((row) => row.pid)
  const driveAbort = new AbortController()
  const driven = drive?.(child, driveAbort.signal)
  try {
    await Promise.race([driven ?? exit, deadline])
    if (!drive && r.env.APPROVAL_CASE !== 'native-interrupt')
      assert.equal(JSON.parse(readFileSync(join(r.root, 'exit.json'), 'utf8')).code, 0)
    const settledBy = Date.now() + 2000
    while (commandPids().some(alive) && Date.now() < settledBy) await Bun.sleep(20)
    preTeardown = {
      commands: commandPids().map((pid) => ({ pid, alive: alive(pid) })),
      at: Date.now(),
    }
    if (r.kind === 'generated') {
      const boxes = productionPackets(r.home)
      assert.equal(boxes.length, 1)
      assert.ok(
        boxes[0]!.done && boxes[0]!['check-done'],
        'Production peers must settle before native teardown',
      )
      preTeardown.productionCompletions = boxes.map((box) => ({
        done: box.done,
        checkDone: box['check-done'],
      }))
    }
    if (!boundary)
      assert.ok(
        preTeardown.commands.every((p: any) => !p.alive),
        'Command waiter survived native completion before teardown',
      )
    if (r.env.APPROVAL_CASE === 'native-interrupt') {
      const settledBy = Date.now() + 2000
      const settled = () => {
        const rows = journal(r.root)
        return (
          rows.some((row) => row.event === 'mcp-finished') ||
          rows.filter((row) => row.event === 'mcp-start').every((row) => !alive(row.pid))
        )
      }
      while (!settled() && Date.now() < settledBy) await Bun.sleep(20)
      preTeardown.servers = journal(r.root)
        .filter((row) => row.event === 'mcp-start')
        .map((row) => ({ pid: row.pid, alive: alive(row.pid) }))
      assert.ok(settled(), 'Cancelled check survived before native teardown')
      preTeardown.at = Date.now()
    }
  } catch (error) {
    primary = error
    throw error
  } finally {
    clearTimeout(timer)
    driveAbort.abort(new Error('Native launch ended'))
    await driven?.catch(() => {})
    const signalErrors: string[] = []
    const evidenceErrors: string[] = []
    const collect = <T>(label: string, read: () => T, fallback: T): T => {
      try {
        return read()
      } catch (error) {
        evidenceErrors.push(`${label}: ${String(error)}`)
        return fallback
      }
    }
    const signal = (pid: number, value: NodeJS.Signals) => {
      try {
        signalProcess(pid, value)
      } catch (error) {
        signalErrors.push(String(error))
      }
    }
    const before = collect(
      'command evidence',
      () => commandPids().map((pid) => ({ pid, alive: alive(pid) })),
      [],
    )
    if (alive(-child.pid)) signal(-child.pid, 'SIGTERM')
    await Promise.race([exit, Bun.sleep(2000)])
    if (alive(-child.pid)) signal(-child.pid, 'SIGKILL')
    await exit
    const ownedPids =
      r.kind === 'generated'
        ? [
            ...productionClaimPids(r.home, (error) =>
              evidenceErrors.push(`claim evidence: ${error}`),
            ),
            ...collect('journal evidence', () => productionRows(r.root).map((row) => row.pid), []),
          ]
        : collect('owned process evidence', () => journal(r.root).map((row) => row.pid), [])
    const pids = [...new Set(ownedPids)].filter((pid) => pid !== process.pid)
    const cleanupBy = Date.now() + 2000
    while (pids.some(alive) && Date.now() < cleanupBy) await Bun.sleep(20)
    const abandoned = pids.filter(alive)
    for (const pid of abandoned) signal(pid, 'SIGKILL')
    const containmentBy = Date.now() + 2000
    while (pids.some(alive) && Date.now() < containmentBy) await Bun.sleep(20)
    const cleanup = {
      exited,
      preTeardown,
      before,
      forcedContainment: abandoned,
      signalErrors,
      evidenceErrors,
      primaryFailure: primary ? String(primary) : null,
      nativeAlive: alive(child.pid),
      groupAlive: alive(-child.pid),
      pids: pids.map((pid) => ({ pid, alive: alive(pid) })),
    }
    try {
      save(join(r.root, 'cleanup.json'), cleanup)
    } catch (error) {
      if (!primary) throw error
      console.error(`Secondary cleanup receipt failure: ${String(error)}`)
    }
    if (!primary)
      assert.ok(
        !signalErrors.length &&
          !evidenceErrors.length &&
          (boundary || !abandoned.length) &&
          !cleanup.nativeAlive &&
          !cleanup.groupAlive &&
          cleanup.pids.every((p) => !p.alive),
        'Native children required forced containment',
      )
  }
}
