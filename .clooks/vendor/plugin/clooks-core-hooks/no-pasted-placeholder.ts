// no-pasted-placeholder — Rejects prompts containing a literal
// `[Pasted text #N +N lines]` or `[Pasted Content N chars]` placeholder.
// This heuristic flags potentially unexpanded pastes on any agent;
// literal examples can also match. No config.

import type { ClooksHook } from "./types"

const PLACEHOLDER_PATTERN = /\[Pasted text #\d+ \+\d+ lines?\]|\[Pasted Content \d+ chars\]/

const BLOCK_REASON = `Your prompt contains a possible unresolved paste placeholder (e.g. "[Pasted text #1 +10 lines]" or "[Pasted Content 123 chars]"). This may indicate that pasted content was not expanded into the prompt; literal examples also match. Re-paste the actual content, or remove the placeholder, and submit again.`

export function hasPastedPlaceholder(prompt: string): boolean {
  return PLACEHOLDER_PATTERN.test(prompt)
}

export const hook: ClooksHook = {
  meta: {
    name: "no-pasted-placeholder",
    description:
      "Blocks UserPromptSubmit on possible unresolved paste markers: `[Pasted text #N +N lines]` or `[Pasted Content N chars]`",
  },

  UserPromptSubmit(ctx) {
    // Subagent completion notices can legitimately quote an unresolved placeholder.
    if (ctx.prompt.startsWith('<task-notification>')) return ctx.skip()
    if (!hasPastedPlaceholder(ctx.prompt)) return ctx.skip()

    return ctx.block({
      reason: BLOCK_REASON,
      debugMessage: "no-pasted-placeholder: blocked unresolved paste placeholder",
    })
  },
}
