import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { createRegistrationSandbox, registrationEnv } from './helpers/registration'
import { formatDiagnostics, type RunResult, type Sandbox } from './helpers/sandbox'
import {
  acceptedApproval,
  assertCompanion,
  assertEmittedDenialReceipt,
  bounded,
  cleanupAll,
  connectApprovalPeer,
  invocation,
  startCommand,
  type ApprovalIdentity,
  type Provider,
} from './helpers/live-approvals'

// Execute generated registrations with the SDK, without emulating native trust or tool dispatch.
type Scope = 'project' | 'global'
type Handler = {
  type: string
  command?: string
  timeout?: number
  server?: string
  tool?: string
  input?: Record<string, unknown>
}
type HooksFile = { hooks?: Record<string, Array<{ hooks: Handler[] }>> }
type Server = { command: string; args: string[]; env?: Record<string, string>; enabled?: boolean }
let sandbox: Sandbox
const processes: ReturnType<typeof startCommand>[] = []
const peers: Awaited<ReturnType<typeof connectApprovalPeer>>[] = []
afterEach(async () =>
  cleanupAll(
    ...peers.splice(0).map((peer) => () => peer.close()),
    ...processes.splice(0).map((process) => () => process.close()),
    () => sandbox?.cleanup(),
  ),
)

