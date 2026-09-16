import { cloneDeep } from 'lodash-es'
import type { ApprovalInteraction, ApprovalQuestion } from '../interaction/types.js'
import {
  canonical,
  checkSignal,
  questionSchema,
  type UserApprovalDecision,
} from '../interaction/protocol.js'
import type { ExecutionResult } from './types.js'

export const approvalSetupMessage =
  'Live approval unavailable. Repair the Clooks registration for this provider and scope, then restart the client and retry.'

/** Distinguishes live-consent failures from unrelated legacy runtime errors. */
export class ApprovalFailure extends Error {
  readonly decision?: UserApprovalDecision

  constructor(message: string, options?: ErrorOptions & { decision?: UserApprovalDecision }) {
    super(message, options)
    this.name = 'ApprovalFailure'
    this.decision = options?.decision
  }
}

export async function requestApproval(
  interaction: ApprovalInteraction | undefined,
  question: ApprovalQuestion,
  signal: AbortSignal,
): Promise<void> {
  checkSignal(signal)
  if (!interaction) throw new Error(approvalSetupMessage)
  questionSchema.parse(question)
  const reply = await interaction.request(cloneDeep(question), signal)
  checkSignal(signal)
  if (reply.kind !== 'approved') {
    if (reply.userDecision === true && (reply.kind === 'declined' || reply.kind === 'cancelled')) {
      throw new ApprovalFailure(reply.message, { decision: reply.kind })
    }
    throw new Error(`Approval ${reply.kind}: ${reply.message}`)
  }
}

export async function confirmFinalApprovals(
  execution: ExecutionResult,
  interaction: ApprovalInteraction | undefined,
  operation: ApprovalQuestion['operation'],
  signal: AbortSignal,
): Promise<void> {
  const approvals = execution.preToolUse?.approvals ?? []
  let ordinal = approvals.length
  for (const approval of approvals) {
    if (canonical(approval.operation) === canonical(operation)) continue
    await requestApproval(interaction, { ...approval, ordinal: ++ordinal, operation }, signal)
  }
}
