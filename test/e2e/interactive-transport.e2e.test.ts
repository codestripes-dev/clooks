import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  CallToolResultSchema,
  ElicitRequestSchema,
  type ElicitRequest,
  type ElicitRequestFormParams,
  type ElicitResult,
} from '@modelcontextprotocol/sdk/types.js'
import { createSandbox, formatDiagnostics, type Sandbox } from './helpers/sandbox'

const binary = join(import.meta.dir, '../../dist/clooks')
const channelModule = join(import.meta.dir, '../../src/interaction/channel.ts')
let sandbox: Sandbox
const clients: Client[] = []
const commands: Bun.Subprocess<'ignore', 'pipe', 'pipe'>[] = []

afterEach(async () => {
  try {
    for (const client of clients.splice(0)) await client.close()
  } finally {
    try {
      for (const command of commands.splice(0)) {
        if (command.exitCode === null) command.kill('SIGKILL')
        await command.exited
      }
    } finally {
      sandbox?.cleanup()
    }
  }
})

async function connect(args = ['mcp']) {
  const client = new Client(
    { name: 'clooks-compiled-transport-test', version: '1.0.0' },
    { capabilities: { elicitation: { form: {} } } },
  )
  clients.push(client)
  const transport = new StdioClientTransport({
    command: binary,
    args,
    cwd: sandbox.dir,
    env: {
      HOME: sandbox.home,
      CLOOKS_HOME_ROOT: sandbox.home,
      PATH: '/usr/local/bin:/usr/bin:/bin',
    },
    stderr: 'pipe',
  })
  let stderr = ''
  const errors: Error[] = []
  transport.stderr!.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  client.onerror = (error) => errors.push(error)
  await client.connect(transport, { timeout: 5000 })
  return { client, transport, errors, stderr: () => stderr }
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Transport did not settle within 5 seconds')),
          5000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function identity(provider: 'claude-code' | 'codex' = 'claude-code') {
  return {
    protocol: 1,
    provider,
    owner: 'project:e2e',
    session_id: 'compiled-session',
    tool_use_id: crypto.randomUUID(),
    ...(provider === 'codex' ? { turn_id: 'compiled-turn' } : {}),
  }
}

const expectedApprovalSchema = {
  type: 'object',
  properties: {
    decision: {
      type: 'string',
      title: 'Decision',
      enum: ['Decline', 'Approve'],
    },
  },
  required: ['decision'],
} satisfies ElicitRequestFormParams['requestedSchema']

function approvalMessage(question: any) {
  const { toolName, input } = question.operation
  const compactCommand =
    toolName === 'Bash' &&
    input !== null &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Object.keys(input).length === 1 &&
    Object.hasOwn(input, 'command') &&
    typeof input.command === 'string' &&
    !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(input.command)
  const operation = compactCommand
    ? `Command:\n${input.command}`
    : `Tool: ${toolName}\nInput:\n${JSON.stringify(input, null, 2)}`
  return [
    question.question ?? question.reason,
    operation,
    ...(question.question === undefined ? [] : [question.reason]),
    `Requested by ${question.hookName}`,
  ].join('\n\n')
}

function publishedQuestion(key: ReturnType<typeof identity>, ordinal: number) {
  const root = join(sandbox.home, '.clooks/.cache/approvals-live/v1')
  const matches = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(root, entry.name)
    const startPath = join(directory, 'start.json')
    const questionPath = join(directory, `question-${ordinal}.json`)
    if (!existsSync(startPath) || !existsSync(questionPath)) continue
    const start = JSON.parse(readFileSync(startPath, 'utf8'))
    if (start.key.tool_use_id !== key.tool_use_id) continue
    expect(start.key).toEqual(key)
    const packet = JSON.parse(readFileSync(questionPath, 'utf8'))
    expect(packet.key).toEqual(key)
    expect(packet.nonce).toBe(start.nonce)
    expect(packet.question.ordinal).toBe(ordinal)
    matches.push(packet.question)
  }
  expect(matches, 'Expected one mailbox-bound approval question').toHaveLength(1)
  return matches[0]!
}

