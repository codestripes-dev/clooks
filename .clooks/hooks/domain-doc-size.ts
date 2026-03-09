// domain-doc-size — Blocks writes to domain docs that exceed size limits
//
// PreToolUse guard on Write and Edit for docs/domain/ files.
// Predicts the resulting line count before the tool executes:
// - Write: counts lines in toolInput.content (full file content)
// - Edit: reads current file, simulates the replacement, counts result
//
// Thresholds:
// - > 300 lines: block (hard limit violated)
// - > 150 lines: allow with injected reminder (approaching limit)
//
// Reference: docs/domain/index.md § "Size limit"

import { readFileSync } from "fs"
import { resolve } from "path"
import type { ClooksHook } from "../../src/types/hook.js"

const DOMAIN_DIR = "docs/domain/"
const SOFT_LIMIT = 150
const HARD_LIMIT = 300

function extractFilePath(
  toolName: string,
  toolInput: Record<string, unknown>,
): string | null {
  if (toolName !== "Write" && toolName !== "Edit") return null
  // After normalization, snake_case keys become camelCase
  const filePath = toolInput.filePath ?? toolInput.file_path
  return typeof filePath === "string" ? filePath : null
}

export function isDomainDoc(filePath: string, cwd: string): boolean {
  const abs = filePath.startsWith("/") ? filePath : resolve(cwd, filePath)
  const domainDir = resolve(cwd, DOMAIN_DIR)
  return abs.startsWith(domainDir + "/") && abs.endsWith(".md")
}

export function predictLineCount(
  toolName: string,
  toolInput: Record<string, unknown>,
): number {
  if (toolName === "Write") {
    const content = toolInput.content
    return typeof content === "string" ? content.split("\n").length : 0
  }

  if (toolName === "Edit") {
    // After normalization, snake_case keys become camelCase
    const filePath = toolInput.filePath ?? toolInput.file_path
    const oldString = toolInput.oldString ?? toolInput.old_string
    const newString = toolInput.newString ?? toolInput.new_string
    if (
      typeof filePath !== "string" ||
      typeof oldString !== "string" ||
      typeof newString !== "string"
    )
      return 0

    try {
      const current = readFileSync(filePath, "utf-8")
      const replaceAll = (toolInput.replaceAll ?? toolInput.replace_all) === true
      const result = replaceAll
        ? current.replaceAll(oldString, newString)
        : current.replace(oldString, newString)
      return result.split("\n").length
    } catch {
      return 0
    }
  }

  return 0
}

export const hook: ClooksHook = {
  meta: {
    name: "domain-doc-size",
    description:
      "Blocks domain doc writes exceeding 300 lines, warns above 150",
  },

  PreToolUse(ctx) {
    const filePath = extractFilePath(ctx.toolName, ctx.toolInput)
    if (!filePath) return { result: "skip" }
    if (!isDomainDoc(filePath, ctx.cwd)) return { result: "skip" }

    const lines = predictLineCount(ctx.toolName, ctx.toolInput)
    if (lines === 0) return { result: "skip" }

    if (lines > HARD_LIMIT) {
      return {
        result: "block",
        reason: `Domain doc size violation: ${filePath} would be ${lines} lines (limit: ${HARD_LIMIT}). Split into focused sub-docs in a subdirectory and update docs/domain/index.md.`,
      }
    }

    if (lines > SOFT_LIMIT) {
      return {
        result: "allow",
        injectContext: `Domain doc size notice: ${filePath} will be ${lines}/${HARD_LIMIT} lines. Plan a split proactively if more content is needed.`,
      }
    }

    return { result: "allow" }
  },
}
