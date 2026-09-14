import type {
  TranslateFailureInput,
  TranslateFinalOutputInput,
  TranslatedAgentOutput,
} from '../types.js'
import { allowReasonAnnotation } from './policy.js'

export function translateFailure(input: TranslateFailureInput): TranslatedAgentOutput {
  const dispositions: Record<string, string> = {
    PreToolUse: 'Pending call denial requested.',
    PermissionRequest: 'Pending approval denial requested.',
    UserPromptSubmit: 'Inspected prompt rejection requested.',
    PostToolUse: 'Rejected-result feedback requested after execution; no rollback is possible.',
    SessionStart: 'Pending turn work termination requested.',
    PreCompact: 'Stop before compaction requested.',
    Stop: 'Continuation termination requested; no further continuation is requested.',
    SubagentStop: 'Child continuation termination requested; no further continuation is requested.',
    SubagentStart:
      'Local hook failure only; no native startup veto is available and detailed stderr may be discarded.',
    PostCompact: 'Local hook failure after compaction; no rollback or native veto is requested.',
    SessionEnd:
      'Local hook failure only; no session closure veto is available and native stderr delivery is not guaranteed.',
    Interrupt: 'Local observer failure only; no cancellation veto or continuation is requested.',
  }
  const disposition =
    input.eventName && Object.hasOwn(dispositions, input.eventName)
      ? dispositions[input.eventName]
      : 'Unidentified event; local failure only, with no native prevention guarantee.'
  const prefix = `clooks: Codex ${input.eventName ?? 'unidentified event'} hook "${input.failure.hookName ?? 'runtime'}" capability "${input.failure.capability}": `
  const message = input.failure.message.trim() || 'runtime failure.'
  const reason = `${message.startsWith(prefix) ? message : prefix + message} ${disposition}`
  const output: Record<string, unknown> = { systemMessage: reason }
  switch (input.eventName) {
    case 'Interrupt':
      return { output: JSON.stringify(output), exitCode: 0 }
    case 'PreToolUse':
      output.hookSpecificOutput = {
        hookEventName: input.eventName,
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      }
      break
    case 'PermissionRequest':
      output.hookSpecificOutput = {
        hookEventName: input.eventName,
        decision: { behavior: 'deny', message: reason },
      }
      break
    case 'UserPromptSubmit':
    case 'PostToolUse':
      output.decision = 'block'
      output.reason = reason
      break
    case 'SessionStart':
    case 'PreCompact':
    case 'Stop':
    case 'SubagentStop':
      output.continue = false
      output.stopReason = reason
      break
    default:
      return { stderr: reason, exitCode: 2 }
  }
  return { output: JSON.stringify(output), exitCode: 0 }
}

export function translateFinalOutput(input: TranslateFinalOutputInput): TranslatedAgentOutput {
  if (input.policyFailure) return translateFailure({ ...input, failure: input.policyFailure })
  const result = input.result
  const output: Record<string, unknown> = {}
  const specific: Record<string, unknown> = { hookEventName: input.eventName }
  const messages = [...input.systemMessages, ...input.diagnostics]
  if (input.eventName === 'Interrupt') {
    return {
      output:
        messages.length > 0 ? JSON.stringify({ systemMessage: messages.join('\n') }) : undefined,
      exitCode: 0,
    }
  }
  if (input.eventName === 'SessionEnd') {
    return { stderr: messages.length > 0 ? messages.join('\n') : undefined, exitCode: 0 }
  }
  if (input.eventName === 'PreToolUse' && result?.result === 'block') {
    specific.permissionDecision = 'deny'
    specific.permissionDecisionReason = result.reason
  } else if (input.eventName === 'PreToolUse' && result?.result === 'allow') {
    if (result.updatedInput !== undefined) {
      if (!input.invocation?.private.tool) throw new Error('missing Codex replacement codec')
      specific.permissionDecision = 'allow'
      specific.updatedInput = input.invocation.private.tool.encode(result.updatedInput)
    }
    if (result.reason !== undefined) messages.push(allowReasonAnnotation(result.reason))
  } else if (input.eventName === 'PermissionRequest') {
    if (result?.result === 'allow') specific.decision = { behavior: 'allow' }
    else if (result?.result === 'block')
      specific.decision = { behavior: 'deny', message: result.reason }
  } else if (result?.result === 'block') {
    if (input.eventName === 'PreCompact') {
      output.continue = false
      output.stopReason = result.reason
    } else if (
      input.eventName === 'UserPromptSubmit' ||
      input.eventName === 'PostToolUse' ||
      input.eventName === 'Stop' ||
      input.eventName === 'SubagentStop'
    ) {
      output.decision = 'block'
      output.reason = result.reason
    }
  }
  if (result?.injectContext !== undefined) specific.additionalContext = result.injectContext
  if (Object.keys(specific).length > 1) output.hookSpecificOutput = specific
  if (messages.length > 0) output.systemMessage = messages.join('\n')
  return {
    output: Object.keys(output).length > 0 ? JSON.stringify(output) : undefined,
    exitCode: 0,
  }
}