function assertApprovalRequest(
  request: ElicitRequest,
  key: ReturnType<typeof identity>,
  ordinal: number,
) {
  if (!('requestedSchema' in request.params)) throw new Error('Expected form elicitation')
  const question = publishedQuestion(key, ordinal)
  expect(request.params.message).toBe(approvalMessage(question))
  expect(request.params.requestedSchema).toEqual(expectedApprovalSchema)
  return question
}

function nativeOutput(value: unknown) {
  const result = CallToolResultSchema.parse(value)
  expect(result.isError).not.toBe(true)
  expect(result.content).toHaveLength(1)
  const content = result.content[0]!
  expect(content.type).toBe('text')
  if (content.type !== 'text') throw new Error('Expected native hook JSON text')
  return JSON.parse(content.text)
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (!sandbox.fileExists(path)) {
    if (Date.now() >= deadline) throw new Error(`Command did not publish ${path}`)
    await Bun.sleep(10)
  }
}

async function startCommand(key: ReturnType<typeof identity>, count = 2, suppressed = false) {
  // Exercise the real command API in a separate process, without engine integration.
  sandbox.writeFile(
    'command.ts',
    `import { createApprovalInteraction } from ${JSON.stringify(channelModule)}
import { writeFileSync } from 'node:fs'
const { key, count, suppressed } = JSON.parse(process.argv[2])
const channel = await createApprovalInteraction({
  identity: key, disposition: suppressed ? 'suppressed' : 'run',
})
const replies = []
try {
  writeFileSync('command-ready', '')
  for (let ordinal = 1; ordinal <= count; ordinal++) {
    const reply = await channel.request({
      hookName: 'checkpoint-' + ordinal,
      ordinal,
      reason: 'Approve checkpoint ' + ordinal,
      operation: { toolName: 'mcp__fixture__write', input: ['exact', { ordinal }] },
    }, new AbortController().signal)
    replies.push(reply)
    writeFileSync('reply-' + ordinal, '')
    if (reply.kind !== 'approved') break
  }
} finally {
  await channel.close()
  writeFileSync('command-closed', '')
}
console.log(JSON.stringify(replies))
`,
  )
  const command = Bun.spawn(
    ['bun', join(sandbox.dir, 'command.ts'), JSON.stringify({ key, count, suppressed })],
    {
      cwd: sandbox.dir,
      env: {
        HOME: sandbox.home,
        CLOOKS_HOME_ROOT: sandbox.home,
        PATH: '/usr/local/bin:/usr/bin:/bin',
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 8000,
    },
  )
  commands.push(command)
  const output = Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
    command.exited,
  ])
  await waitForFile('command-ready')
  return {
    command,
    async finish(): Promise<Array<{ kind: string; message?: string }>> {
      const [stdout, stderr, exitCode] = await bounded(output)
      expect(exitCode, stderr).toBe(0)
      expect(command.signalCode).toBeNull()
      expect(stderr).toBe('')
      expect(sandbox.fileExists('command-closed')).toBe(true)
      return JSON.parse(stdout)
    },
  }
}

