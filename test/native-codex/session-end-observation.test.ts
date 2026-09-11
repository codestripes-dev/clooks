import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertShutdownObservation, type ShutdownObservation } from './session-end-observation'
import { exportSmokeBinary, mandatoryCases, publishPassed, save } from './harness'

function valid(): ShutdownObservation {
  return {
    payloads: [{ hook_event_name: 'SessionEnd', session_id: 'native-session', reason: 'other' }],
    timeline: [
      { event: 'SessionStart', sessionId: 'native-session' },
      { event: 'Stop', sessionId: 'native-session' },
      { args: ['set-window-option', '-t', '@7', 'window-status-style', 'default'] },
      { args: ['set-window-option', '-t', '@7', '-u', 'window-status-current-style'] },
      { args: ['set-window-option', '-t', '@7', 'automatic-rename', 'on'] },
      { event: 'SessionEnd', sessionId: 'native-session', reason: 'other' },
    ],
    markerExists: false,
  }
}
const directories: string[] = []
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('native shutdown observation oracle', () => {
  test('accepts matched raw shutdown, lifecycle and cleanup', () => {
    expect(() => assertShutdownObservation(valid())).not.toThrow()
  })
  test.each(['raw-event', 'handler', 'cleanup', 'marker', 'session', 'order'])(
    'rejects false-pass mutant %s',
    (mutant) => {
      const sample = valid()
      if (mutant === 'raw-event') sample.payloads = []
      if (mutant === 'handler') sample.timeline.pop()
      if (mutant === 'cleanup') sample.timeline.splice(4, 1)
      if (mutant === 'marker') sample.markerExists = true
      if (mutant === 'session') sample.timeline.at(-1)!.sessionId = 'other-session'
      if (mutant === 'order') sample.timeline.reverse()
      expect(() => assertShutdownObservation(sample)).toThrow()
    },
  )
  test('focused receipt cannot be published as full smoke', () => {
    const logs = mkdtempSync(join(tmpdir(), 'clooks-shutdown-publication-'))
    directories.push(logs)
    save(join(logs, 'completed.json'), { mode: '--smoke', completed: 1, cases: ['SESSION-END'] })
    expect(() => publishPassed(logs, '--smoke', 0)).toThrow('Incomplete native cases')
    expect(existsSync(join(logs, 'passed.json'))).toBe(false)
    expect(mandatoryCases).toHaveLength(16)
    expect(mandatoryCases.at(-1)).toBe('SESSION-END')
  })
  test('focused receipt requires correct identity and actual successful test exit', () => {
    const logs = mkdtempSync(join(tmpdir(), 'clooks-shutdown-publication-'))
    directories.push(logs)
    save(join(logs, 'completed.json'), {
      mode: '--session-end',
      completed: 1,
      cases: ['SESSION-END'],
    })
    expect(publishPassed(logs, '--session-end', 1)).toBe(1)
    expect(existsSync(join(logs, 'passed.json'))).toBe(false)
    expect(publishPassed(logs, '--session-end', 0)).toBe(0)
    expect(existsSync(join(logs, 'passed.json'))).toBe(true)
    expect(() => exportSmokeBinary(logs, '--session-end', '/unused')).toThrow(
      'Only smoke exports a binary',
    )
    expect(existsSync(join(logs, 'clooks'))).toBe(false)
  })
})
