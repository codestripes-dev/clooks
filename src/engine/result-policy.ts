import { cloneDeep } from 'lodash-es'
import type { CheckedResult, InvocationResultPolicy, ResultPolicyInput } from '../agents/types.js'
import type { EventName } from '../types/branded.js'
import type { EngineResult } from './types.js'

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
    const failure = policy.validateRawResult?.(input.value)
    if (failure) {
      return { kind: 'rejected', failure: { ...failure, hookName: input.hookName } }
    }
    return cloneDeep(policy.checkResult(cloneDeep(input)))
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