describe('compiled shared approval transport', () => {
  test('official SDK initializes and lists check without executing configured hooks', async () => {
    sandbox = createSandbox()
    sandbox.writeConfig('invalid: [yaml')
    const connection = await connect(['--json', 'mcp'])
    expect(connection.client.getServerCapabilities()?.tools).toBeDefined()
    const result = await connection.client.listTools()
    expect(result.tools.map((tool) => tool.name)).toEqual(['check'])
    expect(result.tools[0]!.inputSchema.type).toBe('object')
    expect(connection.errors).toEqual([])
    expect(connection.stderr()).toBe('')
  })

  test.each(['claude-code', 'codex'] as const)(
    '%s unmatched check is neutral and never elicits approval',
    async (provider) => {
      sandbox = createSandbox()
      const connection = await connect()
      let prompts = 0
      connection.client.setRequestHandler(ElicitRequestSchema, async () => {
        prompts++
        return { action: 'accept', content: { decision: 'Approve' } }
      })
      const result = await connection.client.callTool(
        { name: 'check', arguments: identity(provider) },
        undefined,
        { timeout: 5000 },
      )
      expect(nativeOutput(result)).toEqual({})
      expect(prompts).toBe(0)
      expect(connection.errors).toEqual([])
      expect(connection.stderr()).toBe('')
    },
  )

  test('invalid protocol returns native denial, not an MCP tool error', async () => {
    sandbox = createSandbox()
    const connection = await connect()
    const result = await connection.client.callTool({
      name: 'check',
      arguments: { ...identity(), protocol: 2 },
    })
    expect(nativeOutput(result).hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: expect.any(String),
    })
    expect(connection.errors).toEqual([])
    expect((await connection.client.listTools()).tools).toHaveLength(1)
  })

  test.each([
    { provider: 'claude-code', declineAt: 0 },
    { provider: 'codex', declineAt: 0 },
    { provider: 'claude-code', declineAt: 1 },
    { provider: 'codex', declineAt: 2 },
  ] as const)(
    'real command channel relays sequential consent: %j',
    async ({ provider, declineAt }) => {
      sandbox = createSandbox()
      const connection = await connect()
      const key = identity(provider)
      const command = await startCommand(key)
      let ordinal = 0
      connection.client.setRequestHandler(ElicitRequestSchema, async (request) => {
        ordinal++
        expect(assertApprovalRequest(request, key, ordinal)).toEqual({
          hookName: 'checkpoint-' + ordinal,
          ordinal,
          reason: 'Approve checkpoint ' + ordinal,
          operation: { toolName: 'mcp__fixture__write', input: ['exact', { ordinal }] },
        })
        expect(request.params.mode).toBe('form')
        expect(sandbox.fileExists('reply-' + ordinal)).toBe(false)
        expect(sandbox.fileExists('command-closed')).toBe(false)
        return ordinal === declineAt
          ? { action: 'decline' }
          : { action: 'accept', content: { decision: 'Approve' } }
      })
      const result = nativeOutput(
        await connection.client.callTool({ name: 'check', arguments: key }, undefined, {
          timeout: 5000,
        }),
      )
      const replies = await command.finish()
      expect(ordinal).toBe(declineAt || 2)
      expect(replies.map((reply) => reply.kind)).toEqual(
        declineAt === 1
          ? ['declined']
          : declineAt === 2
            ? ['approved', 'declined']
            : ['approved', 'approved'],
      )
      if (declineAt) {
        expect(result.hookSpecificOutput.permissionDecision).toBe('deny')
        expect(result.hookSpecificOutput.permissionDecisionReason).toBeTruthy()
      } else {
        expect(result).toEqual({})
      }
      expect(connection.errors).toEqual([])
      expect(connection.stderr()).toBe('')
    },
  )

  test.each([false, true])(
    'completed no-ask command is neutral (suppressed=%s)',
    async (suppressed) => {
      sandbox = createSandbox()
      const key = identity()
      const command = await startCommand(key, 0, suppressed)
      expect(await command.finish()).toEqual([])
      const connection = await connect()
      let prompts = 0
      connection.client.setRequestHandler(ElicitRequestSchema, async () => {
        prompts++
        return { action: 'accept', content: { decision: 'Approve' } }
      })
      const result = await connection.client.callTool(
        { name: 'check', arguments: key },
        undefined,
        { timeout: 5000 },
      )
      expect(nativeOutput(result)).toEqual({})
      expect(prompts).toBe(0)
      expect(connection.errors).toEqual([])
    },
  )

  test.each(['request-cancel', 'EOF', 'SIGINT', 'SIGTERM'] as const)(
    '%s closes an active check and releases the command without approval',
    async (action) => {
      sandbox = createSandbox()
      const connection = await connect()
      const key = identity()
      const command = await startCommand(key)
      const prompt = Promise.withResolvers<void>()
      const response = Promise.withResolvers<ElicitResult>()
      const controller = new AbortController()
      let prompts = 0
      connection.client.setRequestHandler(ElicitRequestSchema, async (request) => {
        prompts++
        assertApprovalRequest(request, key, 1)
        prompt.resolve()
        return response.promise
      })
      const check = connection.client
        .callTool({ name: 'check', arguments: key }, undefined, {
          signal: controller.signal,
          timeout: 5000,
        })
        .then(
          (result) => ({ result }),
          (error: unknown) => ({ error }),
        )
      try {
        await bounded(prompt.promise)
        expect(prompts).toBe(1)
        expect(sandbox.fileExists('reply-1')).toBe(false)
        if (action === 'request-cancel') {
          controller.abort()
        } else if (action === 'EOF') {
          const kill = spyOn(ChildProcess.prototype, 'kill')
          try {
            await bounded(connection.client.close())
            expect(kill).not.toHaveBeenCalled()
          } finally {
            kill.mockRestore()
          }
        } else {
          const closed = Promise.withResolvers<void>()
          connection.client.onclose = () => closed.resolve()
          const pid = connection.transport.pid
          expect(pid).not.toBeNull()
          process.kill(pid!, action)
          await bounded(closed.promise)
          expect(connection.transport.pid).toBeNull()
          expect(() => process.kill(pid!, 0)).toThrow()
        }
        const outcome = await bounded(check)
        if ('result' in outcome) {
          expect(nativeOutput(outcome.result).hookSpecificOutput.permissionDecision).toBe('deny')
        } else {
          expect(outcome.error).toBeInstanceOf(Error)
        }
        const replies = await command.finish()
        expect(replies.map((reply) => reply.kind)).toEqual(['cancelled'])
        expect(prompts).toBe(1)
        expect(sandbox.fileExists('reply-2')).toBe(false)
        if (action === 'request-cancel') {
          expect((await connection.client.listTools()).tools).toHaveLength(1)
        }
        expect(connection.stderr()).toBe('')
      } finally {
        response.resolve({ action: 'cancel' })
        controller.abort()
        await bounded(check)
      }
    },
    15000,
  )

  test.each([
    { args: ['mcp', '--help'] },
    { args: ['mcp', '--version'] },
    { args: ['--json', 'mcp', '--help'] },
    { args: ['mcp', '--invalid-option'] },
  ])('MCP CLI output stays off stdout: %j', ({ args }) => {
    sandbox = createSandbox()
    const argv: string[] = [...args]
    const result = sandbox.run(argv, { timeout: 5000 })
    expect(result.rawExitCode, formatDiagnostics(result)).toBe(
      argv.includes('--invalid-option') ? 1 : 0,
    )
    expect(result.signalCode, formatDiagnostics(result)).toBeNull()
    expect(result.stdout).toBe('')
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  test('EOF before initialization exits normally with no CLI output', () => {
    sandbox = createSandbox()
    const result = sandbox.run(['mcp'], { stdin: '', timeout: 5000 })
    expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
    expect(result.signalCode, formatDiagnostics(result)).toBeNull()
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  test.each(['SIGINT', 'SIGTERM'] as const)(
    '%s closes initialized SDK transport',
    async (signal) => {
      sandbox = createSandbox()
      const connection = await connect()
      expect((await connection.client.listTools()).tools).toHaveLength(1)
      const closed = Promise.withResolvers<void>()
      connection.client.onclose = () => closed.resolve()
      const pid = connection.transport.pid
      expect(pid).not.toBeNull()
      process.kill(pid!, signal)
      await bounded(closed.promise)
      expect(connection.transport.pid).toBeNull()
      expect(() => process.kill(pid!, 0)).toThrow()
      expect(connection.errors).toEqual([])
      expect(connection.stderr()).toBe('')
    },
  )
})
