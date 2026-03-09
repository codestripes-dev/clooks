import { describe, expect, test } from "bun:test"
import { validateConfig } from "./validate.js"
import { DEFAULT_MAX_FAILURES, DEFAULT_MAX_FAILURES_MESSAGE } from "./constants.js"

describe("validateConfig", () => {
  test("valid minimal config", () => {
    const result = validateConfig({ version: "1.0.0" })
    expect(result.version).toBe("1.0.0")
    expect(result.global).toEqual({
      timeout: 30000,
      onError: "block",
      maxFailures: DEFAULT_MAX_FAILURES,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
    })
    expect(result.hooks).toEqual({})
    expect(result.events).toEqual({})
  })

  test("valid full config", () => {
    const result = validateConfig({
      version: "1.0.0",
      config: { timeout: 15000, onError: "continue" },
      "log-bash-commands": {
        config: { logDir: ".clooks/logs" },
        timeout: 5000,
        onError: "continue",
        parallel: true,
      },
      "no-production-writes": {},
      "anthropic/secret-scanner": {
        config: { strict: true },
        timeout: 5000,
      },
      "company-policy": {
        path: "scripts/hooks/company-policy.ts",
      },
      PreToolUse: {
        order: ["anthropic/secret-scanner", "no-production-writes"],
      },
    })

    expect(result.version).toBe("1.0.0")
    expect(result.global).toEqual({
      timeout: 15000,
      onError: "continue",
      maxFailures: DEFAULT_MAX_FAILURES,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
    })

    expect(Object.keys(result.hooks)).toEqual([
      "log-bash-commands",
      "no-production-writes",
      "anthropic/secret-scanner",
      "company-policy",
    ])
    expect(result.hooks["log-bash-commands"]!.config).toEqual({
      logDir: ".clooks/logs",
    })
    expect(result.hooks["log-bash-commands"]!.parallel).toBe(true)
    expect(result.hooks["log-bash-commands"]!.timeout).toBe(5000)
    expect(result.hooks["no-production-writes"]!.resolvedPath).toBe(
      ".clooks/hooks/no-production-writes.ts",
    )
    expect(result.hooks["anthropic/secret-scanner"]!.resolvedPath).toBe(
      ".clooks/vendor/anthropic/secret-scanner/index.ts",
    )
    expect(result.hooks["company-policy"]!.resolvedPath).toBe(
      "scripts/hooks/company-policy.ts",
    )

    expect(Object.keys(result.events)).toEqual(["PreToolUse"])
    expect(result.events["PreToolUse"]!.order).toEqual([
      "anthropic/secret-scanner",
      "no-production-writes",
    ])
  })

  test("missing version throws", () => {
    expect(() => validateConfig({ "my-hook": {} })).toThrow(
      'missing required "version"',
    )
  })

  test("non-string version throws", () => {
    expect(() => validateConfig({ version: 1 })).toThrow("must be a string")
  })

  test("invalid global timeout throws", () => {
    expect(() =>
      validateConfig({ version: "1.0.0", config: { timeout: -1 } }),
    ).toThrow("must be a positive number")
  })

  test("invalid global onError throws", () => {
    expect(() =>
      validateConfig({ version: "1.0.0", config: { onError: "ignore" } }),
    ).toThrow('must be "block", "continue", or "trace"')
  })

  test("invalid hook timeout throws", () => {
    expect(() =>
      validateConfig({ version: "1.0.0", "my-hook": { timeout: "fast" } }),
    ).toThrow("must be a positive number")
  })

  test("invalid hook onError throws", () => {
    expect(() =>
      validateConfig({ version: "1.0.0", "my-hook": { onError: 42 } }),
    ).toThrow('must be "block", "continue", or "trace"')
  })

  test("hook entry with all valid fields", () => {
    const result = validateConfig({
      version: "1.0.0",
      "my-hook": {
        config: { key: "val" },
        path: "custom/path.ts",
        timeout: 5000,
        onError: "continue",
        parallel: true,
      },
    })
    const hook = result.hooks["my-hook"]!
    expect(hook.resolvedPath).toBe("custom/path.ts")
    expect(hook.config).toEqual({ key: "val" })
    expect(hook.timeout).toBe(5000)
    expect(hook.onError).toBe("continue")
    expect(hook.parallel).toBe(true)
  })

  test("event entry recognized by name", () => {
    const result = validateConfig({
      version: "1.0.0",
      PreToolUse: { order: ["a", "b"] },
    })
    expect(result.events["PreToolUse"]).toEqual({
      order: ["a", "b"],
    })
    expect(result.hooks["PreToolUse"]).toBeUndefined()
  })

  test("event entry with invalid order throws", () => {
    expect(() =>
      validateConfig({
        version: "1.0.0",
        PreToolUse: { order: "not-an-array" },
      }),
    ).toThrow("must be an array of strings")
  })

  test("empty hook entry is valid", () => {
    const result = validateConfig({ version: "1.0.0", "my-hook": {} })
    const hook = result.hooks["my-hook"]!
    expect(hook.config).toEqual({})
    expect(hook.resolvedPath).toBe(".clooks/hooks/my-hook.ts")
    expect(hook.timeout).toBeUndefined()
    expect(hook.onError).toBeUndefined()
    expect(hook.parallel).toBe(false)
  })

  test("hook path resolution for local hook", () => {
    const result = validateConfig({
      version: "1.0.0",
      "my-hook": {},
    })
    expect(result.hooks["my-hook"]!.resolvedPath).toBe(
      ".clooks/hooks/my-hook.ts",
    )
  })

  test("reserved event name goes to events, not hooks", () => {
    const result = validateConfig({
      version: "1.0.0",
      SessionStart: { order: ["a"] },
    })
    expect(result.events["SessionStart"]).toEqual({ order: ["a"] })
    expect(result.hooks["SessionStart"]).toBeUndefined()

    // Even with config-like fields, Stop is still an event
    const result2 = validateConfig({
      version: "1.0.0",
      Stop: { config: { key: "val" } },
    })
    expect(result2.events["Stop"]).toBeDefined()
    expect(result2.hooks["Stop"]).toBeUndefined()
  })

  // --- maxFailures / maxFailuresMessage ---

  test("global maxFailures parsed correctly", () => {
    const result = validateConfig({
      version: "1.0.0",
      config: { maxFailures: 5 },
    })
    expect(result.global.maxFailures).toBe(5)
  })

  test("global maxFailuresMessage parsed correctly", () => {
    const result = validateConfig({
      version: "1.0.0",
      config: { maxFailuresMessage: "custom message" },
    })
    expect(result.global.maxFailuresMessage).toBe("custom message")
  })

  test("global maxFailures defaults to 3 when not specified", () => {
    const result = validateConfig({ version: "1.0.0" })
    expect(result.global.maxFailures).toBe(3)
  })

  test("global maxFailuresMessage defaults to the default message when not specified", () => {
    const result = validateConfig({ version: "1.0.0" })
    expect(result.global.maxFailuresMessage).toBe(DEFAULT_MAX_FAILURES_MESSAGE)
  })

  test("global maxFailures rejects negative numbers", () => {
    expect(() =>
      validateConfig({ version: "1.0.0", config: { maxFailures: -1 } }),
    ).toThrow("must be a non-negative integer")
  })

  test("global maxFailures rejects floats", () => {
    expect(() =>
      validateConfig({ version: "1.0.0", config: { maxFailures: 2.5 } }),
    ).toThrow("must be a non-negative integer")
  })

  test("global maxFailures rejects non-numbers", () => {
    expect(() =>
      validateConfig({ version: "1.0.0", config: { maxFailures: "three" } }),
    ).toThrow("must be a non-negative integer")
  })

  test("global maxFailuresMessage rejects non-strings", () => {
    expect(() =>
      validateConfig({ version: "1.0.0", config: { maxFailuresMessage: 42 } }),
    ).toThrow("must be a string")
  })

  test("hook-level maxFailures parsed correctly", () => {
    const result = validateConfig({
      version: "1.0.0",
      "my-hook": { maxFailures: 10 },
    })
    expect(result.hooks["my-hook"]!.maxFailures).toBe(10)
  })

  test("hook-level maxFailuresMessage parsed correctly", () => {
    const result = validateConfig({
      version: "1.0.0",
      "my-hook": { maxFailuresMessage: "hook message" },
    })
    expect(result.hooks["my-hook"]!.maxFailuresMessage).toBe("hook message")
  })

  test("hook-level maxFailures: 0 accepted (disables circuit breaker)", () => {
    const result = validateConfig({
      version: "1.0.0",
      "my-hook": { maxFailures: 0 },
    })
    expect(result.hooks["my-hook"]!.maxFailures).toBe(0)
  })

  // --- FEAT-0017: ErrorMode "trace", EventEntry rejections, hook events sub-map ---

  test('ErrorMode accepts "trace" at hook level', () => {
    const result = validateConfig({
      version: "1.0.0",
      scanner: { onError: "trace" },
    })
    expect(result.hooks["scanner"]!.onError).toBe("trace")
  })

  test('"trace" rejected at global level', () => {
    expect(() =>
      validateConfig({ version: "1.0.0", config: { onError: "trace" } }),
    ).toThrow('cannot be "trace"')
  })

  test("EventEntry.onError rejected with hard error", () => {
    expect(() =>
      validateConfig({
        version: "1.0.0",
        PreToolUse: { onError: "block" },
      }),
    ).toThrow("event-level onError has been removed")
  })

  test("EventEntry.timeout rejected with hard error", () => {
    expect(() =>
      validateConfig({
        version: "1.0.0",
        PreToolUse: { timeout: 5000 },
      }),
    ).toThrow("event-level timeout has been removed")
  })

  test("hook events sub-map validates correctly", () => {
    const result = validateConfig({
      version: "1.0.0",
      scanner: {
        events: {
          PreToolUse: { onError: "trace" },
        },
      },
    })
    expect(result.hooks["scanner"]!.events).toEqual({
      PreToolUse: { onError: "trace" },
    })
  })

  test("hook events sub-map rejects unknown event names", () => {
    expect(() =>
      validateConfig({
        version: "1.0.0",
        scanner: {
          events: {
            FakeEvent: { onError: "block" },
          },
        },
      }),
    ).toThrow('unknown event "FakeEvent"')
  })

  test('hook events sub-map rejects "trace" for non-injectable events', () => {
    expect(() =>
      validateConfig({
        version: "1.0.0",
        scanner: {
          events: {
            SessionEnd: { onError: "trace" },
          },
        },
      }),
    ).toThrow("does not support additionalContext")
  })

  test('hook events sub-map accepts "trace" for injectable events', () => {
    const result = validateConfig({
      version: "1.0.0",
      scanner: {
        events: {
          PreToolUse: { onError: "trace" },
          PostToolUse: { onError: "trace" },
        },
      },
    })
    expect(result.hooks["scanner"]!.events!["PreToolUse"]).toEqual({ onError: "trace" })
    expect(result.hooks["scanner"]!.events!["PostToolUse"]).toEqual({ onError: "trace" })
  })
})
