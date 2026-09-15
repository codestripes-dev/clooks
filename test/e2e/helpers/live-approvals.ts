import { join } from 'node:path'
import { kill } from 'node:process'
import { expect } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  CallToolResultSchema,
  ElicitRequestSchema,
  type ElicitResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { RunResult, Sandbox } from './sandbox'

const binary = join(import.meta.dir, '../../../dist/clooks')
const timeout = 10_000
export type Provider = 'claude-code' | 'codex'

export async function cleanupAll(...steps: Array<() => unknown | Promise<unknown>>) {
  const errors: unknown[] = []
  for (const step of steps) {
    try {
      await step()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Approval test cleanup failed')
}

export function assertCompanion(
  value: Awaited<ReturnType<Awaited<ReturnType<typeof connectApprovalPeer>>['check']>>,
  refusal?: string,
) {
  expect(value.isError).not.toBe(true)
  expect(value.content).toHaveLength(1)
  const content = value.content[0]!
  expect(content.type).toBe('text')
  if (content.type !== 'text') throw new Error('Expected native hook JSON')
  expect(JSON.parse(content.text)).toEqual(
    refusal === undefined
      ? {}
      : {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: refusal,
          },
        },
  )
}

export interface ApprovalIdentity {
  protocol: 1
  provider: Provider
  owner: string
  session_id: string
  tool_use_id: string
  turn_id?: string
}

export interface ApprovalPrompt {
  question: {
    hookName: string
    ordinal: number
    reason: string
    operation: { toolName: string; input: unknown }
  }
  schema: unknown
  reply(response: ElicitResult): void
}

export function invocation(
  sandbox: Sandbox,
  provider: Provider,
  options: { owner?: string; sessionId?: string; toolName?: string; input?: unknown } = {},
) {
  const identity: ApprovalIdentity = {
    protocol: 1,
    provider,
    owner: options.owner ?? 'project:compiled-approvals',
    session_id: options.sessionId ?? crypto.randomUUID(),
    tool_use_id: crypto.randomUUID(),
    ...(provider === 'codex' ? { turn_id: crypto.randomUUID() } : {}),
  }
  return {
    identity,
    payload: {
      hook_event_name: 'PreToolUse',
      session_id: identity.session_id,
      tool_use_id: identity.tool_use_id,
      ...(identity.turn_id ? { turn_id: identity.turn_id } : {}),
      cwd: sandbox.dir,
      transcript_path: null,
      model: 'fixture',
      permission_mode: 'default',
      tool_name: options.toolName ?? (provider === 'codex' ? 'exec_command' : 'Bash'),
      tool_input: options.input === undefined ? { command: '/usr/bin/true' } : options.input,
    },
  }
}

function environment(sandbox: Sandbox): Record<string, string> {
  return {
    HOME: sandbox.home,
    CLOOKS_HOME_ROOT: sandbox.home,
    CODEX_HOME: join(sandbox.home, '.codex'),
    PATH: join(sandbox.dir, '../bin') + ':/usr/local/bin:/usr/bin:/bin',
  }
}

// Registration supplies literal scope ownership separately from native invocation identity.
function registrationEnvironment(identity: ApprovalIdentity): Record<string, string> {
  return {
    CLOOKS_APPROVAL_OWNER: identity.owner,
    CLOOKS_APPROVAL_PROTOCOL: String(identity.protocol),
  }
}

export async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} did not settle within ${timeout}ms`)),
          timeout,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function startEngine(
  sandbox: Sandbox,
  call: ReturnType<typeof invocation>,
  extraEnvironment: Record<string, string> = {},
) {
  return startCommand(sandbox, [binary], call.payload, {
    CLOOKS_AGENT: call.identity.provider,
    ...registrationEnvironment(call.identity),
    ...extraEnvironment,
    ...environment(sandbox),
  })
}

export function startCommand(
  sandbox: Sandbox,
  command: string[],
  payload: unknown,
  extraEnvironment: Record<string, string> = {},
  cwd = sandbox.dir,
) {
  const started = performance.now()
  const process = Bun.spawn(command, {
    cwd,
    env: { ...environment(sandbox), ...extraEnvironment },
    stdin: Buffer.from(JSON.stringify(payload)),
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true,
    timeout: timeout + 5000,
  })
  let stdout = '',
    stderr = ''
  async function collect(stream: ReadableStream<Uint8Array>, append: (text: string) => void) {
    const decoder = new TextDecoder()
    for await (const chunk of stream) append(decoder.decode(chunk, { stream: true }))
    append(decoder.decode())
  }
  const result: Promise<RunResult> = Promise.all([
    process.exited,
    collect(process.stdout, (text) => {
      stdout += text
    }),
    collect(process.stderr, (text) => {
      stderr += text
    }),
  ]).then(([exitCode]) => ({
    exitCode: exitCode ?? 2,
    rawExitCode: exitCode,
    signalCode: process.signalCode ?? null,
    elapsedMs: performance.now() - started,
    stdout,
    stderr,
  }))
  void result.catch(() => {})
  let groupReleased = false
  function signalGroup(signal: NodeJS.Signals | 0) {
    if (groupReleased) return false
    try {
      kill(-process.pid, signal)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        groupReleased = true
        return false
      }
      throw error
    }
  }
  void result.then(() => signalGroup(0)).catch(() => {})
  let closing: Promise<void> | undefined
  async function closeGroup() {
    // The shell may have exited while its descendants still hold our output pipes.
    signalGroup('SIGTERM')
    const gracefulDeadline = performance.now() + 250
    while (signalGroup(0) && performance.now() < gracefulDeadline) await Bun.sleep(10)
    if (signalGroup(0)) signalGroup('SIGKILL')
    await cleanupAll(
      () => bounded(result, 'Command process-group streams'),
      async () => {
        const deadline = performance.now() + timeout
        while (signalGroup(0)) {
          if (performance.now() >= deadline) throw new Error('Command process group did not exit')
          await Bun.sleep(10)
        }
      },
    )
  }
  return {
    process,
    result,
    get stdout() {
      return stdout
    },
    get stderr() {
      return stderr
    },
    close() {
      return (closing ??= closeGroup())
    },
  }
}

export async function connectApprovalPeer(
  sandbox: Sandbox,
  launch?: { command: string; args: string[]; env?: Record<string, string>; cwd?: string },
) {
  const client = new Client(
    { name: 'compiled-engine-approvals', version: '1.0.0' },
    { capabilities: { elicitation: { form: {} } } },
  )
  const transport = new StdioClientTransport({
    command: launch?.command ?? binary,
    args: launch?.args ?? ['mcp'],
    cwd: launch?.cwd ?? sandbox.dir,
    env: { ...environment(sandbox), ...launch?.env },
    stderr: 'pipe',
  })
  let stderr = ''
  const errors: Error[] = []
  const prompts: ApprovalPrompt[] = []
  const queued: ApprovalPrompt[] = []
  const answers = new Set<() => void>()
  const checks = new Set<Promise<unknown>>()
  let changed = Promise.withResolvers<void>()
  let closed = false
  transport.stderr!.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  client.onerror = (error) => errors.push(error)
  client.onclose = () => {
    closed = true
    for (const cancel of answers) cancel()
    changed.resolve()
  }
  client.setRequestHandler(ElicitRequestSchema, async (request, extra) => {
    if (!('requestedSchema' in request.params)) throw new Error('Expected form elicitation')
    const response = Promise.withResolvers<ElicitResult>()
    const cancel = () => response.resolve({ action: 'cancel' })
    const prompt: ApprovalPrompt = {
      question: JSON.parse(request.params.message),
      schema: request.params.requestedSchema,
      reply: response.resolve,
    }
    answers.add(cancel)
    extra.signal.addEventListener('abort', cancel, { once: true })
    if (extra.signal.aborted) cancel()
    prompts.push(prompt)
    queued.push(prompt)
    changed.resolve()
    changed = Promise.withResolvers<void>()
    try {
      return await response.promise
    } finally {
      answers.delete(cancel)
      extra.signal.removeEventListener('abort', cancel)
    }
  })
  try {
    await client.connect(transport, { timeout })
  } catch (error) {
    await client.close()
    throw error
  }
  return {
    client,
    transport,
    prompts,
    errors,
    get stderr() {
      return stderr
    },
    async nextPrompt(): Promise<ApprovalPrompt> {
      while (queued.length === 0) {
        if (closed) throw new Error(`Approval peer closed before elicitation: ${stderr}`)
        await bounded(changed.promise, 'Approval prompt')
      }
      return queued.shift()!
    },
    check(identity: ApprovalIdentity, signal?: AbortSignal) {
      const result = client
        .callTool({ name: 'check', arguments: { ...identity } }, undefined, {
          signal,
          timeout,
        })
        .then((value) => CallToolResultSchema.parse(value))
      checks.add(result)
      void result.finally(() => checks.delete(result)).catch(() => {})
      return result
    },
    async close() {
      for (const cancel of answers) cancel()
      await cleanupAll(
        () => client.close(),
        () => bounded(Promise.allSettled([...checks]), 'MCP check cleanup'),
      )
    },
  }
}

export async function runWithConsent(
  sandbox: Sandbox,
  call: ReturnType<typeof invocation>,
  respond: (prompt: ApprovalPrompt, index: number) => ElicitResult | Promise<ElicitResult>,
  extraEnvironment: Record<string, string> = {},
) {
  const peer = await connectApprovalPeer(sandbox)
  let engine: ReturnType<typeof startEngine> | undefined
  try {
    engine = startEngine(sandbox, call, extraEnvironment)
    const completed = Promise.all([engine.result, peer.check(call.identity)])
    let index = 0
    let refusal: string | undefined
    while (true) {
      const next = await Promise.race([
        completed.then(([result, companion]) => ({ kind: 'done' as const, result, companion })),
        peer.nextPrompt().then((prompt) => ({ kind: 'prompt' as const, prompt })),
      ])
      if (next.kind === 'done') {
        if (peer.errors.length) throw new AggregateError(peer.errors, 'MCP transport failed')
        if (peer.stderr) throw new Error(`Unexpected MCP stderr: ${peer.stderr}`)
        assertCompanion(next.companion, refusal)
        return { result: next.result, companion: next.companion, prompts: peer.prompts }
      }
      const response = await respond(next.prompt, index++)
      if (response.action !== 'accept' || response.content?.confirmed !== true) {
        refusal =
          response.action === 'cancel'
            ? 'Approval cancelled'
            : 'Approval was not positively confirmed'
      }
      next.prompt.reply(response)
    }
  } finally {
    await cleanupAll(
      () => peer.close(),
      () => engine?.close(),
    )
  }
}
