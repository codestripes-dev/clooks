import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { CapturedRequest } from './fixture-server'

export const binaryPin = '56ef98ab4032d317ab26e9b5e5a175650717351edb16ed9cde0cb6d1734d62da'
export const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']
export const callId = 'native_m1_call'
export const commandA = 'printf native > marker'
export const commandB = 'printf rewritten > rewritten-marker; printf rewritten-result'
export const denyReason = 'm1-denied'
export const stopReason = 'm1-stop-reminder'
export const tokens: Record<string, string> = {
  SessionStart: 'm1ctx-start-71',
  UserPromptSubmit: 'm1ctx-prompt-82',
  PreToolUse: 'm1ctx-pre-93',
  PostToolUse: 'm1ctx-post-64',
}
export type CaseId = 'M1-BASE' | 'M1-DENY' | 'M1-REWRITE' | 'M1-ASK' | 'M1-CONTEXT' | 'M1-STOP'
export const baselineCases: CaseId[] = [
  'M1-BASE',
  'M1-DENY',
  'M1-REWRITE',
  'M1-ASK',
  'M1-CONTEXT',
  'M1-STOP',
]
export const packCases = ['PACK-SHELL-READ', 'PACK-PATCH-ALLOW', 'PACK-PATCH-DENY'] as const
export type PackCaseId = (typeof packCases)[number]
export const hybridCases = [
  'HYBRID-PATCH',
  'HYBRID-SHELL-REWRITE-ALLOW',
  'HYBRID-SHELL-REWRITE-DENY',
  'HYBRID-PATCH-REWRITE-ALLOW',
  'HYBRID-PATCH-REWRITE-DENY',
  'HYBRID-SHELL',
] as const
export type HybridCaseId = (typeof hybridCases)[number]
export const sessionEndCases = ['SESSION-END'] as const
export const mandatoryCases = [...baselineCases, ...packCases, ...hybridCases, ...sessionEndCases]
export const expectedUnitTests = 26

export function exportSmokeBinary(logs: string, mode: string, binary: string) {
  requireThat(mode === '--smoke', 'Only smoke exports a binary')
  const pass = JSON.parse(readFileSync(join(logs, 'passed.json'), 'utf8'))
  requireThat(
    pass.passed === true &&
      pass.testExitCode === 0 &&
      pass.mode === mode &&
      pass.completed === mandatoryCases.length &&
      JSON.stringify(pass.cases) === JSON.stringify(mandatoryCases),
    'Incomplete successful smoke',
  )
  const stat = lstatSync(binary)
  requireThat(stat.isFile() && (stat.mode & 0o111) !== 0, 'Missing regular executable binary')
  const hash = sha256(binary)
  for (const id of mandatoryCases) {
    const receipt = JSON.parse(readFileSync(join(logs, id, 'passed.json'), 'utf8'))
    requireThat(
      receipt.id === id && receipt.status === 'passed' && receipt.clooksSha256 === hash,
      `Missing case or Clooks hash mismatch: ${id}`,
    )
  }
  const destination = join(logs, 'clooks')
  copyFileSync(binary, destination, constants.COPYFILE_EXCL)
  chmodSync(destination, stat.mode & 0o777)
  requireThat(sha256(destination) === hash, 'Exported binary hash mismatch')
  save(join(logs, 'binary.json'), {
    sha256: hash,
    mode: stat.mode & 0o777,
    sealedMode: stat.mode & 0o777 & ~0o222,
    architecture: process.arch,
    platform: process.platform,
    source: '/app/dist/clooks',
    cases: mandatoryCases,
  })
}

export function save(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
}

export function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// A completion record is neutral: only the container's observed test exit can authorize a pass.
export function publishPassed(logs: string, mode: string, testExitCode: number): number {
  requireThat(Number.isInteger(testExitCode) && testExitCode >= 0, 'Invalid test exit code')
  if (testExitCode !== 0) return testExitCode
  const completion = JSON.parse(readFileSync(join(logs, 'completed.json'), 'utf8'))
  requireThat(completion.mode === mode, 'Completion mode mismatch')
  requireThat(
    Number.isInteger(completion.completed) && completion.completed > 0,
    'No completed tests or cases',
  )
  if (mode === '--unit') {
    requireThat(completion.completed === expectedUnitTests, 'Incomplete harness unit suite')
  } else {
    requireThat(mode === '--smoke' || mode === '--session-end', 'Unknown completion mode')
    const cases = mode === '--session-end' ? sessionEndCases : mandatoryCases
    requireThat(
      completion.completed === cases.length &&
        Array.isArray(completion.cases) &&
        completion.cases.length === cases.length &&
        cases.every((id, index) => completion.cases[index] === id),
      'Incomplete native cases',
    )
  }
  save(join(logs, 'passed.json'), {
    ...completion,
    passed: true,
    testExitCode,
  })
  return 0
}

