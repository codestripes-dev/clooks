import { describe, expect, test, spyOn } from "bun:test"
import { orderHooksForEvent, partitionIntoGroups } from "./ordering.js"
import type { OrderedHook } from "./ordering.js"
import type { LoadedHook } from "./loader.js"
import type { HookEntry, EventEntry } from "./config/types.js"
import type { ClooksHook } from "./types/hook.js"
import type { HookName } from "./types/branded.js"
import { hn } from "./test-utils.js"

/** Create a minimal LoadedHook stub for testing. */
function makeLoaded(name: string): LoadedHook {
  return {
    name: hn(name),
    hook: { meta: { name, events: [] } } as unknown as ClooksHook,
    config: {},
    hookPath: `/test/hooks/${name}.ts`,
    configPath: "/test/.clooks/clooks.yml",
  }
}

/** Create a minimal HookEntry stub with the given parallel flag. */
function makeEntry(parallel: boolean): HookEntry {
  return {
    resolvedPath: "test.ts",
    config: {},
    parallel,
    origin: "project",
  }
}

/** Build a Record<HookName, HookEntry> from plain string keys (avoids branded type issues in tests). */
function makeEntries(entries: Record<string, HookEntry>): Record<HookName, HookEntry> {
  const result = {} as Record<HookName, HookEntry>
  for (const [name, entry] of Object.entries(entries)) {
    result[hn(name)] = entry
  }
  return result
}

/** Extract hook names from an OrderedHook array for easy assertions. */
function names(ordered: OrderedHook[]): string[] {
  return ordered.map((o) => o.loaded.name as string)
}

/** Extract parallel flags from an OrderedHook array. */
function flags(ordered: OrderedHook[]): boolean[] {
  return ordered.map((o) => o.parallel)
}