function paths(
  provider: Provider,
  scope: Scope,
  env: Record<string, string> = {},
  projectRoot = sandbox.dir,
) {
  const root = scope === 'project' ? projectRoot : sandbox.home
  const codex =
    scope === 'project' ? join(root, '.codex') : (env.CODEX_HOME ?? join(root, '.codex'))
  return provider === 'claude-code'
    ? {
        hooks: join(root, '.claude/settings.json'),
        server: join(root, scope === 'project' ? '.mcp.json' : '.claude.json'),
      }
    : { hooks: join(codex, 'hooks.json'), server: join(codex, 'config.toml') }
}
function bytes(path: string) {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}
function json(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
function cli(args: string[], env: Record<string, string> = {}) {
  const result = sandbox.run([...args, '--json'], { env })
  expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
  expect(result.signalCode).toBeNull()
  expect(result.stderr, formatDiagnostics(result)).toBe('')
  const value = JSON.parse(result.stdout)
  expect(value.ok).toBe(true)
  return value
}
function publicationFailure(result: RunResult, destination: string) {
  expect(result.rawExitCode, formatDiagnostics(result)).toBe(1)
  expect(result.signalCode).toBeNull()
  const value = JSON.parse(result.stdout)
  expect(value.ok).toBe(false)
  expect(value.error).toMatch(/EACCES|permission denied/i)
  expect(value.error).toContain(join(dirname(destination), '.' + basename(destination) + '.'))
  expect(value.error).toContain('.tmp')
}
function init(provider: Provider | 'all', scope: Scope, env: Record<string, string> = {}) {
  return cli(['init', '--agent', provider, ...(scope === 'global' ? ['--global'] : [])], env)
}
function unhook(provider: Provider, scope: Scope, env: Record<string, string> = {}) {
  return cli(['uninstall', `--${scope}`, '--agent', provider, '--unhook', '--force'], env)
}
function server(
  provider: Provider,
  scope: Scope,
  env: Record<string, string> = {},
  projectRoot = sandbox.dir,
): Server | undefined {
  const path = paths(provider, scope, env, projectRoot).server
  const text = bytes(path)
  if (text === undefined) return undefined
  return provider === 'claude-code'
    ? JSON.parse(text).mcpServers?.clooks
    : (Bun.TOML.parse(text) as { mcp_servers?: Record<string, Server> }).mcp_servers?.clooks
}
function pairing(
  provider: Provider,
  scope: Scope,
  env: Record<string, string> = {},
  projectRoot = sandbox.dir,
) {
  const document = json(paths(provider, scope, env, projectRoot).hooks) as HooksFile
  const groups = document.hooks?.PreToolUse ?? []
  const paired = groups.filter((group) =>
    group.hooks.some((hook) => hook.type === 'mcp_tool' && hook.server === 'clooks'),
  )
  expect(paired).toHaveLength(1)
  expect(paired[0]).toMatchObject({ matcher: '*' })
  const handlers = paired[0]!.hooks
  expect(handlers).toHaveLength(2)
  const check = handlers.find((hook) => hook.type === 'mcp_tool')!
  const command = handlers.find((hook) => hook.type === 'command')!
  expect(command.command).toBeString()
  expect(command.timeout).toBe(2_147_483)
  expect(command).not.toHaveProperty('async')
  const owner = check.input?.owner
  if (scope === 'global') expect(owner).toBe('global')
  else expect(owner).toMatch(/^project:[a-f0-9]{32}$/)
  expect(check).toEqual({
    type: 'mcp_tool',
    server: 'clooks',
    tool: 'check',
    timeout: 2_147_483,
    input: {
      protocol: 1,
      provider,
      owner,
      session_id: '${session_id}',
      tool_use_id: '${tool_use_id}',
      ...(provider === 'codex' ? { turn_id: '${turn_id}' } : {}),
    },
  })
  for (const [event, entries] of Object.entries(document.hooks!)) {
    if (event === 'PreToolUse') continue
    expect(entries.flatMap((entry) => entry.hooks).some((hook) => hook.type === 'mcp_tool')).toBe(
      false,
    )
  }
  const registeredServer = server(provider, scope, env, projectRoot)
  expect(registeredServer).toMatchObject({ command: 'clooks', args: ['mcp'] })
  if (provider === 'codex')
    expect(registeredServer).toMatchObject({ startup_timeout_sec: 10, tool_timeout_sec: 2_147_483 })
  else expect(registeredServer).toMatchObject({ timeout: 2_147_483_000 })
  return { command: command.command!, check, server: registeredServer!, owner: owner as string }
}
function callFor(provider: Provider, pair: ReturnType<typeof pairing>) {
  const call = invocation(sandbox, provider, { owner: pair.owner })
  // Expand only native schema placeholders; literal registration values remain authoritative.
  const payload: Record<string, unknown> = call.payload
  const identity = Object.fromEntries(
    Object.entries(pair.check.input!).map(([key, value]) => [
      key,
      typeof value === 'string' && value === '${' + key + '}' ? payload[key] : value,
    ]),
  )
  expect(identity).toEqual({ ...call.identity })
  return { ...call, identity: identity as unknown as ApprovalIdentity }
}
function launch(
  command: string,
  payload: unknown,
  env: Record<string, string> = {},
  cwd = sandbox.dir,
) {
  const process = startCommand(
    sandbox,
    ['/bin/bash', '-c', command],
    payload,
    {
      ...registrationEnv(sandbox),
      CLAUDE_PROJECT_DIR: cwd,
      ...env,
    },
    cwd,
  )
  processes.push(process)
  return process
}
async function connect(registered: Server, env: Record<string, string> = {}) {
  const peer = await connectApprovalPeer(sandbox, {
    command: registered.command,
    args: registered.args,
    env: { ...registrationEnv(sandbox), ...registered.env, ...env },
  })
  peers.push(peer)
  return peer
}
function output(result: RunResult) {
  expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
  expect(result.signalCode).toBeNull()
  expect(result.stderr, formatDiagnostics(result)).toBe('')
  return result.stdout ? JSON.parse(result.stdout) : {}
}
function expectAllowed(result: RunResult, provider: Provider) {
  expect(output(result)).toEqual(
    provider === 'claude-code'
      ? {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: 'registration consent',
          },
        }
      : {
          systemMessage:
            'clooks: PreToolUse allow reason (human annotation only; original allow-reason recipient unavailable; native policy retained): registration consent',
        },
  )
}
function installHook(ask = true) {
  sandbox.writeConfig('version: "1.0.0"\nobserve: { handoff: false, maxFailures: 0 }\n')
  sandbox.writeHook(
    'observe.ts',
    `
import { appendFileSync } from 'node:fs'
export const hook = { meta: { name: 'observe' }, PreToolUse(ctx) {
  appendFileSync(${JSON.stringify(join(sandbox.dir, 'calls.jsonl'))}, JSON.stringify({ input: ctx.toolInput }) + '\\n')
  return ${ask ? "ctx.ask({ reason: 'registration consent' })" : 'ctx.skip()'}
} }
`,
  )
}
function calls() {
  return sandbox.fileExists('calls.jsonl')
    ? sandbox
        .readFile('calls.jsonl')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : []
}
function mailbox(identity: ApprovalIdentity) {
  const root = join(sandbox.home, '.clooks/.cache/approvals-live/v1')
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(root, entry.name)
    const start = json(join(directory, 'start.json'))
    if (start.key.owner !== identity.owner || start.key.tool_use_id !== identity.tool_use_id)
      continue
    expect(start.key).toEqual(identity)
    return { directory, start }
  }
  throw new Error('Generated launcher did not publish completion')
}
function completion(identity: ApprovalIdentity) {
  const { directory, start } = mailbox(identity)
  const done = json(join(directory, 'done.json'))
  expect(done.key).toEqual(identity)
  expect(done.nonce).toBe(start.nonce)
  return { start, done }
}

const foreignHandler = { type: 'command', command: 'printf foreign-handler' }
const foreignServer = { command: 'foreign-server', args: ['--keep'] }
const foreignTomlRoot = '# retain unrelated formatting\nmodel = "fixture"\n\n'
const foreignTomlTable =
  '[mcp_servers.foreign]\ncommand = "foreign-server"\nargs = ["--keep"] # preserve comment\n'
