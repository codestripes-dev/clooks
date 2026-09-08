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

export function toolCodec(toolName: string): ToolCodec | null {
  if (toolName.startsWith('mcp__')) {
    return {
      canonicalName: toolName,
      decode(input) {
        return cloneDeep(jsonRecord(input))
      },
      applyPatch(current, patch) {
        return cloneDeep(jsonRecord(materializePatch(current, patch)))
      },
      encode(input) {
        return cloneDeep(jsonRecord(input))
      },
    }
  }
  if (toolName !== 'Bash' && toolName !== 'exec_command' && toolName !== 'apply_patch') return null
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
      return cloneDeep(commandRecord(materializePatch(current, patch)))
    },
    encode(input) {
      return cloneDeep(commandRecord(input))
    },
  }
}
