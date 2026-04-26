export type OptionalKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? K : never
}[keyof T]

/**
 * Partial update applied to a tool's input. Pass on `allow({ updatedInput })`
 * or `ask({ updatedInput })` from `PreToolUseContext` / `PermissionRequestContext`.
 *
 * - Set a key to a value to change it.
 * - Set an optional key to `null` to remove it (required keys cannot be `null`).
 * - Omit a key (or set `undefined`) to leave it untouched.
 *
 * @example
 * // Bash: rewrite the command, keep everything else
 * ctx.allow({ updatedInput: { command: 'rg foo' } })
 *
 * @example
 * // Bash: drop the optional timeout
 * ctx.allow({ updatedInput: { timeout: null } })
 */
export type Patch<T> = {
  [K in keyof T]?: K extends OptionalKeys<T> ? T[K] | null : T[K]
}
