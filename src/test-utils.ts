// Shared test helpers for branded type construction.
// Use these instead of inline `as` casts in test files.

import type { HookName, Milliseconds } from './types/branded.js'

/** Cast a plain string to HookName for test usage. */
export const hn = (s: string) => s as HookName

/** Cast a plain number to Milliseconds for test usage. */
export const ms = (n: number) => n as Milliseconds
