import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sse } from './fixture-server'
import { modelReadableText, requireThat, save } from './harness'

export const onboardingPin = '3188814c35471432d4123203e0eb38e5bddc60226e3d7ddf0e59e649ea140022'
export const onboardingCases = [
  'ONBOARDING-INSTALL',
  'ONBOARDING-DECLINE',
  'ONBOARDING-REUSE-REMOVE',
]
export const onboardingPacks = ['clooks-core-hooks', 'clooks-project-hooks', 'clooks-example-hooks']

export function assertSkill(body: any, skill: string, explicit: boolean) {
  const text = modelReadableText(body.input)
  const blocks = text.filter((part) => part.includes('<skill>'))
  if (explicit) {
    requireThat(
      blocks.some((part) => part.includes(skill.trim())),
      'Missing full explicit skill body',
    )
  } else {
    requireThat(blocks.length === 0, 'Skill body loaded without explicit invocation')
  }
  requireThat(
    !text.some((part) => part.includes('# Clooks Runtime Setup')),
    'Claude setup leaked into Codex',
  )
}

export function rawToolOutput(body: any, callId: string): string {
  const output = body.input?.find(
    (item: any) => item.type === 'function_call_output' && item.call_id === callId,
  )
  requireThat(typeof output?.output === 'string', `Missing actual tool result: ${callId}`)
  return output.output
}

export function toolOutput(body: any, callId: string, exitCode = 0): string {
  const output = rawToolOutput(body, callId)
  requireThat(output.includes(`Process exited with code ${exitCode}\n`), `Tool failed: ${output}`)
  return output
}

export function deniedToolOutput(
  body: any,
  callId: string,
  reason: string,
  command: string,
): string {
  const output = rawToolOutput(body, callId)
  requireThat(reason.trim().length > 0 && command.trim().length > 0, 'Missing expected denial')
  requireThat(
    output === `Command blocked by PreToolUse hook: ${reason}. Command: ${command}`,
    `Unexpected denial output: ${output}`,
  )
  return output
}

export function pendingSession(output: string): number | undefined {
  const session = /Process running with session ID (\d+)/.exec(output)
  return session ? Number(session[1]) : undefined
}

export interface OnboardingTurn {
  prompt: string
  done: string
  commands: Array<string | ((previousOutput: string) => string)>
  exitCode?: number
  denialReason?: string
  inspect(body: any): void
  complete(): void
}

