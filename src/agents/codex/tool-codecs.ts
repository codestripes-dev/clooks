import { cloneDeep, isPlainObject } from 'lodash-es'
import type { JsonValue, ToolCodec } from '../types.js'

export function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Reflect.ownKeys(descriptors)
  if (keys.some((key) => typeof key !== 'string' || !('value' in descriptors[key]!))) return false
  if (Array.isArray(value)) {
    const length = descriptors.length!.value as number
    if (
      keys.length !== length + 1 ||
      keys.some(
        (key) =>
          key !== 'length' &&
          (typeof key !== 'string' ||
            !/^(0|[1-9]\d*)$/.test(key) ||
            Number(key) >= length ||
            !descriptors[key]!.enumerable),
      )
    )
      return false
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== null && prototype !== Object.prototype) return false
    if (Object.values(descriptors).some((descriptor) => !descriptor.enumerable)) return false
  }
  ancestors.add(value)
  const valid = Object.entries(descriptors).every(
    ([key, descriptor]) =>
      (Array.isArray(value) && key === 'length') || isJsonValue(descriptor.value, ancestors),
  )
  ancestors.delete(value)
  return valid
}

export function jsonInput(value: unknown): JsonValue {
  if (!isJsonValue(value)) throw new Error('tool input must be lossless JSON')
  return cloneDeep(value)
}

export function jsonRecord(value: unknown): Record<string, JsonValue> {
  if (!isPlainObject(value) || !isJsonValue(value)) {
    throw new Error(
      'tool input must be a JSON record; scalar, array and null inputs are unsupported',
    )
  }
  return value as Record<string, JsonValue>
}

/** A partial author update is materialized before validating the native replacement. */
export function materializePatch(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (!isPlainObject(patch)) throw new Error('updatedInput must be a record')
  const candidate: Record<string, unknown> = cloneDeep(current)
  for (const key of Object.keys(patch)) {
    const value = patch[key]
    if (value === undefined) continue
    if (value === null) {
      delete candidate[key]
    } else {
      Object.defineProperty(candidate, key, {
        value: cloneDeep(value),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
  }
  return candidate
}

function commandRecord(value: unknown): Record<string, JsonValue> {
  const input = jsonRecord(value)
  if (typeof input.command !== 'string' || Object.keys(input).some((key) => key !== 'command')) {
    throw new Error('command-only tool input requires a string command and no additional keys')
  }
  return input
}

export function validatePublicToolInput(publicToolName: string, toolInput: unknown): void {
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
    fields?.some((key) => typeof jsonRecord(toolInput)[key] !== 'string') ||
    publicToolName === 'AskUserQuestion'
  ) {
    throw new Error(`no compatible public input shape for ${publicToolName}`)
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
    const value = jsonRecord(toolInput)[key]
    if (value !== undefined && !validate(value)) {
      throw new Error(`${publicToolName}.${key} has an incompatible public input type`)
    }
  }
}

export function toolCodec(toolName: string): ToolCodec | null {
  // The native handler opts out of PreToolUse, so it has no replacement contract.
  if (toolName === 'write_stdin') return null
  if (toolName !== 'Bash' && toolName !== 'exec_command' && toolName !== 'apply_patch') {
    const record = (input: unknown) => {
      const value = jsonRecord(input)
      validatePublicToolInput(toolName, value)
      return cloneDeep(value)
    }
    return {
      canonicalName: toolName,
      decode(input) {
        return record(input)
      },
      applyPatch(current, patch) {
        return record(materializePatch(record(current), patch))
      },
      encode(input) {
        return record(input)
      },
    }
  }
  return {
    canonicalName: toolName === 'exec_command' ? 'Bash' : toolName,
    decode(input) {
      return cloneDeep(commandRecord(input))
    },
    applyPatch(current, patch) {
      if (Object.keys(patch).some((key) => key !== 'command' && patch[key] !== undefined)) {
        throw new Error(
          'command-only updates cannot contain additional keys, including null deletions',
        )
      }
      return cloneDeep(commandRecord(materializePatch(commandRecord(current), patch)))
    },
    encode(input) {
      return cloneDeep(commandRecord(input))
    },
  }
}
