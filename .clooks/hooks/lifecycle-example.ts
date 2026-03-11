// Example lifecycle hook demonstrating beforeHook and afterHook.
// NOT registered in clooks.yml — for documentation and testing only.
//
// Use case: timing + environment gating.
// - beforeHook: blocks Bash on production branches, records start time.
// - handler: allows all tool uses.
// - afterHook: logs handler duration.
//
// Note: The module-level phaseStartTime variable is not concurrency-safe.
// In parallel mode, interleaved invocations would overwrite each other's
// start times. This pattern is safe only for sequential hooks.
//
// In your own hooks, import from the generated declarations file:
//   import type { ClooksHook } from './types'

import type { ClooksHook } from "../../src/types/hook.js"

let phaseStartTime: number | undefined

export const hook: ClooksHook = {
  meta: {
    name: "lifecycle-example",
    description: "Example: environment gating + timing via lifecycle methods",
  },

  beforeHook(event) {
    phaseStartTime = performance.now()

    if (
      event.type === "PreToolUse" &&
      event.meta.gitBranch === "production" &&
      event.input.toolName === "Bash"
    ) {
      event.respond({
        result: "block",
        reason: "Bash commands are blocked on the production branch",
      })
    }

    // Skip pattern: make the hook invisible (handler + afterHook don't run).
    // Useful for conditional hook activation:
    //   if (someCondition) { event.respond({ result: "skip" }); return }
  },

  PreToolUse(_ctx) {
    return { result: "allow" }
  },

  afterHook(event) {
    if (phaseStartTime !== undefined) {
      const duration = performance.now() - phaseStartTime
      // In a real hook, you might log this to a file or send to a metrics service
      console.log(`[lifecycle-example] ${event.type} handler took ${duration.toFixed(1)}ms`)
      phaseStartTime = undefined
    }
  },
}
