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

  test("Uses: path-like (../) resolves relative path", () => {
    expect(
      resolveHookPath(hn("my-alias"), { uses: "../shared/hook.ts" }),
    ).toBe("../shared/hook.ts")
  })

  test("Uses: path-like (/) returns absolute path as-is", () => {
    expect(
      resolveHookPath(hn("my-alias"), { uses: "/absolute/hook.ts" }),
    ).toBe("/absolute/hook.ts")
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

describe("path resolution — absolute and traversal paths", () => {
  test("absolute path with basePath returns absolute path as-is", () => {
    expect(
      resolveHookPath(hn("my-hook"), { uses: "/etc/hooks/my-hook.ts" }, "/home/user"),
    ).toBe("/etc/hooks/my-hook.ts")
  })

  test("traversal path with basePath joins normally", () => {
    expect(
      resolveHookPath(hn("my-hook"), { uses: "../../shared/hook.ts" }, "/home/user/.clooks"),
    ).toBe(join("/home/user/.clooks", "../../shared/hook.ts"))
  })

  test("relative path within basePath", () => {
    expect(
      resolveHookPath(hn("my-hook"), { uses: "./hooks/my-hook.ts" }, "/home/user"),
    ).toBe(join("/home/user", "hooks/my-hook.ts"))
  })

  test("relative path without basePath", () => {
    expect(
      resolveHookPath(hn("my-hook"), { uses: "./scripts/hook.ts" }),
    ).toBe("./scripts/hook.ts")
  })

  test("bare '..' without basePath", () => {
    expect(
      resolveHookPath(hn("my-hook"), { uses: ".." }),
    ).toBe("..")
  })
})
