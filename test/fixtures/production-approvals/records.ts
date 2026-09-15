import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Row {
  event: string
  at: number
  pid: number
  [key: string]: unknown
}

export function record(root: string, event: string, fields: Record<string, unknown> = {}) {
  appendFileSync(
    join(root, 'production.jsonl'),
    JSON.stringify({ event, at: Date.now(), pid: process.pid, ...fields }) + '\n',
  )
}

export function rows(root: string): Row[] {
  const path = join(root, 'production.jsonl')
  return existsSync(path)
    ? readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : []
}
