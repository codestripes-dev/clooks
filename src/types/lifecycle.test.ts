import type { BeforeHookEvent, AfterHookEvent } from "./lifecycle.js"
import type { ClooksHook } from "./hook.js"
import { describe, test, expect } from "bun:test"

describe("lifecycle types", () => {
  test("BeforeHookEvent narrows input by type discriminant", () => {
    // This test verifies at the type level — it just needs to compile.
    const handler = (event: BeforeHookEvent) => {
      if (event.type === "PreToolUse") {
        // Should compile: toolName exists on PreToolUseContext
        const _name: string = event.input.toolName
      }
    }
    expect(handler).toBeDefined()
  })

  test("AfterHookEvent narrows handlerResult and respond by type", () => {
    const handler = (event: AfterHookEvent) => {
      if (event.type === "PreToolUse") {
        // Should compile: respond accepts PreToolUseResult
        event.respond({ result: "allow" })
      }
    }
    expect(handler).toBeDefined()
  })

  test("BeforeHookEvent rejects narrowed field access without discriminant check", () => {
    const handler = (event: BeforeHookEvent) => {
      // @ts-expect-error — toolName doesn't exist on the unnarrowed union
      const _name: string = event.input.toolName
    }
    expect(handler).toBeDefined()
  })

  test("BeforeHookEvent.respond rejects non-BlockResult", () => {
    const handler = (event: BeforeHookEvent) => {
      if (event.type === "PreToolUse") {
        // @ts-expect-error — beforeHook respond only accepts BlockResult, not AllowResult
        event.respond({ result: "allow" })
      }
    }
    expect(handler).toBeDefined()
  })

  test("BeforeHookEvent.respond accepts SkipResult", () => {
    const handler = (event: BeforeHookEvent) => {
      event.respond({ result: "skip" })
    }
    expect(handler).toBeDefined()
  })

  test("AfterHookEvent.respond rejects mismatched result for observe events", () => {
    const handler = (event: AfterHookEvent) => {
      if (event.type === "SessionStart") {
        // @ts-expect-error — SessionStartResult is SkipResult & InjectableContext, not BlockResult
        event.respond({ result: "block", reason: "nope" })
      }
    }
    expect(handler).toBeDefined()
  })

  test("ClooksHook accepts lifecycle methods", () => {
    const hook: ClooksHook = {
      meta: { name: "test-hook" },
      beforeHook(event, config) {
        if (event.type === "PreToolUse") {
          event.respond({ result: "block", reason: "test" })
        }
      },
      afterHook(event, config) {
        if (event.type === "PreToolUse") {
          event.respond({ result: "allow" })
        }
      },
      PreToolUse(ctx, config) {
        return { result: "allow" }
      },
    }
    expect(hook.meta.name).toBe("test-hook")
  })
})
