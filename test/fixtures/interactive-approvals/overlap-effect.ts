import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { journal, log, root } from './channel'
import { loadOverlap } from './overlap-responder'

const directory = root()
const callId = process.argv[2]!
const manifest = loadOverlap(directory)
const call = manifest.calls[callId]
assert.ok(call, 'Native effect call ID absent from manifest')
const rows = journal(directory).filter((row) => row.key?.tool_use_id === callId)
const commands = rows.filter((row) => row.event === 'command-start')
const marker = `overlap-native-effect:${callId}`
appendFileSync(call.effect, marker + '\n')
log('overlap-native-effect', {
  key: commands.length === 1 ? commands[0].key : null,
  callId,
  label: call.label,
  effect: call.effect,
})
assert.equal(commands.length, 1)
console.log(marker)
