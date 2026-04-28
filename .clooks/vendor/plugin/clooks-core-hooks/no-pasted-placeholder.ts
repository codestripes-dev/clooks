// no-pasted-placeholder — Rejects prompts containing a literal
// `[Pasted text #N +N lines]` placeholder. If one survives into the submitted
// prompt, Claude Code failed to expand the paste and the prompt references
// nothing. No config.

import type { ClooksHook } from "./types"

const PLACEHOLDER_PATTERN = /\[Pasted text #\d+ \+\d+ lines?\]/

const BLOCK_REASON = `Your prompt contains an unresolved paste placeholder (e.g. "[Pasted text #1 +10 lines]"). That literal text means the paste was not expanded into the prompt. Re-paste the actual content, or remove the placeholder, and submit again.`

export function hasPastedPlaceholder(prompt: string): boolean {
  return PLACEHOLDER_PATTERN.test(prompt)
}

export const hook: ClooksHook = {
  meta: {
    name: "no-pasted-placeholder",
    description:
      "Blocks UserPromptSubmit when the prompt still contains a literal `[Pasted text #N +N lines]` placeholder",
  },

  UserPromptSubmit(ctx) {
    if (!hasPastedPlaceholder(ctx.prompt)) return ctx.skip()

    return ctx.block({
      reason: BLOCK_REASON,
      debugMessage: "no-pasted-placeholder: blocked unresolved paste placeholder",
    })
  },
}
