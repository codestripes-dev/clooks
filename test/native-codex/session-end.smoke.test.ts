import { test } from 'bun:test'
import { join } from 'node:path'
import { save, sessionEndCases } from './harness'
import { sessionEndScenario } from './session-end-scenario'

const exported = process.env.CLOOKS_NATIVE_LOGDIR
if (
  process.env.CLOOKS_E2E_DOCKER !== 'true' ||
  process.env.CLOOKS_NATIVE_MODE !== '--session-end' ||
  !exported
) {
  throw new Error('Use bash scripts/test-codex-native.sh --session-end in disposable Docker')
}
const logRoot: string = exported

test('real pinned Codex orderly shutdown emits SessionEnd and performs registered cleanup', async () => {
  await sessionEndScenario(logRoot)
  save(join(logRoot, 'completed.json'), {
    mode: '--session-end',
    completed: 1,
    cases: sessionEndCases,
    evidence: 'real pinned Codex exec orderly shutdown, synthetic model, fake tmux',
  })
}, 90_000)