const foreignToml = foreignTomlRoot + foreignTomlTable
function seed(provider: Provider, scope: Scope, env: Record<string, string> = {}) {
  const destination = paths(provider, scope, env)
  const put = (path: string, text: string) => sandbox.writeFile(relative(sandbox.dir, path), text)
  put(
    destination.hooks,
    JSON.stringify({
      permissions: { keep: ['unchanged'] },
      hooks: { PreToolUse: [{ hooks: [foreignHandler] }] },
    }),
  )
  put(
    destination.server,
    provider === 'claude-code'
      ? JSON.stringify({ keep: { trust: false }, mcpServers: { foreign: foreignServer } }) + '\n'
      : foreignToml,
  )
}
function preserved(provider: Provider, scope: Scope, env: Record<string, string> = {}) {
  const destination = paths(provider, scope, env)
  expect(json(destination.hooks).permissions).toEqual({ keep: ['unchanged'] })
  expect(
    json(destination.hooks).hooks.PreToolUse.flatMap((group: { hooks: Handler[] }) => group.hooks),
  ).toContainEqual(foreignHandler)
  if (provider === 'claude-code') {
    expect(json(destination.server).keep).toEqual({ trust: false })
    expect(json(destination.server).mcpServers.foreign).toEqual(foreignServer)
  } else {
    const text = readFileSync(destination.server, 'utf8')
    expect(text.startsWith(foreignTomlRoot)).toBe(true)
    expect(text.endsWith(foreignTomlTable)).toBe(true)
    const { mcp_servers, ...root } = Bun.TOML.parse(text) as Record<string, unknown>
    const { clooks: _clooks, ...foreign } = mcp_servers as Record<string, unknown>
    expect(root).toEqual({ model: 'fixture' })
    expect(foreign).toEqual({ foreign: foreignServer })
  }
}

