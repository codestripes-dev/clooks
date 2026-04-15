// no-clooks-uninstall — Blocks `clooks uninstall` from running in this project
//
// Prevents agents from accidentally removing the project's Clooks installation.

import type { ClooksHook } from './types'

const UNINSTALL_RE = /\bclooks\s+uninstall\b/

export const hook: ClooksHook = {
  meta: {
    name: 'no-clooks-uninstall',
    description: 'Blocks clooks uninstall from running in this project',
  },

  PreToolUse(ctx) {
    if (ctx.toolName !== 'Bash') {
      return { result: 'skip' }
    }

    const command = typeof ctx.toolInput.command === 'string' ? ctx.toolInput.command : ''

    if (!UNINSTALL_RE.test(command)) {
      return { result: 'skip' }
    }

    return {
      result: 'block',
      reason:
        'Running `clooks uninstall` on this project is not allowed. The .clooks/ directory is committed and shared.',
    }
  },
}
