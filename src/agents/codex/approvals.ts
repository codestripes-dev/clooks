import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { cloneDeep } from 'lodash-es'
import type { ClooksConfig } from '../../config/schema.js'
import type { LoadedHook } from '../../loader.js'
import { orderHooksForEvent } from '../../ordering.js'
import type { HookName } from '../../types/branded.js'
import type { EngineResult, ExecutionResult } from '../../engine/types.js'
import type { JsonValue, NormalizedInvocation, TranslatedAgentOutput } from '../types.js'
import { ApprovalStore, type RequiredApproval } from './approval-store.js'
import { isJsonValue, jsonRecord } from './tool-codecs.js'

const CARRIER = 'CLOOKS_APPROVAL_TOKENS='
const TOKEN = /^ca1_[0-9a-f]{64}$/
const SHELL_WORDS = new Set(
  (
    'if then else elif fi case esac for select while until do done in function time coproc ' +
    '! { } . : [ alias bg bind break builtin cd command compgen complete compopt continue ' +
    'declare dirs disown echo enable eval exec exit export false fc fg getopts hash help ' +
    'history jobs kill let local logout mapfile popd printf pushd pwd read readarray readonly ' +
    'return set shift shopt source test times trap true type typeset ulimit umask unalias ' +
    'unset wait'
  ).split(' '),
)