describe('compiled generated approval registrations', () => {
  test("command cleanup reaps an exited shell's held child and closes inherited pipes", async () => {
    sandbox = createRegistrationSandbox()
    const command = startCommand(
      sandbox,
      [
        '/bin/bash',
        '-c',
        'sh -c \'trap "" TERM; printf "%s" "$$" > "$CHILD_PID"; exec sleep 60\' & exit 0',
      ],
      {},
      { CHILD_PID: join(sandbox.dir, 'child.pid') },
    )
    processes.push(command)
    const deadline = performance.now() + 5000
    while (!sandbox.fileExists('child.pid') || !sandbox.readFile('child.pid')) {
      if (performance.now() >= deadline) throw new Error('Held child did not start')
      await Bun.sleep(10)
    }
    const child = Number(sandbox.readFile('child.pid'))
    expect(Number.isSafeInteger(child)).toBe(true)
    expect(child).toBeGreaterThan(0)
    expect(await bounded(command.process.exited, 'Shell exit')).toBe(0)
    expect(() => process.kill(child, 0)).not.toThrow()
    let drained = false
    void command.result.then(
      () => {
        drained = true
      },
      () => {},
    )
    await Bun.sleep(25)
    expect(drained).toBe(false)
    await command.close()
    expect(drained).toBe(true)
    expect(() => process.kill(child, 0)).toThrow()
    expect(() => process.kill(-command.process.pid, 0)).toThrow()
  }, 15_000)

  test('both agents and scopes: both companions settle while only the global pipeline runs', async () => {
    sandbox = createRegistrationSandbox()
    init('all', 'project')
    init('all', 'global')
    installHook()
    for (const provider of ['claude-code', 'codex'] as const) {
      const project = pairing(provider, 'project')
      const global = pairing(provider, 'global')
      const peer = await connect(global.server)
      const call = callFor(provider, global)
      const projectIdentity = { ...call.identity, owner: project.owner }
      const suppressed = launch(project.command, call.payload)
      const active = launch(global.command, call.payload)
      const suppressedCheck = peer.check(projectIdentity)
      const activeCheck = peer.check(call.identity)
      const prompt = await peer.nextPrompt()
      expect(output(await suppressed.result)).toEqual({})
      assertCompanion(await suppressedCheck)
      expect(completion(projectIdentity).start.disposition).toBe('suppressed')
      expect(active.stdout).toBe('')
      expect(calls()).toHaveLength(provider === 'claude-code' ? 1 : 2)
      prompt.reply(acceptedApproval(provider))
      expectAllowed(await active.result, provider)
      assertCompanion(await activeCheck)
      expect(completion(call.identity).start.disposition).toBe('run')
      expect(peer.prompts).toHaveLength(1)
    }
    expect(calls()).toHaveLength(2)
  }, 20_000)

  for (const provider of ['claude-code', 'codex'] as const) {
    for (const scope of ['project', 'global'] as const) {
      test(`${provider} ${scope}: re-init upgrades 330-second approvals and preserves unrelated metadata`, () => {
        sandbox = createRegistrationSandbox()
        seed(provider, scope)
        init(provider, scope)
        const original = pairing(provider, scope)
        const destination = paths(provider, scope)
        const document = json(destination.hooks) as HooksFile
        const group = document.hooks!.PreToolUse!.find((entry) =>
          entry.hooks.some((hook) => hook.type === 'mcp_tool' && hook.server === 'clooks'),
        )!
        for (const handler of group.hooks) handler.timeout = 330
        const unrelated = { ...foreignHandler, command: 'printf unrelated-timeout', timeout: 111 }
        document.hooks!.PreToolUse!.unshift({ hooks: [unrelated] })
        const { PreToolUse: _pre, ...otherEvents } = document.hooks!
        sandbox.writeFile(relative(sandbox.dir, destination.hooks), JSON.stringify(document))
        const metadata = {
          env: { KEEP_APPROVAL_METADATA: 'retained' },
          description: 'keep server metadata',
        }
        if (provider === 'claude-code') {
          const servers = json(destination.server)
          Object.assign(servers.mcpServers.clooks, metadata, { timeout: 330_000 })
          sandbox.writeFile(relative(sandbox.dir, destination.server), JSON.stringify(servers))
        } else {
          sandbox.writeFile(
            relative(sandbox.dir, destination.server),
            foreignTomlRoot +
              '[mcp_servers.clooks]\ncommand = "clooks"\nargs = ["mcp"]\n' +
              'startup_timeout_sec = 10\ntool_timeout_sec = 330 # upgrade this value\n' +
              'description = "keep server metadata"\n' +
              'env = { KEEP_APPROVAL_METADATA = "retained" }\n\n' +
              foreignTomlTable,
          )
        }
        init(provider, scope)
        const upgraded = pairing(provider, scope)
        expect(upgraded.owner).toBe(original.owner)
        expect(upgraded.command).toBe(original.command)
        expect(upgraded.server).toMatchObject(metadata)
        preserved(provider, scope)
        const { PreToolUse, ...remainingEvents } = json(destination.hooks).hooks
        expect(remainingEvents).toEqual(otherEvents)
        expect(PreToolUse.flatMap((entry: { hooks: Handler[] }) => entry.hooks)).toContainEqual(
          unrelated,
        )
        if (provider === 'codex')
          expect(bytes(destination.server)).toContain(
            'tool_timeout_sec = 2147483 # upgrade this value',
          )
        const upgradedBytes = [bytes(destination.hooks), bytes(destination.server)]
        init(provider, scope)
        expect([bytes(destination.hooks), bytes(destination.server)]).toEqual(upgradedBytes)
        expect(pairing(provider, scope).owner).toBe(original.owner)
      })

      test(`${provider} ${scope}: generated command and server consent, preservation and byte-stable init`, async () => {
        sandbox = createRegistrationSandbox()
        seed(provider, scope)
        init(provider, scope)
        const pair = pairing(provider, scope)
        preserved(provider, scope)
        const destination = paths(provider, scope)
        const before = [
          bytes(destination.hooks),
          bytes(destination.server),
          bytes(join(scope === 'global' ? sandbox.home : sandbox.dir, '.clooks/bin/entrypoint.sh')),
        ]
        init(provider, scope)
        expect([
          bytes(destination.hooks),
          bytes(destination.server),
          bytes(join(scope === 'global' ? sandbox.home : sandbox.dir, '.clooks/bin/entrypoint.sh')),
        ]).toEqual(before)
        expect(pairing(provider, scope).owner).toBe(pair.owner)
        installHook()
        const peer = await connect(pair.server)
        for (const accept of [true, false]) {
          const call = callFor(provider, pair)
          const process = launch(pair.command, call.payload)
          const check = peer.check(call.identity)
          const prompt = await peer.nextPrompt()
          expect(prompt.question).toMatchObject({
            hookName: 'observe',
            reason: 'registration consent',
            operation: { toolName: call.payload.tool_name, input: call.payload.tool_input },
          })
          expect(process.stdout).toBe('')
          prompt.reply(accept ? acceptedApproval(provider) : { action: 'decline' })
          const result = await bounded(process.result, 'Registered command')
          const checkResult = await check
          if (accept) expectAllowed(result, provider)
          else {
            const value = output(result)
            expect(value).toEqual({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: '[observe] Approval declined. Operation not run.',
              },
            })
            assertCompanion(checkResult)
            assertEmittedDenialReceipt(sandbox, call.identity, value)
          }
          if (accept) assertCompanion(checkResult)
          expect(completion(call.identity).start.disposition).toBe('run')
        }
        expect(calls()).toHaveLength(2)
        expect(peer.prompts).toHaveLength(2)
        expect(peer.errors).toEqual([])
        expect(peer.stderr).toBe('')
      }, 20_000)

      test(`${provider} ${scope}: no-ask completion precedes return without a peer`, async () => {
        sandbox = createRegistrationSandbox()
        init(provider, scope)
        const pair = pairing(provider, scope)
        installHook(false)
        const call = callFor(provider, pair)
        expect(output(await launch(pair.command, call.payload).result)).toEqual({})
        expect(completion(call.identity).done.failure).toBeUndefined()
        expect(calls()).toHaveLength(1)
        const peer = await connect(pair.server)
        assertCompanion(await peer.check(call.identity))
        expect(peer.prompts).toHaveLength(0)
      })
    }

    test(`${provider}: scoped unhook preserves the other scope and live server coordination`, async () => {
      sandbox = createRegistrationSandbox()
      seed(provider, 'project')
      seed(provider, 'global')
      init(provider, 'project')
      init(provider, 'global')
      const project = pairing(provider, 'project')
      const global = pairing(provider, 'global')
      const globalPaths = paths(provider, 'global')
      const before = [bytes(globalPaths.hooks), bytes(globalPaths.server)]
      const peer = await connect(global.server)
      installHook()
      const call = callFor(provider, global)
      const process = launch(global.command, call.payload)
      const check = peer.check(call.identity)
      const prompt = await peer.nextPrompt()
      unhook(provider, 'project')
      expect([bytes(globalPaths.hooks), bytes(globalPaths.server)]).toEqual(before)
      expect(server(provider, 'project')).toBeUndefined()
      preserved(provider, 'project')
      expect(sandbox.fileExists('.clooks/hooks/observe.ts')).toBe(true)
      expect(project.owner).not.toBe(global.owner)
      prompt.reply(acceptedApproval(provider))
      expectAllowed(await process.result, provider)
      assertCompanion(await check)
      completion(call.identity)
      expect(calls()).toHaveLength(1)
      expect((await peer.client.listTools()).tools.map((tool) => tool.name)).toEqual(['check'])
      const next = callFor(provider, global)
      const surviving = launch(global.command, next.payload)
      const nextCheck = peer.check(next.identity)
      ;(await peer.nextPrompt()).reply(acceptedApproval(provider))
      expectAllowed(await surviving.result, provider)
      assertCompanion(await nextCheck)
      expect(calls()).toHaveLength(2)
    }, 15_000)

    test(`${provider}: copied project keeps its owner and executes hooks from the new quoted path`, async () => {
      sandbox = createRegistrationSandbox()
      init(provider, 'project')
      installHook()
      const original = pairing(provider, 'project')
      const copy = join(dirname(sandbox.dir), "copied project's path")
      cpSync(sandbox.dir, copy, { recursive: true })
      sandbox.writeFile(
        relative(sandbox.dir, join(copy, '.clooks/hooks/observe.ts')),
        `
import { appendFileSync } from 'node:fs'
export const hook = { meta: { name: 'observe' }, PreToolUse(ctx) {
  appendFileSync(${JSON.stringify(join(copy, 'copied-calls'))}, 'copy\\n')
  return ctx.ask({ reason: 'copied registration consent' })
} }
`,
      )
      const copied = pairing(provider, 'project', {}, copy)
      expect(copied.owner).toBe(original.owner)
      expect(copied.command).toBe(original.command)
      expect(copied.command).not.toContain(sandbox.dir)
      const peer = await connect(copied.server)
      const call = callFor(provider, copied)
      call.payload.cwd = copy
      const process = launch(copied.command, call.payload, {}, copy)
      const check = peer.check(call.identity)
      const prompt = await peer.nextPrompt()
      expect(prompt.question.reason).toBe('copied registration consent')
      prompt.reply(acceptedApproval(provider))
      const value = output(await process.result)
      if (provider === 'claude-code')
        expect(value.hookSpecificOutput).toEqual({
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'copied registration consent',
        })
      else
        expect(value).toEqual({
          systemMessage:
            'clooks: PreToolUse allow reason (human annotation only; original allow-reason recipient unavailable; native policy retained): copied registration consent',
        })
      assertCompanion(await check)
      expect(readFileSync(join(copy, 'copied-calls'), 'utf8')).toBe('copy\n')
      expect(calls()).toHaveLength(0)
      expect(sandbox.run(['init', '--agent', provider, '--json'], { cwd: copy }).rawExitCode).toBe(
        0,
      )
      expect(pairing(provider, 'project', {}, copy).owner).toBe(original.owner)
    }, 15_000)

    for (const damage of ['foreign-server', 'malformed-server'] as const) {
      test(`${provider} ${damage}: all-agent preflight leaves every selected destination unchanged`, () => {
        sandbox = createRegistrationSandbox()
        seed('claude-code', 'project')
        seed('codex', 'project')
        const destination = paths(provider, 'project').server
        const damaged =
          damage === 'malformed-server'
            ? provider === 'codex'
              ? '[mcp_servers.clooks\n'
              : '{ bad'
            : provider === 'codex'
              ? '[mcp_servers.clooks]\ncommand = "foreign-command"\nargs = ["--keep"]\n'
              : JSON.stringify({
                  mcpServers: { clooks: { command: 'foreign-command', args: ['--keep'] } },
                })
        sandbox.writeFile(relative(sandbox.dir, destination), damaged)
        const selected = ['claude-code', 'codex'].flatMap((provider) =>
          Object.values(paths(provider as Provider, 'project')),
        )
        const before = selected.map(bytes)
        const result = sandbox.run(['init', '--agent', 'all', '--json'])
        expect(result.rawExitCode, formatDiagnostics(result)).toBe(1)
        expect(JSON.parse(result.stdout).ok).toBe(false)
        expect(JSON.parse(result.stdout).error).toContain(destination)
        expect(selected.map(bytes)).toEqual(before)
        expect(sandbox.fileExists('.clooks')).toBe(false)
      })
    }

    for (const remnant of ['server-only', 'companion-only'] as const) {
      test(`${provider}: ${remnant} is detected and unhooked without touching foreign configuration`, () => {
        sandbox = createRegistrationSandbox()
        seed(provider, 'project')
        init(provider, 'project')
        const destination = paths(provider, 'project')
        const pair = pairing(provider, 'project')
        sandbox.writeFile(
          relative(sandbox.dir, destination.hooks),
          JSON.stringify({
            permissions: { keep: ['unchanged'] },
            hooks: {
              PreToolUse: [
                { hooks: [foreignHandler, ...(remnant === 'companion-only' ? [pair.check] : [])] },
              ],
            },
          }),
        )
        if (remnant === 'companion-only')
          sandbox.writeFile(
            relative(sandbox.dir, destination.server),
            provider === 'claude-code'
              ? JSON.stringify({ keep: { trust: false }, mcpServers: { foreign: foreignServer } })
              : foreignToml,
          )
        cli(['uninstall', '--project', '--unhook', '--force'])
        expect(json(destination.hooks).hooks).toEqual({ PreToolUse: [{ hooks: [foreignHandler] }] })
        expect(server(provider, 'project')).toBeUndefined()
        preserved(provider, 'project')
        expect(sandbox.fileExists('.clooks/bin/entrypoint.sh')).toBe(true)
      })
    }

    test(`${provider}: explicit native disable stays intact and no-peer only refuses an actual ask`, async () => {
      sandbox = createRegistrationSandbox()
      init(provider, 'project')
      const destination = paths(provider, 'project')
      let disabledPath: string
      if (provider === 'claude-code') {
        disabledPath = join(sandbox.home, '.claude.json')
        sandbox.writeHomeFile(
          '.claude.json',
          JSON.stringify({
            projects: {
              [sandbox.dir]: { hasTrustDialogAccepted: false, disabledMcpServers: ['clooks'] },
            },
          }),
        )
        sandbox.writeFile('.claude/settings.local.json', '{"enableAllProjectMcpServers":false}\n')
      } else {
        disabledPath = destination.server
        sandbox.writeFile(
          '.codex/config.toml',
          readFileSync(disabledPath, 'utf8') + '\nmcp_servers.clooks.enabled = false\n',
        )
        expect(server(provider, 'project')!.enabled).toBe(false)
        expect(Bun.TOML.parse(readFileSync(disabledPath, 'utf8'))).not.toHaveProperty('enabled')
      }
      const disabledBefore = bytes(disabledPath)
      init(provider, 'project')
      expect(bytes(disabledPath)).toBe(disabledBefore)
      if (provider === 'claude-code')
        expect(sandbox.readFile('.claude/settings.local.json')).toBe(
          '{"enableAllProjectMcpServers":false}\n',
        )
      else {
        expect(server(provider, 'project')!.enabled).toBe(false)
        expect(Bun.TOML.parse(readFileSync(disabledPath, 'utf8'))).not.toHaveProperty('enabled')
      }
      const pair = pairing(provider, 'project')
      // No native client is launched: deliberately omit the disabled connection.
      installHook(false)
      const noAsk = callFor(provider, pair)
      expect(output(await launch(pair.command, noAsk.payload).result)).toEqual({})
      expect(completion(noAsk.identity).done.failure).toBeUndefined()
      installHook()
      const ask = callFor(provider, pair)
      const denied = output(await launch(pair.command, ask.payload).result)
      expect(denied.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(denied.hookSpecificOutput.permissionDecisionReason).toContain('Approval unavailable')
      expect(denied.hookSpecificOutput.updatedInput).toBeUndefined()
      expect(completion(ask.identity).done.failure.kind).toBe('unavailable')
      expect(calls()).toHaveLength(2)
      expect(bytes(disabledPath)).toBe(disabledBefore)
    }, 15_000)

    test(`${provider}: re-init repairs missing server or companion without changing ownership`, () => {
      sandbox = createRegistrationSandbox()
      init(provider, 'project')
      const original = pairing(provider, 'project')
      const destination = paths(provider, 'project')
      rmSync(destination.server)
      init(provider, 'project')
      expect(pairing(provider, 'project').owner).toBe(original.owner)
      const document = json(destination.hooks) as HooksFile
      for (const group of document.hooks!.PreToolUse!)
        group.hooks = group.hooks.filter((hook) => hook.type !== 'mcp_tool')
      sandbox.writeFile(relative(sandbox.dir, destination.hooks), JSON.stringify(document))
      init(provider, 'project')
      expect(pairing(provider, 'project').owner).toBe(original.owner)
      const repaired = [bytes(destination.hooks), bytes(destination.server)]
      init(provider, 'project')
      expect([bytes(destination.hooks), bytes(destination.server)]).toEqual(repaired)
    })
  }

  test('global server publication/removal failure retains recoverable state and retries cleanly', () => {
    sandbox = createRegistrationSandbox()
    expect(process.getuid!()).not.toBe(0)
    seed('claude-code', 'global')
    sandbox.writeHomeFile('.clooks/keep', 'retain runtime')
    const destination = paths('claude-code', 'global')
    const originalServer = bytes(destination.server)
    const originalHooks = bytes(destination.hooks)
    chmodSync(sandbox.home, 0o500)
    try {
      const result = sandbox.run(['init', '--global', '--agent', 'claude-code', '--json'])
      publicationFailure(result, destination.server)
      expect(bytes(destination.server)).toBe(originalServer)
      expect(bytes(destination.hooks)).toBe(originalHooks)
      expect(sandbox.homeFileExists('.clooks/bin/entrypoint.sh')).toBe(true)
      expect(sandbox.homeFileExists('.clooks/.global-entrypoint-active')).toBe(false)
    } finally {
      chmodSync(sandbox.home, 0o700)
    }
    init('claude-code', 'global')
    pairing('claude-code', 'global')
    expect(sandbox.homeFileExists('.clooks/.global-entrypoint-active')).toBe(true)
    const registeredServer = bytes(destination.server)
    chmodSync(sandbox.home, 0o500)
    try {
      const result = sandbox.run([
        'uninstall',
        '--global',
        '--agent',
        'claude-code',
        '--full',
        '--force',
        '--json',
      ])
      publicationFailure(result, destination.server)
      expect(json(destination.hooks).hooks).toEqual({ PreToolUse: [{ hooks: [foreignHandler] }] })
      expect(bytes(destination.server)).toBe(registeredServer)
      expect(sandbox.homeFileExists('.clooks/.global-entrypoint-active')).toBe(false)
      expect(sandbox.readHomeFile('.clooks/keep')).toBe('retain runtime')
    } finally {
      chmodSync(sandbox.home, 0o700)
    }
    unhook('claude-code', 'global')
    expect(server('claude-code', 'global')).toBeUndefined()
    preserved('claude-code', 'global')
    expect(sandbox.readHomeFile('.clooks/keep')).toBe('retain runtime')
  })

  test('global full removal preserves live IPC until the pending command and companion settle', async () => {
    sandbox = createRegistrationSandbox()
    init('codex', 'global')
    installHook()
    const pair = pairing('codex', 'global')
    const peer = await connect(pair.server)
    const call = callFor('codex', pair)
    const command = launch(pair.command, call.payload)
    const check = peer.check(call.identity)
    const prompt = await peer.nextPrompt()
    const { directory } = mailbox(call.identity)
    const startBefore = bytes(join(directory, 'start.json'))
    const questionBefore = bytes(join(directory, 'question-1.json'))
    expect(questionBefore).toBeDefined()
    const removed = cli(['uninstall', '--global', '--agent', 'codex', '--full', '--force'])
    expect(removed.data).toMatchObject({
      unhooked: true,
      deleted: false,
      retainedPaths: [join(sandbox.home, '.clooks/.cache/approvals-live')],
    })
    expect(sandbox.homeFileExists('.clooks/bin/entrypoint.sh')).toBe(false)
    expect(server('codex', 'global')).toBeUndefined()
    expect(json(paths('codex', 'global').hooks).hooks).toBeUndefined()
    expect(bytes(join(directory, 'start.json'))).toBe(startBefore)
    expect(bytes(join(directory, 'question-1.json'))).toBe(questionBefore)
    expect(command.stdout).toBe('')
    expect((await peer.client.listTools()).tools.map((tool) => tool.name)).toEqual(['check'])
    prompt.reply({ action: 'accept', content: { decision: 'Approve' } })
    expectAllowed(await command.result, 'codex')
    assertCompanion(await check)
    expect(completion(call.identity).done.failure).toBeUndefined()
    expect(calls()).toHaveLength(1)
    expect(peer.prompts).toHaveLength(1)
  }, 15_000)

  test('custom CODEX_HOME server removal failure retains recovery identity through retry', () => {
    sandbox = createRegistrationSandbox()
    expect(process.getuid!()).not.toBe(0)
    const env = { CODEX_HOME: join(sandbox.home, "custom codex's config") }
    seed('codex', 'global', env)
    init('codex', 'global', env)
    const destination = paths('codex', 'global', env)
    // No owned command remains, so removal reaches the separately owned MCP write.
    sandbox.writeFile(
      relative(sandbox.dir, destination.hooks),
      JSON.stringify({
        permissions: { keep: ['unchanged'] },
        hooks: { PreToolUse: [{ hooks: [foreignHandler] }] },
      }),
    )
    const receipt = join(sandbox.home, '.clooks/.global-entrypoint-active.codex')
    const recovery = join(sandbox.home, '.clooks/.codex-registration-home')
    const before = [destination.hooks, destination.server, receipt, recovery].map(bytes)
    chmodSync(env.CODEX_HOME, 0o500)
    try {
      const result = sandbox.run(
        ['uninstall', '--global', '--agent', 'codex', '--full', '--force', '--json'],
        { env },
      )
      publicationFailure(result, destination.server)
      expect([destination.hooks, destination.server, receipt, recovery].map(bytes)).toEqual(before)
      expect(sandbox.homeFileExists('.clooks/bin/entrypoint.sh')).toBe(true)
    } finally {
      chmodSync(env.CODEX_HOME, 0o700)
    }
    const otherHome = join(sandbox.home, 'other-codex')
    const wrongHome = sandbox.run(['init', '--global', '--agent', 'codex', '--json'], {
      env: { CODEX_HOME: otherHome },
    })
    expect(wrongHome.rawExitCode, formatDiagnostics(wrongHome)).toBe(1)
    expect(JSON.parse(wrongHome.stdout).error).toContain(env.CODEX_HOME)
    expect([destination.hooks, destination.server, receipt, recovery].map(bytes)).toEqual(before)
    expect(existsSync(otherHome)).toBe(false)
    unhook('codex', 'global', env)
    expect(server('codex', 'global', env)).toBeUndefined()
    expect(bytes(receipt)).toBeUndefined()
    expect(bytes(recovery)).toBeUndefined()
    preserved('codex', 'global', env)
    expect(sandbox.homeFileExists('.clooks/bin/entrypoint.sh')).toBe(true)
  })

  test('custom CODEX_HOME config remains separate from HOME IPC and Claude override state', async () => {
    sandbox = createRegistrationSandbox()
    const env = { CODEX_HOME: join(sandbox.home, "custom codex's config"), CLAUDE_CONFIG_DIR: '' }
    sandbox.writeHomeFile('.claude/.config.json', '{"legacy":"untouched"}')
    sandbox.writeHomeFile('.codex/config.toml', 'default-home sentinel, deliberately not TOML')
    seed('codex', 'global', env)
    init('codex', 'global', env)
    const pair = pairing('codex', 'global', env)
    preserved('codex', 'global', env)
    installHook()
    // The server does not need the command's custom CODEX_HOME to locate HOME IPC.
    const peer = await connect(pair.server)
    const call = callFor('codex', pair)
    const process = launch(pair.command, call.payload, env)
    const check = peer.check(call.identity)
    const prompt = await peer.nextPrompt()
    prompt.reply({ action: 'accept', content: { decision: 'Approve' } })
    expectAllowed(await process.result, 'codex')
    assertCompanion(await check)
    completion(call.identity)
    expect(existsSync(join(env.CODEX_HOME, '.clooks/.cache/approvals-live'))).toBe(false)
    unhook('codex', 'global', env)
    expect(server('codex', 'global', env)).toBeUndefined()
    expect(sandbox.readHomeFile('.claude/.config.json')).toBe('{"legacy":"untouched"}')
    expect(sandbox.readHomeFile('.codex/config.toml')).toBe(
      'default-home sentinel, deliberately not TOML',
    )
    preserved('codex', 'global', env)
  }, 15_000)

  for (const choice of [
    'empty',
    'default-directory',
    'custom-directory',
    'legacy-layout',
  ] as const) {
    test(`selected Claude/all refuse ${choice} before init or uninstall mutations`, () => {
      sandbox = createRegistrationSandbox()
      seed('claude-code', 'project')
      seed('claude-code', 'global')
      seed('codex', 'project')
      seed('codex', 'global')
      const env: Record<string, string> =
        choice === 'legacy-layout'
          ? {}
          : {
              CLAUDE_CONFIG_DIR:
                choice === 'empty'
                  ? ''
                  : join(
                      sandbox.home,
                      choice === 'default-directory' ? '.claude' : 'custom-claude',
                    ),
            }
      if (choice === 'legacy-layout')
        sandbox.writeHomeFile('.claude/.config.json', '{"legacy":"untouched"}')
      if (choice === 'custom-directory')
        sandbox.writeHomeFile('custom-claude/.claude.json', '{"override":"untouched"}')
      const destinations = (['claude-code', 'codex'] as const).flatMap((provider) =>
        (['project', 'global'] as const).flatMap((scope) => Object.values(paths(provider, scope))),
      )
      destinations.push(
        join(sandbox.home, '.claude/.config.json'),
        join(sandbox.home, 'custom-claude/.claude.json'),
      )
      const before = destinations.map(bytes)
      for (const [command, provider, scope] of [
        ['init', 'claude-code', 'project'],
        ['init', 'all', 'global'],
        ['uninstall', 'all', 'project'],
        ['uninstall', 'claude-code', 'global'],
      ] as const) {
        const result = sandbox.run(
          [
            command,
            '--agent',
            provider,
            ...(command === 'init'
              ? scope === 'global'
                ? ['--global']
                : []
              : [`--${scope}`, '--unhook', '--force']),
            '--json',
          ],
          { env },
        )
        expect(result.rawExitCode, formatDiagnostics(result)).toBe(1)
        const value = JSON.parse(result.stdout)
        expect(value.ok).toBe(false)
        expect(value.error).toContain(
          choice === 'legacy-layout' ? '.config.json' : 'CLAUDE_CONFIG_DIR',
        )
        expect(destinations.map(bytes)).toEqual(before)
        expect(sandbox.fileExists('.clooks')).toBe(false)
        expect(sandbox.homeFileExists('.clooks')).toBe(false)
      }
    })
  }
})
