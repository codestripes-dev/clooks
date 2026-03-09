import { log, intro, outro } from '@clack/prompts'
import type { OutputContext } from './context.js'

/** Print a section header. Suppressed in JSON mode. */
export function printIntro(ctx: OutputContext, title: string): void {
  if (ctx.json) return
  intro(title)
}

/** Print a success message. Suppressed in JSON mode. */
export function printSuccess(ctx: OutputContext, message: string): void {
  if (ctx.json) return
  log.success(message)
}

/** Print an info message. Suppressed in JSON mode. */
export function printInfo(ctx: OutputContext, message: string): void {
  if (ctx.json) return
  log.info(message)
}

/** Print a warning. Suppressed in JSON mode. */
export function printWarning(ctx: OutputContext, message: string): void {
  if (ctx.json) return
  log.warning(message)
}

/** Print an error. NOT suppressed in JSON mode — errors should always be visible. */
export function printError(_ctx: OutputContext, message: string): void {
  log.error(message)
}

/** Print a closing message. Suppressed in JSON mode. */
export function printOutro(ctx: OutputContext, message: string): void {
  if (ctx.json) return
  outro(message)
}
