import { spinner as clackSpinner } from '@clack/prompts'
import type { OutputContext } from './context.js'

/**
 * Runs an async operation with a spinner. In JSON mode, runs silently.
 */
export async function withSpinner<T>(
  ctx: OutputContext,
  opts: { start: string; stop?: string },
  fn: () => Promise<T>,
): Promise<T> {
  if (ctx.json) return fn()
  const s = clackSpinner()
  s.start(opts.start)
  try {
    const result = await fn()
    s.stop(opts.stop ?? opts.start)
    return result
  } catch (e) {
    s.stop('Failed')
    throw e
  }
}
