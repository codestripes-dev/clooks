export const EMPTY_STDIN_DIAGNOSTIC =
  'clooks: received empty stdin; no hook event was supplied.\n' +
  'No hook handlers were run.\n\n' +
  "If Claude was launched inside another agent's sandbox,\n" +
  'that sandbox may have prevented hook-input delivery.\n' +
  'Retry the Claude launch with approved permissions outside\n' +
  'that sandbox, keeping Clooks enabled.'

export class EmptyStdinError extends Error {
  constructor() {
    super(EMPTY_STDIN_DIAGNOSTIC)
    this.name = 'EmptyStdinError'
  }
}

export async function readStdinJson(): Promise<unknown> {
  const bytes = await Bun.stdin.bytes()
  if (bytes.every((b) => b === 32 || b === 9 || b === 10 || b === 13)) {
    throw new EmptyStdinError()
  }
  return new Blob([bytes]).json()
}

export function formatStdinError(error: unknown): string {
  if (error instanceof EmptyStdinError) return EMPTY_STDIN_DIAGNOSTIC
  return `clooks: failed to parse stdin JSON: ${error instanceof Error ? error.message : String(error)}`
}
