import { describe, expect, test } from "bun:test"
import { resolveHookPath } from "./resolve.js"
import type { HookName } from "../types/branded.js"

const hn = (s: string) => s as HookName

describe("resolveHookPath", () => {
  test("local hook (no slash)", () => {
    expect(resolveHookPath(hn("my-hook"), {})).toBe(".clooks/hooks/my-hook.ts")
  })

  test("remote hook (with slash)", () => {
    expect(resolveHookPath(hn("anthropic/secret-scanner"), {})).toBe(
      ".clooks/vendor/anthropic/secret-scanner/index.ts",
    )
  })

  test("remote hook with multiple path segments", () => {
    expect(resolveHookPath(hn("org/repo/hook-name"), {})).toBe(
      ".clooks/vendor/org/repo/hook-name/index.ts",
    )
  })

  test("explicit path overrides convention", () => {
    expect(
      resolveHookPath(hn("my-hook"), { path: "scripts/hooks/my-hook.ts" }),
    ).toBe("scripts/hooks/my-hook.ts")
  })

  test("explicit path overrides remote convention", () => {
    expect(
      resolveHookPath(hn("anthropic/scanner"), { path: "custom/scanner.ts" }),
    ).toBe("custom/scanner.ts")
  })
})
