import { requireThat } from './harness'

export interface ShutdownObservation {
  payloads: Record<string, unknown>[]
  timeline: Array<{ event?: string; sessionId?: string; reason?: string; args?: string[] }>
  markerExists: boolean
}

export function assertShutdownObservation(observed: ShutdownObservation) {
  const ends = observed.payloads.filter((item) => item.hook_event_name === 'SessionEnd')
  requireThat(ends.length === 1, 'Expected exactly one native SessionEnd capture')
  const end = ends[0]!
  requireThat(
    typeof end.session_id === 'string' && end.session_id.length > 0,
    'Missing native session identity',
  )
  requireThat(end.reason === 'other', 'Unexpected native shutdown reason')
  const start = observed.timeline.findIndex((item) => item.event === 'SessionStart')
  const stop = observed.timeline.findIndex((item) => item.event === 'Stop')
  const closed = observed.timeline.findIndex((item) => item.event === 'SessionEnd')
  requireThat(
    start >= 0 && stop > start && closed > stop,
    'Missing ordered native lifecycle handlers',
  )
  requireThat(
    observed.timeline.filter((item) => item.event === 'SessionEnd').length === 1,
    'Duplicate shutdown handler',
  )
  for (const index of [start, stop, closed]) {
    requireThat(
      observed.timeline[index]!.sessionId === end.session_id,
      'Native and handler session identities differ',
    )
  }
  requireThat(observed.timeline[closed]!.reason === 'other', 'Missing normalized shutdown reason')
  const cleanup = observed.timeline
    .slice(stop + 1, closed)
    .flatMap((item) => (item.args ? [item.args] : []))
  for (const expected of [
    ['set-window-option', '-t', '@7', 'window-status-style', 'default'],
    ['set-window-option', '-t', '@7', '-u', 'window-status-current-style'],
    ['set-window-option', '-t', '@7', 'automatic-rename', 'on'],
  ]) {
    requireThat(
      cleanup.some((args) => JSON.stringify(args) === JSON.stringify(expected)),
      `Missing shutdown cleanup: ${expected.join(' ')}`,
    )
  }
  requireThat(!observed.markerExists, 'Native shutdown cleanup marker remains')
}
