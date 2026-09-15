import { expect, test } from 'bun:test'
import { ApprovalFailure } from './live-approvals.js'

test('approval failures preserve typed identity and diagnostic cause', () => {
  const cause = new Error('approval transport closed')
  const failure = new ApprovalFailure('Final operation could not be confirmed', { cause })
  expect(failure).toBeInstanceOf(ApprovalFailure)
  expect(failure).toBeInstanceOf(Error)
  expect(failure.name).toBe('ApprovalFailure')
  expect(failure.message).toBe('Final operation could not be confirmed')
  expect(failure.cause).toBe(cause)
  expect(failure.toString()).toBe('ApprovalFailure: Final operation could not be confirmed')
  expect(new ApprovalFailure('Approval declined').cause).toBeUndefined()
})