export function canonicalHash(value: unknown): string {
  if (!isJsonValue(value)) throw new Error('Approval binding must be lossless JSON')
  const canonical = (item: JsonValue): string => {
    if (item === null || typeof item !== 'object') return JSON.stringify(item)
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`
    return `{${Object.keys(item)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(item[key]!)}`)
      .join(',')}}`
  }
  return createHash('sha256').update(canonical(value)).digest('hex')
}

/** Recognition only: no shell evaluation, unescaping or command reconstruction. */
export function inlineEligible(command: string): boolean {
  if (/[\r\n\\$`;&|<>()]/.test(command)) return false
  const first = /^([A-Za-z0-9_./-]+)(?=$|[ \t])/.exec(command)
  if (!first || SHELL_WORDS.has(first[1]!)) return false
  let rest = command.slice(first[0].length)
  while (rest.length > 0) {
    const word = /^[ \t]+(?:[A-Za-z0-9_./,:=@%+-]+|'[^']*'|"[^"!]*")(?=$|[ \t])/.exec(rest)
    if (!word) return /^[ \t]+$/.test(rest)
    rest = rest.slice(word[0].length)
  }
  return true
}

export interface ApprovalAttempt {
  payload: Record<string, unknown>
  nativeInput: Record<string, JsonValue>
  originalInput: Record<string, JsonValue>
  presentedTokens: string[]
  baseInvocationHash: string
}

export function prepareApprovalAttempt(raw: unknown): ApprovalAttempt {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Approval identity requires an object payload')
  const payload = cloneDeep(raw as Record<string, unknown>)
  const required = (key: string): string => {
    const value = payload[key]
    if (typeof value !== 'string' || value.length === 0)
      throw new Error(`Approval identity requires ${key}`)
    return value
  }
  if (payload.hook_event_name !== 'PreToolUse') throw new Error('Approval requires PreToolUse')
  const sessionId = required('session_id')
  const cwd = required('cwd')
  const toolName = required('tool_name')
  const agentId = payload.agent_id === undefined ? null : required('agent_id')
  const nativeInput = cloneDeep(jsonRecord(payload.tool_input))
  const originalInput = cloneDeep(nativeInput)
  let presentedTokens: string[] = []
  if (
    (toolName === 'Bash' || toolName === 'exec_command') &&
    typeof originalInput.command === 'string' &&
    originalInput.command.startsWith(CARRIER)
  ) {
    const match = /^CLOOKS_APPROVAL_TOKENS=([^ ]+) (.+)$/.exec(originalInput.command)
    if (!match)
      throw new Error('Invalid approval carrier; use clooks approve and unchanged arguments')
    presentedTokens = match[1]!.split(',')
    if (presentedTokens.length > 64 || presentedTokens.some((token) => !TOKEN.test(token)))
      throw new Error('Malformed or excessive approval tokens; use clooks approve')
    if (!inlineEligible(match[2]!))
      throw new Error(
        'Inline approval requires a direct external command; use clooks approve and unchanged arguments',
      )
    originalInput.command = match[2]!
  }
  payload.tool_input = originalInput
  return {
    payload,
    nativeInput,
    originalInput,
    presentedTokens,
    baseInvocationHash: canonicalHash({
      version: 1,
      provider: 'codex',
      sessionId,
      agentId,
      toolName,
      cwd,
      toolInput: originalInput,
    }),
  }
}

export interface ApprovalPipeline {
  global: ClooksConfig['global']
  event: ClooksConfig['events']['PreToolUse'] | null
  hooks: Array<{
    hookName: HookName
    parallel: boolean
    entryHash: string
    hookPath: string
    configPath: string
    config: Record<string, unknown>
    entry: unknown
  }>
}

export async function captureApprovalPipeline(
  matched: LoadedHook[],
  config: ClooksConfig,
  disabledNames?: Set<HookName>,
): Promise<ApprovalPipeline> {
  const ordered = orderHooksForEvent(
    matched,
    config.events.PreToolUse,
    config.hooks,
    'PreToolUse',
    disabledNames,
  )
  const hooks: ApprovalPipeline['hooks'] = []
  for (const { loaded, parallel } of ordered) {
    const bytes = await readFile(loaded.hookPath)
    hooks.push({
      hookName: loaded.name,
      parallel,
      entryHash: createHash('sha256').update(bytes).digest('hex'),
      hookPath: loaded.hookPath,
      configPath: loaded.configPath,
      config: cloneDeep(loaded.config),
      entry: cloneDeep(config.hooks[loaded.name]),
    })
  }
  return {
    global: cloneDeep(config.global),
    event: cloneDeep(config.events.PreToolUse ?? null),
    hooks,
  }
}

export interface ApprovalPermit {
  baseInvocationHash: string
  expectedDecisionHash: string
  expectedInputHash: string
  requiredTokens: RequiredApproval[]
}

export interface ApprovalResolution {
  result?: EngineResult
  permit?: ApprovalPermit
}

export function resolveApprovals(
  attempt: ApprovalAttempt,
  invocation: NormalizedInvocation,
  execution: ExecutionResult,
  pipeline: ApprovalPipeline,
  store: ApprovalStore,
): ApprovalResolution {
  const result = execution.lastResult
  if (execution.policyFailure || result?.result === 'block') return { result }
  const votes = execution.preToolUse?.votes ?? []
  const asks = votes.filter((vote) => vote.engineResult.result === 'ask')
  if (!execution.preToolUse?.completed && (asks.length > 0 || result?.result === 'ask'))
    throw new Error('Incomplete hook execution cannot approve a pending confirmation')
  if (result?.result === 'ask' && asks.length === 0)
    throw new Error('Missing accepted confirmation observations')
  const candidate =
    result?.updatedInput !== undefined
      ? invocation.private.tool?.encode(result.updatedInput)
      : attempt.originalInput
  if (candidate === undefined) throw new Error('Missing approval replacement codec')
  const expectedInputHash = canonicalHash(candidate)
  const observations = asks.map((vote) => ({
    hookName: vote.hookName,
    origin: vote.origin,
    ordinal: vote.ordinal,
    result: vote.engineResult,
    inputBefore: vote.inputBefore,
    inputAfter: vote.inputAfter,
  }))
  const decisionHash = canonicalHash({
    baseInvocationHash: attempt.baseInvocationHash,
    permissionMode: invocation.context.permissionMode,
    pipeline,
    finalInput: candidate,
  })
  const confirmations = observations.map((observation) =>
    canonicalHash({ decisionHash, observation }),
  )
  const resolved = store.resolveAttempt(
    { baseInvocationHash: attempt.baseInvocationHash, decisionHash },
    attempt.presentedTokens,
    confirmations,
  )
  const pending = resolved.pendingConfirmations[0]
  if (pending !== undefined) {
    const vote = asks[confirmations.indexOf(pending)]!
    const record = store.issueOrReuse({
      baseInvocationHash: attempt.baseInvocationHash,
      decisionHash,
      confirmationHash: pending,
    })
    const reason = vote.engineResult.reason!
    const display = reason.trim() ? reason : `Hook "${vote.hookName}" requests confirmation`
    return {
      result: {
        ...cloneDeep(result),
        result: 'block',
        reason: `Hook "${vote.hookName}": ${display}\nApproval token: ${record.token}\nExpires: ${new Date(record.expiresAt).toISOString()}\nAsk the user and wait for explicit approval. Then run clooks approve ${record.token} and retry unchanged arguments. For an eligible direct shell command, retry with CLOOKS_APPROVAL_TOKENS=${record.token} prefixed to the command.`,
      },
    }
  }
  return {
    result: result?.result === 'ask' ? { ...cloneDeep(result), result: 'allow' } : result,
    permit: {
      baseInvocationHash: attempt.baseInvocationHash,
      expectedDecisionHash: decisionHash,
      expectedInputHash,
      requiredTokens: resolved.requiredTokens,
    },
  }
}

/** Inspect the serialized bytes, not the pre-translation result, before the store commit. */
export function validateApprovalOutput(
  attempt: ApprovalAttempt,
  permit: ApprovalPermit,
  translated: TranslatedAgentOutput,
): void {
  if (translated.exitCode !== 0) throw new Error('Approval output is not successful')
  const output = translated.output === undefined ? {} : jsonRecord(JSON.parse(translated.output))
  const specific =
    output.hookSpecificOutput === undefined ? {} : jsonRecord(output.hookSpecificOutput)
  if (
    specific.permissionDecision === 'deny' ||
    output.continue === false ||
    output.decision === 'block'
  )
    throw new Error('Approval output does not permit the bound operation')
  let actual: unknown = prepareApprovalAttempt({
    ...attempt.payload,
    tool_input: attempt.nativeInput,
  }).originalInput
  if (specific.updatedInput !== undefined) {
    if (specific.permissionDecision !== 'allow' || specific.hookEventName !== 'PreToolUse')
      throw new Error('Approval replacement is not emitted as a native replacement')
    actual = prepareApprovalAttempt({
      ...attempt.payload,
      tool_input: specific.updatedInput,
    }).originalInput
  } else if (specific.permissionDecision !== undefined) {
    throw new Error('Unexpected native approval decision')
  }
  if (canonicalHash(actual) !== permit.expectedInputHash)
    throw new Error('Serialized tool input differs from the bound approval candidate')
}
