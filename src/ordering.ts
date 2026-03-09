import type { LoadedHook } from "./loader.js"
import type { HookEntry, EventEntry } from "./config/types.js"
import type { HookName } from "./types/branded.js"

/** A matched hook annotated with its parallel flag from config. */
export interface OrderedHook {
  loaded: LoadedHook
  parallel: boolean
}

/** A contiguous group of hooks that share an execution mode. */
export interface ExecutionGroup {
  type: "sequential" | "parallel"
  hooks: OrderedHook[]
}

/**
 * Orders matched hooks for a given event based on config.
 *
 * Rules:
 * 1. If no order list: hoist parallel hooks to front, sequential after.
 *    Preserve declaration order within each group.
 * 2. If order list exists: ordered hooks go in specified positions,
 *    unordered parallel hooks go at the beginning, unordered sequential
 *    hooks go at the end. Preserve original matched order within unordered groups.
 */
export function orderHooksForEvent(
  matched: LoadedHook[],
  eventEntry: EventEntry | undefined,
  hookEntries: Record<HookName, HookEntry>,
  eventName: string,
): OrderedHook[] {
  if (matched.length === 0) return []

  const orderList = eventEntry?.order

  // Annotate each matched hook with its parallel flag from config
  function annotate(hook: LoadedHook): OrderedHook {
    const entry = hookEntries[hook.name]
    return {
      loaded: hook,
      parallel: entry?.parallel ?? false,
    }
  }

  // No order list: hoist parallel to front, sequential after
  if (!orderList || orderList.length === 0) {
    const parallel: OrderedHook[] = []
    const sequential: OrderedHook[] = []
    for (const hook of matched) {
      const annotated = annotate(hook)
      if (annotated.parallel) {
        parallel.push(annotated)
      } else {
        sequential.push(annotated)
      }
    }
    return [...parallel, ...sequential]
  }

  // Order list exists — validate that every name in order list is in matched set
  const matchedNames = new Set(matched.map((h) => h.name))
  for (const name of orderList) {
    if (!matchedNames.has(name)) {
      throw new Error(
        `clooks: event "${eventName}" order references hook "${name}" which does not handle this event`,
      )
    }
  }

  // Build the ordered list
  const orderedSet = new Set(orderList)

  const unorderedParallel: OrderedHook[] = []
  const unorderedSequential: OrderedHook[] = []

  for (const hook of matched) {
    if (!orderedSet.has(hook.name)) {
      const annotated = annotate(hook)
      if (annotated.parallel) {
        unorderedParallel.push(annotated)
      } else {
        unorderedSequential.push(annotated)
      }
    }
  }

  // Build ordered middle section in the order specified by the order list
  const matchedByName = new Map(matched.map((h) => [h.name, h]))
  const orderedMiddle: OrderedHook[] = orderList.map((name) => {
    const hook = matchedByName.get(name)!
    return annotate(hook)
  })

  return [...unorderedParallel, ...orderedMiddle, ...unorderedSequential]
}

/**
 * Partitions an ordered hook list into contiguous execution groups.
 *
 * Walks the list, starting a new group whenever the parallel flag changes.
 * After partitioning, warns about sandwiched single parallel hooks
 * (sequential-parallel(1)-sequential pattern).
 */
export function partitionIntoGroups(
  orderedHooks: OrderedHook[],
  eventName: string,
): ExecutionGroup[] {
  if (orderedHooks.length === 0) return []

  const groups: ExecutionGroup[] = []
  let currentGroup: ExecutionGroup = {
    type: orderedHooks[0]!.parallel ? "parallel" : "sequential",
    hooks: [orderedHooks[0]!],
  }

  for (let i = 1; i < orderedHooks.length; i++) {
    const hook = orderedHooks[i]!
    const hookType = hook.parallel ? "parallel" : "sequential"

    if (hookType === currentGroup.type) {
      currentGroup.hooks.push(hook)
    } else {
      groups.push(currentGroup)
      currentGroup = { type: hookType, hooks: [hook] }
    }
  }
  groups.push(currentGroup)

  // Check for sandwiched single parallel hooks
  for (let i = 1; i < groups.length - 1; i++) {
    const prev = groups[i - 1]!
    const curr = groups[i]!
    const next = groups[i + 1]!

    if (
      curr.type === "parallel" &&
      curr.hooks.length === 1 &&
      prev.type === "sequential" &&
      next.type === "sequential"
    ) {
      const hookName = curr.hooks[0]!.loaded.name
      console.error(
        `[clooks] Warning: hook "${hookName}" is a single parallel hook between sequential hooks in "${eventName}" order \u2014 functionally equivalent to sequential.`,
      )
    }
  }

  return groups
}