export function verifyMetadata(actual: string, expected = binaryPin) {
  requireThat(actual === expected, `Native binary SHA mismatch: ${actual}; expected ${expected}`)
}

export function sha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function readCaptures(payloadDir: string, hookLog: string) {
  requireThat(
    existsSync(payloadDir) && existsSync(hookLog),
    'Missing native captures or handler log',
  )
  const payloads = readdirSync(payloadDir)
    .sort()
    .map((file) => JSON.parse(readFileSync(join(payloadDir, file), 'utf8')))
  const handlers = readFileSync(hookLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  requireThat(payloads.length && handlers.length, 'Empty native captures or handler log')
  return { payloads, handlers }
}

export interface RunResult {
  code: number | null
  signal: string | null
  timedOut: boolean
  reaped: boolean
  elapsedMs: number
  stdout: string
  stderr: string
}

export function requireSuccess(result: RunResult) {
  requireThat(
    result.code === 0 && !result.signal && !result.timedOut && result.reaped,
    `Subprocess failed: ${JSON.stringify(result)}`,
  )
}

// Detached groups include inherited hook children. Both pipe closure and cleanup are bounded.
export async function run(
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  prefix: string,
  ms: number,
): Promise<RunResult> {
  save(prefix + '.command.json', { argv, cwd, env, timeoutMs: ms })
  const started = performance.now()
  const child = spawn(argv[0]!, argv.slice(1), {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.once('spawn', () => save(prefix + '.launched.json', { pid: child.pid }))
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout!.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr!.on('data', (chunk: Buffer) => stderr.push(chunk))
  let reaped = false
  const closed = new Promise<void>((resolve) =>
    child.once('close', () => {
      reaped = true
      resolve()
    }),
  )
  const killGroup = () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
  }
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    killGroup()
  }, ms)
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const status = await new Promise<{
      code: number | null
      signal: string | null
    }>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        killGroup()
        resolve({ code, signal })
      })
    })
    await Promise.race([
      closed,
      new Promise<void>((_, reject) => {
        cleanupTimer = setTimeout(
          () => reject(new Error('Subprocess pipes not reaped within 2 seconds')),
          2000,
        )
      }),
    ])
    const result = {
      ...status,
      timedOut,
      reaped,
      elapsedMs: performance.now() - started,
      stdout: Buffer.concat(stdout).toString(),
      stderr: Buffer.concat(stderr).toString(),
    }
    save(prefix + '.result.json', result)
    return result
  } catch (error) {
    save(prefix + '.error.json', { error: String(error), reaped, timedOut })
    throw error
  } finally {
    clearTimeout(timer)
    clearTimeout(cleanupTimer)
    killGroup()
    child.stdout!.destroy()
    child.stderr!.destroy()
  }
}

export interface Observation {
  payloads: any[]
  handlers: any[]
  requests: CapturedRequest[]
  marker: string | null
  rewrittenMarker: string | null
}

// Responses message text and call output are model-readable; IDs, arguments and metadata are not.
export function modelReadableText(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((item: any) => {
    if (!item || item.role === 'assistant') return []
    if (
      item.type === 'function_call_output' &&
      item.call_id === callId &&
      typeof item.output === 'string'
    ) {
      return [item.output]
    }
    if (
      item.type !== 'message' ||
      !['developer', 'system', 'user'].includes(item.role) ||
      !Array.isArray(item.content)
    )
      return []
    return item.content.flatMap((part: any) =>
      part?.type === 'input_text' && typeof part.text === 'string' ? [part.text] : [],
    )
  })
}

function hasModelText(request: CapturedRequest, token: string) {
  return modelReadableText(request.body?.input).some((text) => text.includes(token))
}

