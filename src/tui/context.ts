import type { Command } from 'commander'

export interface OutputContext {
  json: boolean
}

/**
 * Reads OutputContext from a Commander command's global options.
 * Call this inside an action handler: `const ctx = getCtx(cmd)`.
 * Commander passes `(options, cmd)` to action handlers, so `cmd`
 * is always available.
 */
export function getCtx(cmd: Command): OutputContext {
  return { json: cmd.optsWithGlobals().json === true }
}
