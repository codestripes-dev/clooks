import { cloneDeep, isPlainObject } from 'lodash-es'
import type { EngineResult } from '../../engine/types.js'
import type { InvocationResultPolicy, NormalizedInvocation } from '../types.js'
import { isJsonValue } from './tool-codecs.js'

function hasLosslessShape(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === undefined) return true
  if (value === null || typeof value !== 'object') return isJsonValue(value)
  if (Array.isArray(value)) return isJsonValue(value)
  if (ancestors.has(value)) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Reflect.ownKeys(descriptors)
  if (keys.some((key) => typeof key !== 'string' || !('value' in descriptors[key]!))) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== null && prototype !== Object.prototype) return false
  ancestors.add(value)
  const valid = Object.values(descriptors).every(
    (descriptor) => descriptor.enumerable && hasLosslessShape(descriptor.value, ancestors),
  )
  ancestors.delete(value)
  return valid
}

export function allowReasonAnnotation(reason: string): string {
  return (
    'clooks: PreToolUse allow reason (human annotation only; original allow-reason ' +
    `recipient unavailable; native policy retained): ${reason}`
  )
}

export function createResultPolicy(invocation: NormalizedInvocation): InvocationResultPolicy {
  const metadata = cloneDeep(invocation.private)
  const eventName = invocation.eventName
  return {
    collectPreToolUseVotes: eventName === 'PreToolUse',
    deferRuntimeErrorAudit: true,
    validateRawResult(value) {
      if (hasLosslessShape(value)) return undefined
      return {
        eventName,
        capability: 'result-shape',
        message: 'result cannot be represented losslessly as JSON; result effects refused.',
      }
    },
    checkResult(input) {
      const reject = (capability: string, detail: string) => ({
        kind: 'rejected' as const,
        failure: {
          eventName,
          hookName: input.hookName,
          capability,
          message: `clooks: Codex ${eventName} hook "${input.hookName ?? 'runtime'}" capability "${capability}": ${detail}; result effects refused.`,
        },
      })
      if (input.value == null) return { kind: 'accepted', diagnostics: [] }
      if (!isPlainObject(input.value)) return reject('result', 'result must be a record')
      const value = input.value as Record<string, unknown>
      const tag = value.result
      if (tag !== 'allow' && tag !== 'block' && tag !== 'skip' && tag !== 'ask') {
        return reject('result', `unsupported result arm ${String(tag)}`)
      }
      if (tag === 'ask' && (eventName !== 'PreToolUse' || input.origin !== 'handler')) {
        return reject('result', 'ask is supported only by PreToolUse handlers')
      }
      if (tag === 'ask' && typeof value.reason !== 'string') {
        return reject('reason', 'ask reason must be a string')
      }
      if (input.origin === 'before-hook' && tag === 'allow') {
        return reject('before-hook', 'beforeHook may only block or skip')
      }
      const generated =
        input.origin === 'engine-error' ||
        input.origin === 'load-error' ||
        input.origin === 'parallel-contract'
      if (generated && tag === 'block' && eventName !== 'PreToolUse') {
        return reject(
          input.origin,
          typeof value.reason === 'string' ? value.reason : 'runtime failure',
        )
      }
      const observer =
        eventName === 'SessionStart' ||
        eventName === 'SubagentStart' ||
        eventName === 'PostCompact' ||
        eventName === 'SessionEnd' ||
        eventName === 'Interrupt'
      if (observer && tag !== 'skip') {
        return reject(
          input.origin === 'before-hook' ? 'before-hook' : 'result',
          input.origin === 'before-hook'
            ? 'lifecycle block requires event-aware runtime refusal'
            : 'handler only supports skip',
        )
      }
      if (eventName === 'PostToolUse' && tag === 'allow')
        return reject('result', 'handler only supports block or skip')
      const allowed = new Set(['result', 'debugMessage'])
      if (tag === 'block' || (eventName === 'PreToolUse' && (tag === 'allow' || tag === 'ask')))
        allowed.add('reason')
      if (
        eventName === 'PreToolUse' ||
        eventName === 'UserPromptSubmit' ||
        eventName === 'PostToolUse' ||
        eventName === 'SessionStart' ||
        eventName === 'SubagentStart'
      )
        allowed.add('injectContext')
      if (eventName === 'PreToolUse' && (tag === 'allow' || tag === 'ask'))
        allowed.add('updatedInput')
      for (const key of Object.keys(value)) {
        if (value[key] === undefined) continue
        // Explicit false is the native default for an ordinary approval denial.
        if (
          key === 'interrupt' &&
          eventName === 'PermissionRequest' &&
          tag === 'block' &&
          value[key] === false
        )
          continue
        if (!allowed.has(key)) return reject(key, `unsupported field ${key} on ${tag}`)
        if (key !== 'result' && key !== 'updatedInput' && typeof value[key] !== 'string') {
          return reject(key, `${key} must be a string`)
        }
      }
      if (tag === 'block' && (typeof value.reason !== 'string' || value.reason.trim() === '')) {
        return reject('reason', 'clooks: invalid blank block reason')
      }
      const accepted: EngineResult = { result: tag }
      for (const key of ['reason', 'injectContext', 'debugMessage'] as const) {
        if (value[key] !== undefined) accepted[key] = value[key] as string
      }
      const diagnostics: string[] = []
      if (eventName === 'PreToolUse' && tag === 'allow' && accepted.reason !== undefined) {
        diagnostics.push(allowReasonAnnotation(accepted.reason))
        delete accepted.reason
      }
      let nextToolInput: Record<string, unknown> | undefined
      if (value.updatedInput !== undefined) {
        if (input.parallel) return reject('updatedInput', 'parallel input rewrites are unsupported')
        if (!isPlainObject(value.updatedInput))
          return reject('updatedInput', 'updatedInput must be a record')
        if (!metadata.tool) return reject('updatedInput', 'tool has no approved replacement codec')
        try {
          nextToolInput = metadata.tool.applyPatch(
            input.currentToolInput,
            value.updatedInput as Record<string, unknown>,
          )
          accepted.updatedInput = cloneDeep(nextToolInput)
        } catch (error) {
          return reject(
            'updatedInput',
            error instanceof Error ? error.message : 'invalid replacement',
          )
        }
      }
      return { kind: 'accepted', result: accepted, nextToolInput, diagnostics }
    },
  }
}