describe("orderHooksForEvent", () => {
  test("empty matched set returns empty array", () => {
    const result = orderHooksForEvent([], undefined, {} as Record<HookName, HookEntry>, "PreToolUse")
    expect(result).toEqual([])
  })

  test("no order list, all sequential: returns hooks in declaration order", () => {
    const matched = [makeLoaded("hookA"), makeLoaded("hookB"), makeLoaded("hookC")]
    const hookEntries = makeEntries({
      hookA: makeEntry(false),
      hookB: makeEntry(false),
      hookC: makeEntry(false),
    })

    const result = orderHooksForEvent(matched, undefined, hookEntries, "PreToolUse")

    expect(names(result)).toEqual(["hookA", "hookB", "hookC"])
    expect(flags(result)).toEqual([false, false, false])
  })

  test("no order list, mixed parallel/sequential: parallel hoisted to front", () => {
    const matched = [
      makeLoaded("seqA"),
      makeLoaded("parB"),
      makeLoaded("seqC"),
      makeLoaded("parD"),
    ]
    const hookEntries = makeEntries({
      seqA: makeEntry(false),
      parB: makeEntry(true),
      seqC: makeEntry(false),
      parD: makeEntry(true),
    })

    const result = orderHooksForEvent(matched, undefined, hookEntries, "PreToolUse")

    expect(names(result)).toEqual(["parB", "parD", "seqA", "seqC"])
    expect(flags(result)).toEqual([true, true, false, false])
  })

  test("no order list with empty order array: treated as no order list", () => {
    const matched = [
      makeLoaded("seqA"),
      makeLoaded("parB"),
      makeLoaded("seqC"),
    ]
    const hookEntries = makeEntries({
      seqA: makeEntry(false),
      parB: makeEntry(true),
      seqC: makeEntry(false),
    })
    const eventEntry: EventEntry = { order: [] as any }

    const result = orderHooksForEvent(matched, eventEntry, hookEntries, "PreToolUse")

    expect(names(result)).toEqual(["parB", "seqA", "seqC"])
  })

  test("explicit order, all sequential: returns hooks in specified order", () => {
    const matched = [makeLoaded("hookA"), makeLoaded("hookB"), makeLoaded("hookC")]
    const hookEntries = makeEntries({
      hookA: makeEntry(false),
      hookB: makeEntry(false),
      hookC: makeEntry(false),
    })
    const eventEntry: EventEntry = {
      order: [hn("hookC"), hn("hookA"), hn("hookB")],
    }

    const result = orderHooksForEvent(matched, eventEntry, hookEntries, "PreToolUse")

    expect(names(result)).toEqual(["hookC", "hookA", "hookB"])
    expect(flags(result)).toEqual([false, false, false])
  })

  test("explicit order, mixed: ordered hooks in specified positions, unordered parallel first, unordered sequential last", () => {
    const matched = [
      makeLoaded("seqA"),
      makeLoaded("parB"),
      makeLoaded("seqC"),
      makeLoaded("parD"),
      makeLoaded("seqE"),
    ]
    const hookEntries = makeEntries({
      seqA: makeEntry(false),
      parB: makeEntry(true),
      seqC: makeEntry(false),
      parD: makeEntry(true),
      seqE: makeEntry(false),
    })
    // Only order seqC and parB; seqA and seqE are unordered sequential, parD is unordered parallel
    const eventEntry: EventEntry = {
      order: [hn("seqC"), hn("parB")],
    }

    const result = orderHooksForEvent(matched, eventEntry, hookEntries, "PreToolUse")

    // unordered parallel first (parD), then ordered (seqC, parB), then unordered sequential (seqA, seqE)
    expect(names(result)).toEqual(["parD", "seqC", "parB", "seqA", "seqE"])
    expect(flags(result)).toEqual([true, false, true, false, false])
  })

  test("all hooks in order list: only ordered sequence, no unordered groups", () => {
    const matched = [makeLoaded("hookA"), makeLoaded("hookB"), makeLoaded("hookC")]
    const hookEntries = makeEntries({
      hookA: makeEntry(false),
      hookB: makeEntry(true),
      hookC: makeEntry(false),
    })
    const eventEntry: EventEntry = {
      order: [hn("hookC"), hn("hookB"), hn("hookA")],
    }

    const result = orderHooksForEvent(matched, eventEntry, hookEntries, "PreToolUse")

    expect(names(result)).toEqual(["hookC", "hookB", "hookA"])
    expect(flags(result)).toEqual([false, true, false])
  })

  test("order references hook not in matched set: throws", () => {
    const matched = [makeLoaded("hookA")]
    const hookEntries = makeEntries({
      hookA: makeEntry(false),
      hookB: makeEntry(false),
    })
    const eventEntry: EventEntry = {
      order: [hn("hookA"), hn("hookB")],
    }

    expect(() => orderHooksForEvent(matched, eventEntry, hookEntries, "PreToolUse")).toThrow(
      'event "PreToolUse" order references hook "hookB" which does not handle this event',
    )
  })

  test("duplicate name in order list: throws", () => {
    const matched = [makeLoaded("hookA"), makeLoaded("hookB")]
    const hookEntries = makeEntries({
      hookA: makeEntry(false),
      hookB: makeEntry(false),
    })
    const eventEntry: EventEntry = {
      order: [hn("hookA"), hn("hookB"), hn("hookA")],
    }

    expect(() => orderHooksForEvent(matched, eventEntry, hookEntries, "PreToolUse")).toThrow(
      'duplicate hook name "hookA"',
    )
  })

  test("unique order list succeeds (regression guard)", () => {
    const matched = [makeLoaded("hookA"), makeLoaded("hookB")]
    const hookEntries = makeEntries({
      hookA: makeEntry(false),
      hookB: makeEntry(false),
    })
    const eventEntry: EventEntry = {
      order: [hn("hookB"), hn("hookA")],
    }

    const result = orderHooksForEvent(matched, eventEntry, hookEntries, "PreToolUse")
    expect(names(result)).toEqual(["hookB", "hookA"])
  })

  test("order list references disabled hook (in disabledNames): silently skipped", () => {
    const matched = [makeLoaded("hookA")]
    const hookEntries = makeEntries({
      hookA: makeEntry(false),
      hookB: makeEntry(false),
    })
    const eventEntry: EventEntry = {
      order: [hn("hookA"), hn("hookB")],
    }
    const disabledNames = new Set([hn("hookB")])

    // Should NOT throw — hookB is disabled, so it's silently skipped
    const result = orderHooksForEvent(matched, eventEntry, hookEntries, "PreToolUse", disabledNames)
    expect(names(result)).toEqual(["hookA"])
  })

  test("order list references hook NOT in disabledNames and NOT in matched set: still throws", () => {
    const matched = [makeLoaded("hookA")]
    const hookEntries = makeEntries({
      hookA: makeEntry(false),
      hookB: makeEntry(false),
    })
    const eventEntry: EventEntry = {
      order: [hn("hookA"), hn("hookB")],
    }
    // disabledNames does NOT include hookB
    const disabledNames = new Set<import("./types/branded.js").HookName>()

    expect(() => orderHooksForEvent(matched, eventEntry, hookEntries, "PreToolUse", disabledNames)).toThrow(
      'event "PreToolUse" order references hook "hookB" which does not handle this event',
    )
  })

  test("order list where all referenced hooks are disabled: empty orderedMiddle, only unordered hooks run", () => {
    const matched = [makeLoaded("hookC")]
    const hookEntries = makeEntries({
      hookA: makeEntry(false),
      hookB: makeEntry(false),
      hookC: makeEntry(false),
    })
    const eventEntry: EventEntry = {
      order: [hn("hookA"), hn("hookB")],
    }
    const disabledNames = new Set([hn("hookA"), hn("hookB")])

    const result = orderHooksForEvent(matched, eventEntry, hookEntries, "PreToolUse", disabledNames)
    // hookC is unordered sequential, so it goes at the end (which is the only section)
    expect(names(result)).toEqual(["hookC"])
  })

  test("existing tests pass when disabledNames is omitted (backward compatible)", () => {
    // This test confirms that omitting disabledNames doesn't change behavior
    const matched = [makeLoaded("hookA"), makeLoaded("hookB")]
    const hookEntries = makeEntries({
      hookA: makeEntry(false),
      hookB: makeEntry(false),
    })
    const eventEntry: EventEntry = {
      order: [hn("hookB"), hn("hookA")],
    }

    // No disabledNames parameter — should work exactly as before
    const result = orderHooksForEvent(matched, eventEntry, hookEntries, "PreToolUse")
    expect(names(result)).toEqual(["hookB", "hookA"])
  })
})

