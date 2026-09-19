import { cloneDeep, isPlainObject } from 'lodash-es'
import type { EventName } from '../../types/branded.js'
import type { JsonValue, NormalizedInvocation } from '../types.js'
import { InvocationPolicyError } from '../types.js'
import {
  isJsonValue,
  jsonInput,
  jsonRecord,
  toolCodec,
  validatePublicToolInput,
} from './tool-codecs.js'

const EVENTS: readonly EventName[] = [
  'SessionStart',
  'SubagentStart',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'UserPromptSubmit',
  'SubagentStop',
  'Stop',
  'SessionEnd',
  'Interrupt',
]

export function readEventName(payload: Record<string, unknown>): EventName | null {
  return EVENTS.find((name) => name === payload.hook_event_name) ?? null
}

export function normalizeInvocation(
  payload: Record<string, unknown>,
  eventName: EventName,
): NormalizedInvocation {
  const fail = (capability: string, message: string): never => {
    throw new InvocationPolicyError({
      eventName,
      capability,
      message: `clooks: Codex ${eventName} hook "runtime" capability "${capability}": ${message}; hooks were not imported or executed.`,
    })
  }
  if (!EVENTS.includes(eventName)) {
    return fail('event', 'runtime handling for this recognized event is unsupported')
  }
  const requiredString = (key: string): string => {
    const value = payload[key]
    if (typeof value !== 'string' || value.length === 0) {
      return fail(key, `${key} must be a nonempty string`)
    }
    return value
  }
  const sessionId = requiredString('session_id')
  const sessionEnd = eventName === 'SessionEnd'
  const nativeTurnId = eventName === 'SessionStart' || sessionEnd ? null : requiredString('turn_id')
  const cwd = requiredString('cwd')
  const model = sessionEnd ? undefined : requiredString('model')
  const compact = eventName === 'PreCompact' || eventName === 'PostCompact'
  const nullableString = (key: string): string => {
    const value = payload[key]
    if (value != null && typeof value !== 'string') {
      return fail(key, `${key} must be a string, null or absent`)
    }
    return value ?? ''
  }
  const context: Record<string, unknown> = {
    event: eventName,
    sessionId,
    cwd,
    transcriptPath: nullableString('transcript_path'),
  }
  if (sessionEnd) {
    if (payload.reason !== 'other') return fail('reason', 'reason must be other')
    context.reason = 'other'
    return {
      eventName,
      context,
      private: {
        agent: 'codex',
        raw: cloneDeep(payload),
        sessionId,
        nativeTurnId: null,
        referencedAgentId: null,
        tool: null,
      },
    }
  }
  if (!compact) context.permissionMode = requiredString('permission_mode')
  if (eventName === 'Interrupt') context.model = model
  let agentId: string | null = null
  let agentType: string | undefined
  if (
    eventName !== 'Interrupt' &&
    (eventName === 'SubagentStart' ||
      eventName === 'SubagentStop' ||
      Object.hasOwn(payload, 'agent_id') ||
      Object.hasOwn(payload, 'agent_type'))
  ) {
    agentId = requiredString('agent_id')
    agentType = requiredString('agent_type')
  }
  let codec: NormalizedInvocation['private']['tool'] = null
  if (
    eventName === 'PreToolUse' ||
    eventName === 'PermissionRequest' ||
    eventName === 'PostToolUse'
  ) {
    const nativeToolName = requiredString('tool_name')
    const opaqueMcp = nativeToolName.startsWith('mcp__')
    codec =
      eventName === 'PreToolUse' && (!opaqueMcp || isPlainObject(payload.tool_input))
        ? toolCodec(nativeToolName)
        : null
    const publicToolName =
      codec?.canonicalName ?? (nativeToolName === 'exec_command' ? 'Bash' : nativeToolName)
    let toolInput: unknown
    try {
      toolInput = codec
        ? codec.decode(payload.tool_input as JsonValue)
        : opaqueMcp
          ? jsonInput(payload.tool_input)
          : cloneDeep(jsonRecord(payload.tool_input))
    } catch (error) {
      return fail('tool_input', error instanceof Error ? error.message : 'invalid tool input')
    }
    try {
      validatePublicToolInput(publicToolName, toolInput)
    } catch (error) {
      return fail('tool_input', error instanceof Error ? error.message : 'invalid tool input')
    }
    context.toolName = publicToolName
    context.toolInput = toolInput
    if (eventName !== 'PermissionRequest') context.toolUseId = requiredString('tool_use_id')
    if (eventName === 'PostToolUse') {
      if (!isJsonValue(payload.tool_response))
        return fail('tool_response', 'tool_response must be JSON')
      context.toolResponse = cloneDeep(payload.tool_response)
    }
  }
  if (eventName === 'SessionStart') {
    const source = requiredString('source')
    if (!['startup', 'resume', 'clear', 'compact'].includes(source))
      return fail('source', 'unsupported session source')
    context.source = source
    context.model = model
  }
  if (eventName === 'UserPromptSubmit') {
    if (typeof payload.prompt !== 'string') return fail('prompt', 'prompt must be a string')
    context.prompt = payload.prompt
  }
  if (compact) {
    const trigger = requiredString('trigger')
    if (trigger !== 'manual' && trigger !== 'auto')
      return fail('trigger', 'unsupported compaction trigger')
    context.trigger = trigger
    if (eventName === 'PreCompact')
      context.customInstructions = nullableString('custom_instructions')
    else context.compactSummary = nullableString('compact_summary')
  }
  if (eventName === 'Stop' || eventName === 'SubagentStop') {
    if (typeof payload.stop_hook_active !== 'boolean')
      return fail('stop_hook_active', 'stop_hook_active must be a boolean')
    context.stopHookActive = payload.stop_hook_active
    context.lastAssistantMessage = nullableString('last_assistant_message')
    if (eventName === 'SubagentStop')
      context.agentTranscriptPath = nullableString('agent_transcript_path')
  }
  if (agentId !== null) {
    context.agentId = agentId
    context.agentType = agentType
  }
  return {
    eventName,
    context,
    private: {
      agent: 'codex',
      raw: cloneDeep(payload),
      sessionId,
      nativeTurnId,
      referencedAgentId: agentId,
      tool: codec,
    },
  }
}