// Only assistant actions are scripted; the CLI must execute every installer/init call.
export function onboardingProvider(
  logs: string,
  project: string,
  turns: OnboardingTurn[],
  version: string,
) {
  const requests: any[] = []
  const errors: string[] = []
  const downloads: string[] = []
  let titleRequests = 0
  let turn = 0
  let command = 0
  let call: string | undefined
  let polls = 0
  let sequence = 0
  let issuedCommand = ''
  const binary = readFileSync('/app/dist/clooks')
  const checksum = new Bun.CryptoHasher('sha256').update(binary).digest('hex')
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    maxRequestBodySize: 4 * 1024 * 1024,
    async fetch(request) {
      const fail = (message: string) => {
        errors.push(message)
        return new Response(message, { status: 409 })
      }
      if (['authorization', 'cookie', 'x-api-key'].some((key) => request.headers.has(key)))
        return fail('Credentials forbidden; request not captured')
      const path = new URL(request.url).pathname
      if (request.method === 'GET' && path.startsWith('/releases/')) {
        downloads.push(path)
        if (path === `/releases/download/v${version}/checksums.txt`)
          return new Response(`${checksum}  clooks-linux-x64\n`)
        if (path === `/releases/download/v${version}/clooks-linux-x64`) return new Response(binary)
        return fail(`Unexpected release request: ${path}`)
      }
      if (
        request.method !== 'POST' ||
        path !== '/v1/responses' ||
        request.headers.has('content-encoding')
      )
        return fail('Unexpected provider route or compressed request')
      if (++sequence > 40) return fail('Onboarding request limit exceeded')
      let body: any
      try {
        body = await request.json()
      } catch {
        return fail('Invalid JSON')
      }
      save(join(logs, `request-${sequence}.json`), body)
      const text = modelReadableText(body.input)
      const title = text.some((part) =>
        part.startsWith('Generate a concise, single-line task title'),
      )
      let item: unknown
      try {
        if (title) {
          requireThat(++titleRequests <= 8, 'Too many title requests')
          item = message('Onboarding test')
        } else {
          requests.push(body)
          const current = turns[turn]
          requireThat(current, 'Unexpected additional conversation request')
          requireThat(
            text.some((part) => part.includes(current.prompt)),
            'Wrong onboarding turn',
          )
          current.inspect(body)
          const output = call ? rawToolOutput(body, call) : ''
          if (call && current.denialReason !== undefined) {
            deniedToolOutput(body, call, current.denialReason, issuedCommand)
          }
          const session = pendingSession(output)
          const assertOutput = () =>
            current.denialReason === undefined
              ? toolOutput(body, call!, current.exitCode)
              : deniedToolOutput(body, call!, current.denialReason, issuedCommand)
          if (session !== undefined) {
            requireThat(++polls <= 3, 'Native tool exceeded bounded polling allowance')
            requireThat(
              body.tools?.some((tool: any) => tool.name === 'write_stdin'),
              'Missing native write_stdin tool',
            )
            call = `onboarding_${turn}_${command - 1}_poll_${polls}`
            item = {
              type: 'function_call',
              call_id: call,
              name: 'write_stdin',
              arguments: JSON.stringify({
                session_id: session,
                chars: '',
                yield_time_ms: 10000,
                max_output_tokens: 2000,
              }),
            }
          } else if (command < current.commands.length) {
            if (call) assertOutput()
            polls = 0
            requireThat(
              body.tools?.some((tool: any) => tool.name === 'exec_command'),
              'Missing native exec_command tool',
            )
            call = `onboarding_${turn}_${command}`
            const next = current.commands[command++]!
            const cmd = typeof next === 'function' ? next(output) : next
            issuedCommand = cmd
            item = {
              type: 'function_call',
              call_id: call,
              name: 'exec_command',
              arguments: JSON.stringify({
                cmd,
                workdir: project,
                login: false,
                yield_time_ms: 30000,
                max_output_tokens: 2000,
              }),
            }
          } else {
            if (call) assertOutput()
            current.complete()
            item = message(current.done)
            turn++
            command = 0
            call = undefined
            polls = 0
          }
        }
      } catch (error) {
        return fail(String(error))
      }
      return new Response(sse(`onboarding_${sequence}`, item), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  })
  function message(text: string) {
    return {
      type: 'message',
      role: 'assistant',
      id: `onboarding_message_${sequence}`,
      content: [{ type: 'output_text', text }],
    }
  }
  return {
    port: server.port,
    requests,
    downloads,
    errors,
    assertComplete() {
      requireThat(
        errors.length === 0 && turn === turns.length,
        `Incomplete onboarding provider: ${turn}/${turns.length}; ${errors.join('; ')}`,
      )
    },
    stop: () => server.stop(true),
  }
}

export function publishOnboarding(logs: string, testExitCode: number): number {
  requireThat(Number.isInteger(testExitCode) && testExitCode >= 0, 'Invalid test status')
  if (testExitCode !== 0) return testExitCode
  const completion = JSON.parse(readFileSync(join(logs, 'completed.json'), 'utf8'))
  requireThat(
    completion.mode === '--onboarding' &&
      completion.completed === onboardingCases.length &&
      JSON.stringify(completion.cases) === JSON.stringify(onboardingCases),
    'Incomplete onboarding cases',
  )
  for (const id of onboardingCases) {
    const receipt = JSON.parse(readFileSync(join(logs, id, 'passed.json'), 'utf8'))
    requireThat(
      receipt.id === id && receipt.codexSha256 === onboardingPin && receipt.status === 'passed',
      `Invalid onboarding receipt: ${id}`,
    )
    if (id === 'ONBOARDING-REUSE-REMOVE') {
      requireThat(
        JSON.stringify(receipt.packs?.installed) === JSON.stringify(onboardingPacks) &&
          receipt.packs?.denial === true &&
          receipt.packs?.idempotent === true &&
          receipt.packs?.cachePreserved === true &&
          receipt.packs?.explicitUpdate === true,
        'Missing native pack receipt',
      )
    }
    requireThat(
      existsSync(join(logs, id, 'cleanup.json')) &&
        JSON.parse(readFileSync(join(logs, id, 'cleanup.json'), 'utf8')).removed === true,
      `Missing cleanup: ${id}`,
    )
  }
  save(join(logs, 'passed.json'), {
    ...completion,
    passed: true,
    testExitCode,
    binaryExport: false,
  })
  return 0
}
