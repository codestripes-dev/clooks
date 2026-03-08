import { describe, expect, test } from "bun:test"
import { deepMerge, mergeConfigFiles } from "./merge.js"

describe("deepMerge", () => {
  test("scalar override", () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 })
  })

  test("new key added", () => {
    expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 })
  })

  test("nested object merge", () => {
    expect(deepMerge({ x: { a: 1, b: 2 } }, { x: { b: 3 } })).toEqual({
      x: { a: 1, b: 3 },
    })
  })

  test("array replacement", () => {
    expect(deepMerge({ arr: [1, 2] }, { arr: [3] })).toEqual({ arr: [3] })
  })

  test("null replaces object", () => {
    expect(deepMerge({ x: { a: 1 } }, { x: null })).toEqual({ x: null })
  })

  test("object replaces scalar", () => {
    expect(deepMerge({ x: 1 }, { x: { a: 2 } })).toEqual({ x: { a: 2 } })
  })

  test("deep nested merge (3 levels)", () => {
    expect(
      deepMerge(
        { a: { b: { c: 1, d: 2 }, e: 3 } },
        { a: { b: { c: 99 } } },
      ),
    ).toEqual({ a: { b: { c: 99, d: 2 }, e: 3 } })
  })

  test("realistic config merge", () => {
    const base = {
      version: "1.0.0",
      "lint-guard": {
        config: { strict: true, blocked_tools: ["Bash"] },
      },
    }
    const local = {
      "lint-guard": {
        config: { strict: false },
      },
    }
    const result = deepMerge(base, local)
    expect(result).toEqual({
      version: "1.0.0",
      "lint-guard": {
        config: { strict: false, blocked_tools: ["Bash"] },
      },
    })
  })
})

describe("mergeConfigFiles", () => {
  test("undefined local returns base unchanged", () => {
    const base = { version: "1.0.0" }
    expect(mergeConfigFiles(base, undefined)).toBe(base)
  })
})
