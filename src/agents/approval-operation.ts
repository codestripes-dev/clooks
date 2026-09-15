import { cloneDeep } from 'lodash-es'
import type { AgentId, NormalizedInvocation, TranslatedAgentOutput } from './types.js'
import { checkInputSchema, operationSchema } from '../interaction/protocol.js'

export function approvalIdentity(
  provider: AgentId,
  raw: Record<string, unknown>,
  owner: string,
  protocol: string,
) {
  return checkInputSchema.parse({
    protocol: protocol === '1' ? 1 : protocol,
    provider,
    owner,
    session_id: raw.session_id,
    tool_use_id: raw.tool_use_id,
    ...(provider === 'codex' ? { turn_id: raw.turn_id } : {}),
  })
}

export function approvalOperation(
  invocation: NormalizedInvocation,
  input: unknown,
  changed: boolean,
) {
  const raw = invocation.private.raw
  const encoded = changed
    ? invocation.private.provider === 'codex'
      ? invocation.private.tool?.encode(input as Record<string, unknown>)
      : input
    : raw.tool_input
  return cloneDeep(operationSchema.parse({ toolName: raw.tool_name, input: encoded }))
}

export function serializedApprovalOperation(
  invocation: NormalizedInvocation,
  translated: TranslatedAgentOutput,
) {
  if (translated.exitCode !== 0) return null
  const output = JSON.parse(translated.output ?? '{}')
  const specific = output.hookSpecificOutput
  if (
    specific?.permissionDecision === 'deny' ||
    output.continue === false ||
    output.decision === 'block'
  )
    return null
  if (specific?.permissionDecision === 'ask') throw new Error('Unresolved native ask')
  const changed = specific?.updatedInput !== undefined
  // This is already encoded; never run the codec a second time.
  return cloneDeep(
    operationSchema.parse({
      toolName: invocation.private.raw.tool_name,
      input: changed ? specific.updatedInput : invocation.private.raw.tool_input,
    }),
  )
}