describe("home-first default ordering", () => {
  test("home hooks appear before project hooks in default ordering (all sequential)", () => {
    // Home hooks come first in the matched array (insertion order from merge)
    const matched = [
      makeLoaded("home-hook-a"),
      makeLoaded("home-hook-b"),
      makeLoaded("project-hook-c"),
      makeLoaded("project-hook-d"),
    ]
    const hookEntries = makeEntries({
      "home-hook-a": { ...makeEntry(false), origin: "home" as const },
      "home-hook-b": { ...makeEntry(false), origin: "home" as const },
      "project-hook-c": makeEntry(false),
      "project-hook-d": makeEntry(false),
    })

    const result = orderHooksForEvent(matched, undefined, hookEntries, "PreToolUse")

    // With no order list and all sequential, declaration order is preserved
    expect(names(result)).toEqual(["home-hook-a", "home-hook-b", "project-hook-c", "project-hook-d"])
  })

  test("home hooks appear before project hooks with mixed parallel/sequential", () => {
    // Mixed origins and parallel flags — parallel hoisted, but within each group
    // the original insertion order (home before project) is preserved
    const matched = [
      makeLoaded("home-par"),
      makeLoaded("home-seq"),
      makeLoaded("project-par"),
      makeLoaded("project-seq"),
    ]
    const hookEntries = makeEntries({
      "home-par": { ...makeEntry(true), origin: "home" as const },
      "home-seq": { ...makeEntry(false), origin: "home" as const },
      "project-par": makeEntry(true),
      "project-seq": makeEntry(false),
    })

    const result = orderHooksForEvent(matched, undefined, hookEntries, "PreToolUse")

    // Parallel first (home-par before project-par), then sequential (home-seq before project-seq)
    expect(names(result)).toEqual(["home-par", "project-par", "home-seq", "project-seq"])
  })

  test("Record insertion order preserves home-first from merge", () => {
    // Verify that Object.entries preserves insertion order for string keys
    const hooks: Record<string, HookEntry> = {}
    hooks["home-a"] = { ...makeEntry(false), origin: "home" as const }
    hooks["home-b"] = { ...makeEntry(false), origin: "home" as const }
    hooks["project-c"] = makeEntry(false)
    hooks["project-d"] = makeEntry(false)

    const keys = Object.keys(hooks)
    expect(keys).toEqual(["home-a", "home-b", "project-c", "project-d"])
  })
})

