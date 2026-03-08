// The hook module contract. Every hook file must conform to this shape.
// Reference: PRODUCT_EXPLORATION.md, section "The Hook File Contract"

import type { ClaudeCodeCommonInput } from "./claude-code.js";

/**
 * Metadata exported by a hook file as a named export called "meta".
 * Declares the hook's identity and which events it handles.
 */
export interface HookMeta {
  /** Human-readable name for this hook. Must be unique within a project. */
  name: string;

  /** Which Claude Code events this hook wants to receive. */
  events: string[];

  /** Optional human-readable description. */
  description?: string;
}

/**
 * The result a hook handler returns to express its decision.
 * Returning undefined means "no opinion" -- the engine treats this as a pass-through.
 */
export interface HookResult {
  /** The hook's decision: allow the action, deny it, or ask the user. */
  decision: "allow" | "deny" | "ask";

  /** A human-readable reason for the decision. Shown to Claude (for deny) or the user (for allow/ask). */
  reason?: string;

  /** Modified tool input. Only meaningful for PreToolUse. Replaces the original tool_input. */
  updatedInput?: Record<string, unknown>;

  /** Additional context injected into Claude's conversation. */
  additionalContext?: string;
}

/**
 * The handler function signature. Receives the full Claude Code event payload
 * and returns a HookResult (or undefined for no opinion).
 * May be synchronous or asynchronous.
 */
export type HookHandler = (
  input: ClaudeCodeCommonInput & Record<string, unknown>
) => HookResult | undefined | Promise<HookResult | undefined>;

/**
 * The shape of a hook module. Every hook .ts file must have:
 * - A named export "meta" conforming to HookMeta
 * - A default export that is a HookHandler function
 */
export interface HookModule {
  meta: HookMeta;
  default: HookHandler;
}
