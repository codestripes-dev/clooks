import { describe, test, expect } from "bun:test"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const GENERATED_PATH = resolve(import.meta.dir, "../src/generated/clooks-types.d.ts")

const skip = !existsSync(GENERATED_PATH)

describe.skipIf(skip)("generate-types", () => {
  async function loadTypes(): Promise<string> {
    const mod = await import("../src/generated/clooks-types.d.ts" as string, { with: { type: "text" } })
    return mod.default
  }

  test("can import generated types as text", async () => {
    const content = await loadTypes()
    expect(typeof content).toBe("string")
  })

  test("is non-empty and reasonable size", async () => {
    const content = await loadTypes()
    expect(content.length).toBeGreaterThan(100)
  })

  test("first line starts with version header", async () => {
    const content = await loadTypes()
    const firstLine = content.split("\n")[0]!
    expect(firstLine).toMatch(/^\/\/ Clooks v\d+\.\d+\.\d+/)
  })

  test("contains key public type names", async () => {
    const content = await loadTypes()

    const requiredTypes = [
      "ClooksHook",
      "HookMeta",
      "MaybeAsync",
      "BaseContext",
      "PreToolUseContext",
      "PostToolUseContext",
      "AllowResult",
      "BlockResult",
      "SkipResult",
      "DebugFields",
      "InjectableContext",
      "PermissionMode",
      "SessionStartSource",
    ]

    for (const typeName of requiredTypes) {
      expect(content).toContain(typeName)
    }
  })

  test("does NOT export internal types", async () => {
    const content = await loadTypes()

    // These internal types should not appear as exported declarations
    const internalTypes = ["EventName", "HookName", "Milliseconds", "ResultTag"]

    for (const typeName of internalTypes) {
      // Check that no export declaration directly exports these names
      const exportPattern = new RegExp(`export\\s+(type|interface)\\s+${typeName}\\b`)
      expect(content).not.toMatch(exportPattern)
    }
  })

  test("has no import statements", async () => {
    const content = await loadTypes()
    expect(content).not.toMatch(/^import\s/m)
  })
})

if (skip) {
  test.skip("generate-types (skipped: run build first to generate src/generated/clooks-types.d.ts)", () => {})
}