describe("partitionIntoGroups", () => {
  /** Create a minimal OrderedHook for partitioning tests. */
  function makeOrdered(name: string, parallel: boolean): OrderedHook {
    return {
      loaded: makeLoaded(name),
      parallel,
    }
  }

  test("empty input returns empty array", () => {
    const result = partitionIntoGroups([], "TestEvent")
    expect(result).toEqual([])
  })

  test("all sequential: one group", () => {
    const hooks = [
      makeOrdered("a", false),
      makeOrdered("b", false),
      makeOrdered("c", false),
    ]

    const groups = partitionIntoGroups(hooks, "TestEvent")

    expect(groups).toHaveLength(1)
    expect(groups[0]!.type).toBe("sequential")
    expect(groups[0]!.hooks).toHaveLength(3)
  })

  test("all parallel: one group", () => {
    const hooks = [
      makeOrdered("a", true),
      makeOrdered("b", true),
      makeOrdered("c", true),
    ]

    const groups = partitionIntoGroups(hooks, "TestEvent")

    expect(groups).toHaveLength(1)
    expect(groups[0]!.type).toBe("parallel")
    expect(groups[0]!.hooks).toHaveLength(3)
  })

  test("mixed [seq, seq, par, par, seq]: three groups", () => {
    const hooks = [
      makeOrdered("a", false),
      makeOrdered("b", false),
      makeOrdered("c", true),
      makeOrdered("d", true),
      makeOrdered("e", false),
    ]

    const groups = partitionIntoGroups(hooks, "TestEvent")

    expect(groups).toHaveLength(3)
    expect(groups[0]!.type).toBe("sequential")
    expect(groups[0]!.hooks).toHaveLength(2)
    expect(groups[1]!.type).toBe("parallel")
    expect(groups[1]!.hooks).toHaveLength(2)
    expect(groups[2]!.type).toBe("sequential")
    expect(groups[2]!.hooks).toHaveLength(1)
  })

  test("single hook: one group", () => {
    const hooks = [makeOrdered("only", false)]

    const groups = partitionIntoGroups(hooks, "TestEvent")

    expect(groups).toHaveLength(1)
    expect(groups[0]!.type).toBe("sequential")
    expect(groups[0]!.hooks).toHaveLength(1)
  })

  test("single parallel hook between sequential groups: warns to stderr", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {})

    const hooks = [
      makeOrdered("a", false),
      makeOrdered("lonely", true),
      makeOrdered("b", false),
    ]

    const groups = partitionIntoGroups(hooks, "PreToolUse")

    expect(groups).toHaveLength(3)
    expect(groups[0]!.type).toBe("sequential")
    expect(groups[1]!.type).toBe("parallel")
    expect(groups[1]!.hooks).toHaveLength(1)
    expect(groups[2]!.type).toBe("sequential")

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toContain(
      'hook "lonely" is a single parallel hook between sequential hooks in "PreToolUse"',
    )

    spy.mockRestore()
  })

  test("single parallel hook between parallel and sequential: no warning", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {})

    // [par, par, seq] — two groups (parallel, sequential), no sandwich pattern
    const hooks = [
      makeOrdered("a", true),
      makeOrdered("b", true),
      makeOrdered("c", false),
    ]

    const groups = partitionIntoGroups(hooks, "TestEvent")

    expect(groups).toHaveLength(2)
    expect(spy).not.toHaveBeenCalled()

    spy.mockRestore()
  })

  test("single parallel hook adjacent to parallel group: no warning", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {})

    // [par(2), seq(1), par(1), seq(1)] — the par(1) is between seq and seq, triggers warning
    // [seq(1), par(1), par(1), seq(1)] — par group has 2 hooks, no warning
    const hooks = [
      makeOrdered("a", false),
      makeOrdered("b", true),
      makeOrdered("c", true),
      makeOrdered("d", false),
    ]

    const groups = partitionIntoGroups(hooks, "TestEvent")

    expect(groups).toHaveLength(3)
    expect(groups[1]!.type).toBe("parallel")
    expect(groups[1]!.hooks).toHaveLength(2)
    // No warning because parallel group has 2 hooks
    expect(spy).not.toHaveBeenCalled()

    spy.mockRestore()
  })
})
