import { describe, expect, test } from "bun:test"
import { isDomainDoc, predictLineCount, hook } from "./domain-doc-size.js"
import type { PreToolUseContext } from "../../src/types/contexts.js"
import { writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"

// --- isDomainDoc (pure function) ---

describe("isDomainDoc", () => {
  const cwd = "/project"

  test.each([
    ["absolute domain path", "/project/docs/domain/hooks.md"],
    ["nested domain path", "/project/docs/domain/claude-code-hooks/events.md"],
  ])("returns true for: %s", (_label, filePath) => {
    expect(isDomainDoc(filePath, cwd)).toBe(true)
  })

  test.each([
    ["non-domain path", "/project/src/config/types.ts"],
    ["domain index itself", "/project/docs/domain.md"],
    ["non-md file in domain", "/project/docs/domain/notes.txt"],
    ["planned docs", "/project/docs/planned/FEAT-0001.md"],
    ["relative non-domain", "src/engine.ts"],
    ["different project same structure", "/other/docs/domain/hooks.md"],
  ])("returns false for: %s", (_label, filePath) => {
    expect(isDomainDoc(filePath, cwd)).toBe(false)
  })

  test("handles relative domain path", () => {
    expect(isDomainDoc("docs/domain/hooks.md", cwd)).toBe(true)
  })
})

// --- predictLineCount ---

describe("predictLineCount", () => {
  test("counts lines from Write content", () => {
    const content = Array(200).fill("line").join("\n")
    expect(predictLineCount("Write", { content })).toBe(200)
  })

  test("returns 0 for Write with no content", () => {
    expect(predictLineCount("Write", {})).toBe(0)
  })

  test("simulates Edit replacement", () => {
    const tmpDir = join(import.meta.dir, "../../tmp/test-predict-edit")
    mkdirSync(tmpDir, { recursive: true })
    const file = join(tmpDir, "doc.md")
    // 10 lines originally
    writeFileSync(file, Array(10).fill("line").join("\n"))

    // Replace one "line" with 50 lines — result: 10 - 1 + 50 = 59 lines
    const lines = predictLineCount("Edit", {
      file_path: file,
      old_string: "line",
      new_string: Array(50).fill("new").join("\n"),
    })
    expect(lines).toBe(59)

    rmSync(tmpDir, { recursive: true })
  })

  test("simulates Edit with replace_all", () => {
    const tmpDir = join(import.meta.dir, "../../tmp/test-predict-edit-all")
    mkdirSync(tmpDir, { recursive: true })
    const file = join(tmpDir, "doc.md")
    // "a\na\na" = 3 lines, each is "a"
    writeFileSync(file, "a\na\na")

    // Replace all "a" with "a\nb" — each "a" becomes 2 lines: "a\nb\na\nb\na\nb" = 6 lines
    const lines = predictLineCount("Edit", {
      file_path: file,
      old_string: "a",
      new_string: "a\nb",
      replace_all: true,
    })
    expect(lines).toBe(6)

    rmSync(tmpDir, { recursive: true })
  })

  test("returns 0 for non-existent file in Edit", () => {
    expect(
      predictLineCount("Edit", {
        file_path: "/nonexistent/file.md",
        old_string: "x",
        new_string: "y",
      }),
    ).toBe(0)
  })

  test("returns 0 for non-Write/Edit tools", () => {
    expect(predictLineCount("Bash", { command: "ls" })).toBe(0)
  })
})

// --- hook.PreToolUse handler ---

function makeCtx(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd = "/project",
): PreToolUseContext {
  return {
    event: "PreToolUse",
    toolName,
    toolInput,
    toolUseId: "tu-test",
    sessionId: "test-session",
    cwd,
    permissionMode: "default",
    transcriptPath: "/tmp/transcript.jsonl",
  }
}

describe("hook.PreToolUse", () => {
  test("skips non-Write/Edit tools", () => {
    const result = hook.PreToolUse!(
      makeCtx("Bash", { file_path: "/project/docs/domain/hooks.md" }),
      {},
    )
    expect(result).toEqual({ result: "skip" })
  })

  test("skips non-domain files", () => {
    const content = Array(400).fill("line").join("\n")
    const result = hook.PreToolUse!(
      makeCtx("Write", { file_path: "/project/src/config.ts", content }),
      {},
    )
    expect(result).toEqual({ result: "skip" })
  })

  test("blocks Write exceeding 300 lines", () => {
    const content = Array(310).fill("line").join("\n")
    const result = hook.PreToolUse!(
      makeCtx("Write", {
        file_path: "/project/docs/domain/big.md",
        content,
      }),
      {},
    ) as unknown as Record<string, unknown>
    expect(result.result).toBe("block")
    expect(result.reason).toContain("310")
    expect(result.reason).toContain("violation")
  })

  test("allows with reminder above 150 lines", () => {
    const content = Array(200).fill("line").join("\n")
    const result = hook.PreToolUse!(
      makeCtx("Write", {
        file_path: "/project/docs/domain/medium.md",
        content,
      }),
      {},
    ) as unknown as Record<string, unknown>
    expect(result.result).toBe("allow")
    expect(result.injectContext).toContain("200")
    expect(result.injectContext).toContain("notice")
  })

  test("allows small files silently", () => {
    const content = Array(50).fill("line").join("\n")
    const result = hook.PreToolUse!(
      makeCtx("Write", {
        file_path: "/project/docs/domain/small.md",
        content,
      }),
      {},
    )
    expect(result).toEqual({ result: "allow" })
  })

  test("blocks Edit that would exceed 300 lines", () => {
    const tmpDir = join(import.meta.dir, "../../tmp/test-hook-edit-block")
    const domainDir = join(tmpDir, "docs/domain")
    mkdirSync(domainDir, { recursive: true })
    const file = join(domainDir, "growing.md")
    writeFileSync(file, Array(290).fill("line").join("\n"))

    // Replace one "line" with 20 lines → 290 - 1 + 20 = 309 lines
    const result = hook.PreToolUse!(
      makeCtx(
        "Edit",
        {
          file_path: file,
          old_string: "line",
          new_string: Array(20).fill("new").join("\n"),
        },
        tmpDir,
      ),
      {},
    ) as unknown as Record<string, unknown>
    expect(result.result).toBe("block")
    expect(result.reason).toContain("309")

    rmSync(tmpDir, { recursive: true })
  })
})
