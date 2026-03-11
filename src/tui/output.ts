import { log, intro, outro } from '@clack/prompts'
import type { OutputContext } from './context.js'
import { jsonError } from './json-envelope.js'

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

/** Print an error. In JSON mode, writes a JSON error envelope to stdout. In human mode, writes styled error to stderr. */
export function printError(ctx: OutputContext, command: string, message: string): void {
  if (ctx.json) {
    process.stdout.write(jsonError(command, message) + '\n')
    return
  }
  log.error(message)
}

/** Print a closing message. Suppressed in JSON mode. */
export function printOutro(ctx: OutputContext, message: string): void {
  if (ctx.json) return
  outro(message)
}
