import { Database } from 'bun:sqlite'
import { existsSync, writeFileSync } from 'node:fs'
import { ApprovalStore } from '../../src/agents/codex/approval-store'

const [home, action, ready, gate, payload] = process.argv.slice(2) as string[]
let store = new ApprovalStore(home!)
if (action === 'lock') {
  const db = new Database(store.path)
  db.exec('BEGIN IMMEDIATE')
  writeFileSync(ready!, '')
  while (!existsSync(gate!)) await Bun.sleep(5)
  db.exec('ROLLBACK')
  db.close()
} else if (action === 'acknowledge') {
  const data = JSON.parse(payload!)
  // Observe entry into the real SQLite lock acquisition, without replacing its behavior.
  const exec = Database.prototype.exec
  Database.prototype.exec = function (sql, ...bindings) {
    if (sql === 'BEGIN IMMEDIATE') writeFileSync(ready!, '')
    return exec.call(this, sql, ...bindings)
  }
  store = new ApprovalStore(home!, () => {
    const released = existsSync(gate!)
    writeFileSync(data.clockReceipt, JSON.stringify({ sampledAt: Date.now(), released }))
    return released ? data.expiresAt : data.expiresAt - 1
  })
  try {
    console.log(JSON.stringify(store.acknowledge(data.token)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
} else {
  writeFileSync(ready!, '')
  while (!existsSync(gate!)) await Bun.sleep(5)
  const data = JSON.parse(payload!)
  try {
    if (action === 'issue') console.log(JSON.stringify(store.issueOrReuse(data)))
    else {
      store.finalizePermit(data.baseInvocationHash, data.decisionHash, data.requiredTokens)
      console.log('permit')
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
