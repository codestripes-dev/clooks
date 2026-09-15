import { cloneDeep, isPlainObject } from 'lodash-es'
import type { CheckedResult, InvocationResultPolicy, ResultPolicyInput } from '../agents/types.js'
import type { EventName } from '../types/branded.js'
import type { EngineResult } from './types.js'
import { hasLosslessShape } from '../agents/codex/policy.js'

/** Claude accepts the existing dynamic result surface; semantic validation is provider-owned. */
export const legacyResultPolicy: InvocationResultPolicy = {
  checkResult({ value }) {
    return {
      kind: 'accepted',
      result: value == null ? undefined : (value as EngineResult),
      diagnostics: [],
    }
  },
}

/** Detach both sides of the policy boundary, retaining undefined and opaque JSON keys. */
export function checkDetachedResult(
  policy: InvocationResultPolicy,
  input: ResultPolicyInput,
  eventName: EventName,
): CheckedResult {
  try {
    const value = input.value as EngineResult | null | undefined
    if (value?.result === 'ask') {
      if (
        eventName !== 'PreToolUse' ||
        input.origin !== 'handler' ||
        !hasLosslessShape(value) ||
        (value.updatedInput !== undefined && !isPlainObject(value.updatedInput)) ||
        Object.keys(value).some(
          (key) =>
            !['result', 'reason', 'updatedInput', 'injectContext', 'debugMessage'].includes(key) &&
            value[key as keyof EngineResult] !== undefined,
        ) ||
        (value.injectContext !== undefined && typeof value.injectContext !== 'string') ||
        (value.debugMessage !== undefined && typeof value.debugMessage !== 'string')
      )
        throw new Error('Invalid ask result')
    }
    const failure = policy.validateRawResult?.(input.value)
    if (failure) {
      return { kind: 'rejected', failure: { ...failure, hookName: input.hookName } }
    }
    const checked = cloneDeep(policy.checkResult(cloneDeep(input)))
    if (
      checked.kind === 'accepted' &&
      checked.result?.result === 'ask' &&
      typeof checked.result.reason !== 'string'
    ) {
      return {
        kind: 'rejected',
        failure: {
          eventName,
          hookName: input.hookName,
          capability: 'reason',
          message: 'ask reason must be a string; result effects refused.',
        },
      }
    }
    return checked
  } catch {
    return {
      kind: 'rejected',
      failure: {
        eventName,
        hookName: input.hookName,
        capability: 'result-policy',
        message: `clooks: result policy failed for hook "${input.hookName ?? 'runtime'}" on ${eventName}; result effects refused.`,
      },
    }
  }
}
