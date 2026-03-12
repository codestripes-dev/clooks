import { describe, expect, test } from "bun:test"
import { resolveHookPath } from "./resolve.js"
import { hn } from "../test-utils.js"
import { join } from "path"

describe("resolveHookPath", () => {
  // --- No uses, convention-based resolution ---

  test("No uses, no slash → local hook convention", () => {
    expect(resolveHookPath(hn("my-hook"), {})).toBe(".clooks/hooks/my-hook.ts")
  })

  test("No uses, with slash → vendor hook convention", () => {
    expect(resolveHookPath(hn("acme/scanner"), {})).toBe(
      ".clooks/vendor/acme/scanner/index.ts",
    )
  })

  test("remote hook with multiple path segments", () => {
    expect(resolveHookPath(hn("org/repo/hook-name"), {})).toBe(
      ".clooks/vendor/org/repo/hook-name/index.ts",
    )
  })

  // --- Uses: path-like values ---

  test("Uses: path-like (./)", () => {
    expect(
      resolveHookPath(hn("my-alias"), { uses: "./lib/hook.ts" }),
    ).toBe("./lib/hook.ts")
  })

  test("Uses: path-like (../) throws traversal error", () => {
    expect(() =>
      resolveHookPath(hn("my-alias"), { uses: "../shared/hook.ts" }),
    ).toThrow('contains path traversal sequences')
  })

  test("Uses: path-like (/) throws absolute path error", () => {
    expect(() =>
      resolveHookPath(hn("my-alias"), { uses: "/absolute/hook.ts" }),
    ).toThrow('must be a relative path')
  })

  test("Uses: path-like with basePath", () => {
    expect(
      resolveHookPath(hn("my-alias"), { uses: "./lib/hook.ts" }, "/home/user/.clooks"),
    ).toBe(join("/home/user/.clooks", "lib/hook.ts"))
  })

  // --- Uses: hook name references ---

  test("Uses: hook name (no slash)", () => {
    expect(
      resolveHookPath(hn("verbose-logger"), { uses: "log-bash-commands" }),
    ).toBe(".clooks/hooks/log-bash-commands.ts")
  })

  test("Uses: hook name (with slash)", () => {
    expect(
      resolveHookPath(hn("strict-scanner"), { uses: "acme/security" }),
    ).toBe(".clooks/vendor/acme/security/index.ts")
  })

  test("Uses: hook name with basePath", () => {
    expect(
      resolveHookPath(hn("my-alias"), { uses: "base-hook" }, "/home/user"),
    ).toBe(join("/home/user", ".clooks/hooks/base-hook.ts"))
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

  test("basePath '.' is same as default (no basePath)", () => {
    expect(resolveHookPath(hn("my-hook"), {}, ".")).toBe(
      ".clooks/hooks/my-hook.ts",
    )
  })
})

describe("path traversal guard", () => {
  test("rejects absolute path with basePath", () => {
    expect(() =>
      resolveHookPath(hn("my-hook"), { uses: "/etc/passwd" }, "/home/user"),
    ).toThrow('must be a relative path')
  })

  test("rejects traversal that escapes basePath", () => {
    expect(() =>
      resolveHookPath(hn("my-hook"), { uses: "../../evil.ts" }, "/home/user/.clooks"),
    ).toThrow('path traversal')
  })

  test("rejects embedded traversal that escapes basePath", () => {
    expect(() =>
      resolveHookPath(hn("my-hook"), { uses: "./hooks/../../../outside.ts" }, "/home/user"),
    ).toThrow('path traversal')
  })

  test("rejects deeply nested traversal", () => {
    expect(() =>
      resolveHookPath(hn("my-hook"), { uses: "./a/b/c/../../../../../../../etc/passwd" }, "/home/user"),
    ).toThrow('path traversal')
  })

  test("allows safe relative path within basePath", () => {
    expect(
      resolveHookPath(hn("my-hook"), { uses: "./hooks/my-hook.ts" }, "/home/user"),
    ).toBe(join("/home/user", "hooks/my-hook.ts"))
  })

  test("allows safe relative path without basePath", () => {
    expect(
      resolveHookPath(hn("my-hook"), { uses: "./scripts/hook.ts" }),
    ).toBe("./scripts/hook.ts")
  })

  test("allows path that resolves to exactly the base directory", () => {
    expect(
      resolveHookPath(hn("my-hook"), { uses: "./subdir/.." }, "/home/user"),
    ).toBe(join("/home/user", "subdir/.."))
  })

  test("allows triple-dot directory name (not traversal)", () => {
    expect(
      resolveHookPath(hn("my-hook"), { uses: "./.../hook.ts" }),
    ).toBe("./.../hook.ts")
  })

  test("rejects bare '..' as traversal", () => {
    expect(() =>
      resolveHookPath(hn("my-hook"), { uses: ".." }),
    ).toThrow('path traversal')
  })
})
