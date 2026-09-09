import { expect, test } from 'bun:test'
import { UnsupportedAgentAdapterError } from './types.js'

test.each(['claude-code', 'codex'] as const)(
  'unsupported %s adapter error retains selection context',
  (agent) => {
    const error = new UnsupportedAgentAdapterError(agent)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('UnsupportedAgentAdapterError')
    expect(error.agent).toBe(agent)
    expect(error.message).toBe(`clooks: CLOOKS_AGENT=${agent} is not implemented yet.`)
  },
)
