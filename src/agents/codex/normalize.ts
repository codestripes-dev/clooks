import { cloneDeep } from 'lodash-es'
import type { EventName } from '../../types/branded.js'
import type { JsonValue, NormalizedInvocation } from '../types.js'
import { InvocationPolicyError } from '../types.js'
import { isJsonValue, jsonRecord, toolCodec } from './tool-codecs.js'

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
        provider: 'codex',
        raw: cloneDeep(payload),
        sessionId,
        nativeTurnId: null,
        referencedAgentId: null,
        tool: null,
      },
    }
  }
  if (!compact) context.permissionMode = requiredString('permission_mode')
  let agentId: string | null = null
  let agentType: string | undefined
  if (
    eventName === 'SubagentStart' ||
    eventName === 'SubagentStop' ||
    Object.hasOwn(payload, 'agent_id') ||
    Object.hasOwn(payload, 'agent_type')
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
    codec = eventName === 'PreToolUse' ? toolCodec(nativeToolName) : null
    const publicToolName =
      codec?.canonicalName ?? (nativeToolName === 'exec_command' ? 'Bash' : nativeToolName)
    let toolInput: Record<string, unknown>
    try {
      toolInput = codec
        ? codec.decode(payload.tool_input as JsonValue)
        : cloneDeep(jsonRecord(payload.tool_input))
    } catch (error) {
      return fail('tool_input', error instanceof Error ? error.message : 'invalid tool input')
    }
    // These discriminators promise Claude input shapes, not merely an arbitrary record.
    const knownRequired: Record<string, string[]> = {
      Bash: ['command'],
      Write: ['filePath', 'content'],
      Edit: ['filePath', 'oldString', 'newString'],
      Read: ['filePath'],
      Glob: ['pattern'],
      Grep: ['pattern'],
      WebFetch: ['url', 'prompt'],
      WebSearch: ['query'],
      Agent: ['prompt', 'description', 'subagentType'],
    }
    const fields = Object.hasOwn(knownRequired, publicToolName) ? knownRequired[publicToolName] : []
    if (
      fields?.some((key) => typeof toolInput[key] !== 'string') ||
      nativeToolName === 'AskUserQuestion'
    ) {
      return fail('tool_input', `no compatible public input shape for ${nativeToolName}`)
    }
    const optionalFields: Record<string, Record<string, (value: unknown) => boolean>> = {
      Bash: {
        description: (value) => typeof value === 'string',
        timeout: (value) => typeof value === 'number',
        runInBackground: (value) => typeof value === 'boolean',
      },
      Edit: { replaceAll: (value) => typeof value === 'boolean' },
      Read: {
        offset: (value) => typeof value === 'number',
        limit: (value) => typeof value === 'number',
      },
      Glob: { path: (value) => typeof value === 'string' },
      Grep: {
        path: (value) => typeof value === 'string',
        glob: (value) => typeof value === 'string',
        outputMode: (value) => typeof value === 'string',
        '-i': (value) => typeof value === 'boolean',
        multiline: (value) => typeof value === 'boolean',
      },
      WebSearch: {
        allowedDomains: (value) =>
          Array.isArray(value) && value.every((item) => typeof item === 'string'),
        blockedDomains: (value) =>
          Array.isArray(value) && value.every((item) => typeof item === 'string'),
      },
      Agent: { model: (value) => typeof value === 'string' },
    }
    const optional = Object.hasOwn(optionalFields, publicToolName)
      ? optionalFields[publicToolName]
      : undefined
    for (const [key, validate] of Object.entries(optional ?? {})) {
      if (toolInput[key] !== undefined && !validate(toolInput[key])) {
        return fail('tool_input', `${publicToolName}.${key} has an incompatible public input type`)
      }
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
      provider: 'codex',
      raw: cloneDeep(payload),
      sessionId,
      nativeTurnId,
      referencedAgentId: agentId,
      tool: codec,
    },
  }
}
