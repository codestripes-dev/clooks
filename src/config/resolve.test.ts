import { describe, expect, test } from "bun:test"
import { resolveHookPath } from "./resolve.js"
import { hn } from "../test-utils.js"
import { join } from "path"

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

  // --- basePath parameter tests ---

  test("basePath prepends to local hook path", () => {
    expect(resolveHookPath(hn("my-hook"), {}, "/home/user")).toBe(
      join("/home/user", ".clooks/hooks/my-hook.ts"),
    )
  })

  test("basePath prepends to remote hook path", () => {
    expect(resolveHookPath(hn("anthropic/scanner"), {}, "/home/user")).toBe(
      join("/home/user", ".clooks/vendor/anthropic/scanner/index.ts"),
    )
  })

  test("basePath prepends to explicit path", () => {
    expect(
      resolveHookPath(hn("my-hook"), { path: "scripts/my-hook.ts" }, "/home/user"),
    ).toBe(join("/home/user", "scripts/my-hook.ts"))
  })

  test("basePath '.' is same as default (no basePath)", () => {
    expect(resolveHookPath(hn("my-hook"), {}, ".")).toBe(
      ".clooks/hooks/my-hook.ts",
    )
  })
})
