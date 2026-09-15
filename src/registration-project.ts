import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { prepareRegistrationWrite, readRegistrationText } from './registration-file.js'
import type { AgentId } from './agents/types.js'

export function prepareProjectIdentity(root: string, agent: AgentId) {
  const marker = `.clooks/bin/${agent === 'codex' ? 'codex' : 'claude'}-project-id`
  const path = join(root, marker)
  const original = readRegistrationText(path)
  if (original !== undefined && !/^[a-f0-9]{32}\n$/.test(original))
    throw new Error(`\`${path}\`: invalid project ID`)
  const id = original?.slice(0, -1) ?? randomBytes(16).toString('hex')
  return {
    ...prepareRegistrationWrite(path, original, id + '\n'),
    marker,
    id,
    owner: `project:${id}`,
  }
}
