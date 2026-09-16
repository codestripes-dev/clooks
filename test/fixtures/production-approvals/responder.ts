import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { respond, type Case } from './evidence'
const input = await Bun.stdin.json()
const root = process.env.APPROVAL_ROOT!
const c: Case = JSON.parse(readFileSync(join(root, 'case.json'), 'utf8'))
const response = await respond(input.message, input.requested_schema, c)
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'Elicitation', ...response } }))