// Literal expectations are independent of the production translator and synthetic assistant text.
export function assertObservation(id: CaseId, observed: Observation) {
  const { payloads, handlers, requests, marker, rewrittenMarker } = observed
  const denied = id === 'M1-DENY' || id === 'M1-ASK'
  const required = denied ? events.filter((event) => event !== 'PostToolUse') : events
  for (const event of required) {
    requireThat(
      payloads.some((payload) => payload.hook_event_name === event),
      `Missing raw ${event}`,
    )
    requireThat(
      handlers.some((handler) => handler.event === event),
      `Missing handler ${event}`,
    )
  }
  requireThat(requests.length === (id === 'M1-STOP' ? 3 : 2), 'Wrong request count')
  const pre = payloads.filter((payload) => payload.hook_event_name === 'PreToolUse')
  requireThat(
    pre.length === 1 && pre[0].tool_use_id === callId,
    'Missing or mismatched PreToolUse call ID',
  )
  requireThat(
    pre[0].tool_input?.command === commandA,
    'Original command missing from native payload',
  )
  const preHandlers = handlers.filter((handler) => handler.event === 'PreToolUse')
  requireThat(
    preHandlers.length === 1 && preHandlers[0].toolInput?.command === commandA,
    'Original handler input missing',
  )
  const post = payloads.filter((payload) => payload.hook_event_name === 'PostToolUse')
  requireThat(
    post.every((payload) => payload.tool_use_id === callId),
    'Missing or mismatched PostToolUse call ID',
  )
  const feedback =
    requests[1]!.body?.input?.filter((item: any) => item.type === 'function_call_output') ?? []
  requireThat(
    feedback.length === 1 &&
      feedback[0].call_id === callId &&
      typeof feedback[0].output === 'string',
    'Missing or mismatched native feedback call ID',
  )
  if (denied) {
    requireThat(marker === null && rewrittenMarker === null, 'Denied tool created marker')
    requireThat(
      post.length === 0 && !handlers.some((handler) => handler.event === 'PostToolUse'),
      'Denied tool emitted PostToolUse',
    )
    if (id === 'M1-DENY') {
      requireThat(
        feedback[0].output ===
          `Command blocked by PreToolUse hook: ${denyReason}. Command: ${commandA}`,
        'Native denial feedback mismatch',
      )
    } else {
      requireThat(
        /^Command blocked by PreToolUse hook: Hook "native-m1": m1-ask-request\nApproval token: ca1_[a-f0-9]{64}\nExpires: /u.test(
          feedback[0].output,
        ) &&
          feedback[0].output.includes('Ask the user and wait for explicit approval.') &&
          feedback[0].output.endsWith(`. Command: ${commandA}`),
        'Missing pending approval feedback',
      )
    }
  } else {
    requireThat(post.length === 1, 'Missing completed tool capture')
    requireThat(
      feedback[0].output.includes('Process exited with code 0'),
      'Native tool did not report success',
    )
    if (id === 'M1-REWRITE') {
      requireThat(
        marker === null && rewrittenMarker === 'rewritten',
        'Rewrite A/B effects mismatch',
      )
      requireThat(
        post[0].tool_input?.command === commandB && post[0].tool_response === 'rewritten-result',
        'Consumed rewrite missing from native post payload',
      )
      const postHandlers = handlers.filter((handler) => handler.event === 'PostToolUse')
      requireThat(
        postHandlers.length === 1 &&
          postHandlers[0].toolName === 'Bash' &&
          postHandlers[0].toolInput?.command === commandB &&
          postHandlers[0].toolResponse === 'rewritten-result',
        'Normalized rewritten tool response missing from PostToolUse handler',
      )
      requireThat(
        feedback[0].output.includes('rewritten-result'),
        'Rewritten result absent from native request',
      )
    } else {
      requireThat(
        marker === 'native' && rewrittenMarker === null,
        'Baseline marker missing or wrong',
      )
    }
  }
  if (id === 'M1-CONTEXT') {
    for (const [event, token] of Object.entries(tokens)) {
      const index = event === 'SessionStart' || event === 'UserPromptSubmit' ? 0 : 1
      requireThat(
        hasModelText(requests[index]!, token),
        `Missing ${event} context in request ${index + 1}`,
      )
      requireThat(
        handlers.filter((handler) => handler.event === event && handler.contextToken === token)
          .length === 1,
        `Missing ${event} token attribution`,
      )
      if (index === 1) requireThat(!hasModelText(requests[0]!, token), `Premature ${event} context`)
      for (const payload of payloads) {
        if (payload.hook_event_name === 'UserPromptSubmit')
          requireThat(!payload.prompt.includes(token), 'Token leaked into prompt')
      }
    }
  }
  if (id === 'M1-STOP') {
    const stops = payloads.filter((payload) => payload.hook_event_name === 'Stop')
    const history = handlers.filter((handler) => handler.event === 'Stop')
    requireThat(stops.length === 2 && history.length === 2, 'Expected exactly two Stops')
    requireThat(
      typeof stops[0].turn_id === 'string' &&
        stops[0].turn_id.length > 0 &&
        stops[0].turn_id === stops[1].turn_id,
      'Stop turn IDs differ or missing',
    )
    const prompt = payloads.find((payload) => payload.hook_event_name === 'UserPromptSubmit')
    requireThat(prompt?.turn_id === stops[0].turn_id, 'Stop left the original prompt turn')
    requireThat(
      payloads.filter((payload) => payload.hook_event_name === 'UserPromptSubmit').length === 1 &&
        handlers.filter((handler) => handler.event === 'UserPromptSubmit').length === 1,
      'Continuation submitted another prompt',
    )
    requireThat(
      history[0].priorInterventions === 0 && history[1].priorInterventions === 1,
      'Stop handler history is not 0 -> 1',
    )
    requireThat(
      hasModelText(requests[2]!, stopReason),
      'Reminder absent from native continuation request',
    )
    requireThat(!hasModelText(requests[1]!, stopReason), 'Reminder arrived before Stop')
  }
}
