export interface JsonEnvelope {
  ok: boolean
  command: string
  data?: unknown
  error?: string
}

export function jsonSuccess(command: string, data: unknown): string {
  return JSON.stringify({ ok: true, command, data })
}

export function jsonError(command: string, error: string): string {
  return JSON.stringify({ ok: false, command, error })
}
