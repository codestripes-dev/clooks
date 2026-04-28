import { text, select, confirm, multiselect, isCancel, cancel as clackCancel } from '@clack/prompts'
import type { OutputContext } from './context.js'

/**
 * Thrown when the user cancels a prompt (Ctrl-C/Esc).
 * Caught by runCLI() in router.ts, which prints a cancel message
 * and exits cleanly. Commands that need custom cleanup can catch
 * this in their own try/catch before it bubbles to the router.
 */
export class CancelError extends Error {
  constructor() {
    super('Operation cancelled.')
    this.name = 'CancelError'
  }
}

/**
 * Returns true if the prompt should be suppressed (non-interactive).
 * Two cases: --json mode, or stdin is not a TTY (piped input).
 * @clack/prompts does NOT check for TTY internally — prompts hang
 * on non-TTY stdin. We must guard against this.
 */
export function isNonInteractive(ctx: OutputContext): boolean {
  return ctx.json || !process.stdin.isTTY
}

/**
 * Wraps a @clack/prompts call. If the user cancels (Ctrl-C/Esc),
 * throws CancelError. The router's top-level catch handles exit.
 * Commands needing cleanup can catch CancelError themselves.
 *
 * IMPORTANT: The cancel symbol is Symbol("clack:cancel") — a UNIQUE
 * symbol, NOT Symbol.for("clack:cancel"). Direct comparison will
 * silently fail. Always use isCancel() from @clack/prompts.
 */
function withCancel<T>(result: T | symbol): T {
  if (isCancel(result)) {
    clackCancel('Operation cancelled.')
    throw new CancelError()
  }
  return result as T
}

export async function promptText(
  ctx: OutputContext,
  opts: {
    message: string
    placeholder?: string
    defaultValue?: string
    required?: boolean
    validate?: (value: string) => string | void
  },
): Promise<string> {
  if (isNonInteractive(ctx)) {
    if (opts.defaultValue !== undefined) return opts.defaultValue
    throw new Error(
      `"${opts.message}" requires a value. Use the corresponding flag in non-interactive mode.`,
    )
  }
  const result = await text({
    message: opts.message,
    placeholder: opts.placeholder,
    defaultValue: opts.defaultValue,
    validate: opts.validate as
      | ((value: string | undefined) => string | Error | undefined)
      | undefined,
  })
  return withCancel(result)
}

export async function promptSelect<T extends string>(
  ctx: OutputContext,
  opts: {
    message: string
    options: { value: T; label: string; hint?: string }[]
    defaultValue?: T
  },
): Promise<T> {
  if (isNonInteractive(ctx)) {
    if (opts.defaultValue !== undefined) return opts.defaultValue
    throw new Error(
      `"${opts.message}" requires a selection. Use the corresponding flag in non-interactive mode.`,
    )
  }

  const result = await select<T>({
    message: opts.message,
    options: opts.options as any,
    initialValue: opts.defaultValue,
  })
  return withCancel(result) as T
}

export async function promptConfirm(
  ctx: OutputContext,
  opts: { message: string; defaultValue?: boolean },
): Promise<boolean> {
  if (isNonInteractive(ctx)) return opts.defaultValue ?? true
  const result = await confirm({
    message: opts.message,
    initialValue: opts.defaultValue,
  })
  return withCancel(result) as boolean
}

export async function promptMultiSelect<T extends string>(
  ctx: OutputContext,
  opts: {
    message: string
    options: { value: T; label: string; hint?: string }[]
    initialValues?: T[]
    required?: boolean
  },
): Promise<T[]> {
  if (isNonInteractive(ctx)) {
    // In non-interactive mode, return initialValues if provided, otherwise all options
    if (opts.initialValues !== undefined) return opts.initialValues
    return opts.options.map((o) => o.value)
  }

  const result = await multiselect({
    message: opts.message,
    options: opts.options as any,
    initialValues: opts.initialValues,
    required: opts.required ?? true,
  })
  return withCancel(result) as T[]
}
