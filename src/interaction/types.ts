import type { JsonValue } from '../agents/types.js'
import type { HookName } from '../types/branded.js'
import type { CheckInput, NativePreToolUseDenial, UserApprovalDecision } from './protocol.js'

export type ApprovalReply =
  | { kind: 'approved' }
  | {
      kind: 'declined' | 'cancelled' | 'unavailable' | 'timed-out'
      message: string
      userDecision?: true
    }

export interface ApprovalQuestion {
  hookName: HookName
  ordinal: number
  question?: string
  reason: string
  operation: { toolName: string; input: JsonValue }
}

export interface ApprovalInteraction {
  request(question: ApprovalQuestion, signal: AbortSignal): Promise<ApprovalReply>
  acknowledgeDenial?(decision: UserApprovalDecision, denial: NativePreToolUseDenial): Promise<void>
  close(): Promise<void>
}

export interface ApprovalInteractionOptions {
  identity: CheckInput
  disposition?: 'run' | 'suppressed'
  signal?: AbortSignal
}
