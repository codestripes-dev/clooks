import { Minimatch } from 'minimatch'
import type { EventName } from '../types/branded.js'
import type { Matcher, MatchLogic } from '../config/schema.js'

/**
 * Normalized event context shape used for matching.
 * Extracted from the normalized payload that the engine builds.
 */
export interface MatchContext {
  event: EventName
  toolName?: string
  toolInput?: Record<string, unknown>
  prompt?: string
}

/**
 * Pre-compiled matcher for efficient repeated evaluation.
 * Regex patterns are compiled once; glob patterns are wrapped in Minimatch.
 */
export interface CompiledMatcher {
  matchLogic: MatchLogic
  command?: RegExp
  tool?: string
  file?: Minimatch
  prompt?: RegExp
}

/**
 * Compiles a Matcher configuration into a CompiledMatcher.
 * Regex patterns are compiled; glob patterns are wrapped in Minimatch.
 * Called once at config load time (or on first use) for efficiency.
 */
export function compileMatcher(matcher: Matcher): CompiledMatcher {
  return {
    matchLogic: matcher.matchLogic ?? 'and',
    command: matcher.command ? new RegExp(matcher.command) : undefined,
    tool: matcher.tool,
    file: matcher.file ? new Minimatch(matcher.file, { dot: true }) : undefined,
    prompt: matcher.prompt ? new RegExp(matcher.prompt) : undefined,
  }
}

/**
 * Extracts the file path from tool input, if present.
 * Handles Write, Edit, Read, Glob tool shapes.
 */
function extractFilePath(toolInput?: Record<string, unknown>): string | undefined {
  if (!toolInput) return undefined
  if (typeof toolInput.filePath === 'string') return toolInput.filePath
  if (typeof toolInput.pattern === 'string') return toolInput.pattern // Glob tool
  return undefined
}

/**
 * Evaluates a single condition against the context.
 * Returns true if the condition matches or if the condition is not specified.
 * Returns false only if the condition is specified and does not match.
 */
function evalCondition(
  compiled: CompiledMatcher,
  context: MatchContext,
): boolean {
  // command condition
  if (compiled.command) {
    const command =
      context.toolName === 'Bash' &&
      typeof context.toolInput?.command === 'string'
        ? context.toolInput.command
        : null
    if (command === null) return false
    if (!compiled.command.test(command)) return false
  }

  // tool condition
  if (compiled.tool) {
    if (context.toolName !== compiled.tool) return false
  }

  // file condition
  if (compiled.file) {
    const filePath = extractFilePath(context.toolInput)
    if (filePath === undefined) return false
    if (!compiled.file.match(filePath)) return false
  }

  // prompt condition
  if (compiled.prompt) {
    if (!context.prompt) return false
    if (!compiled.prompt.test(context.prompt)) return false
  }

  return true
}

/**
 * Tests whether a compiled matcher matches the given event context.
 *
 * Semantics:
 * - matchLogic 'and' (default): all specified conditions must match.
 * - matchLogic 'or': at least one specified condition must match.
 * - Conditions that are not specified are treated as "match" for AND,
 *   and as "no match" for OR (so they don't affect the result).
 */
export function matches(
  compiled: CompiledMatcher,
  context: MatchContext,
): boolean {
  const logic = compiled.matchLogic

  if (logic === 'and') {
    return evalCondition(compiled, context)
  }

  // OR logic: at least one specified condition must match
  const conditions: Array<() => boolean> = []

  if (compiled.command) {
    conditions.push(() => {
      const command =
        context.toolName === 'Bash' &&
        typeof context.toolInput?.command === 'string'
          ? context.toolInput.command
          : null
      return command !== null && compiled.command!.test(command)
    })
  }

  if (compiled.tool) {
    conditions.push(() => context.toolName === compiled.tool)
  }

  if (compiled.file) {
    conditions.push(() => {
      const filePath = extractFilePath(context.toolInput)
      return filePath !== undefined && compiled.file!.match(filePath)
    })
  }

  if (compiled.prompt) {
    conditions.push(() => {
      if (!context.prompt) return false
      return compiled.prompt!.test(context.prompt)
    })
  }

  if (conditions.length === 0) return true // no conditions = match all

  return conditions.some((fn) => fn())
}

/**
 * Cache for compiled matchers to avoid recompiling regex/glob on every invocation.
 */
const compiledCache = new WeakMap<object, CompiledMatcher>()

/**
 * Tests a raw Matcher config against a context, using a cache for efficiency.
 */
export function matchesContext(
  matcher: Matcher,
  context: MatchContext,
): boolean {
  // Use a simple cache key based on the matcher object identity
  // Since matchers come from the config object, they're stable references
  const cacheKey = matcher as unknown as object
  let compiled = compiledCache.get(cacheKey)
  if (!compiled) {
    compiled = compileMatcher(matcher)
    compiledCache.set(cacheKey, compiled)
  }
  return matches(compiled, context)
}
