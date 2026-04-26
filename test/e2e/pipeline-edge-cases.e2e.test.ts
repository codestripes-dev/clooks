import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('pipeline edge cases', () => {
  // =========================================================================
  // Pipeline state mutations
  // =========================================================================

  describe('pipeline state mutations', () => {
    test('1: updatedInput chaining across 3 sequential hooks — each sees prior mutation', () => {
      sandbox = createSandbox()

      // Hook A adds field_a to toolInput
      sandbox.writeHook(
        'chain-a.ts',
        `
export const hook = {
  meta: { name: "chain-a" },
  PreToolUse(ctx: Record<string, unknown>) {
    const toolInput = ctx.toolInput as Record<string, unknown>
    return {
      result: "allow" as const,
      updatedInput: { ...toolInput, field_a: "from-a" },
    }
  },
}
`,
      )
      // Hook B adds field_b, should see field_a from hook A
      sandbox.writeHook(
        'chain-b.ts',
        `
export const hook = {
  meta: { name: "chain-b" },
  PreToolUse(ctx: Record<string, unknown>) {
    const toolInput = ctx.toolInput as Record<string, unknown>
    return {
      result: "allow" as const,
      updatedInput: { ...toolInput, field_b: "from-b" },
      injectContext: "chain-b saw field_a=" + String(toolInput.field_a),
    }
  },
}
`,
      )
      // Hook C adds field_c, should see both field_a and field_b
      sandbox.writeHook(
        'chain-c.ts',
        `
export const hook = {
  meta: { name: "chain-c" },
  PreToolUse(ctx: Record<string, unknown>) {
    const toolInput = ctx.toolInput as Record<string, unknown>
    return {
      result: "allow" as const,
      updatedInput: { ...toolInput, field_c: "from-c" },
      injectContext: "chain-c saw field_a=" + String(toolInput.field_a) + " field_b=" + String(toolInput.field_b),
    }
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
chain-a: {}
chain-b: {}
chain-c: {}
PreToolUse:
  order: [chain-a, chain-b, chain-c]
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
      // Verify updatedInput has all three fields
      expect(output.hookSpecificOutput.updatedInput.field_a).toBe('from-a')
      expect(output.hookSpecificOutput.updatedInput.field_b).toBe('from-b')
      expect(output.hookSpecificOutput.updatedInput.field_c).toBe('from-c')
      // Verify chaining: hook B saw field_a, hook C saw both
      const ctx = output.hookSpecificOutput.additionalContext
      expect(ctx).toContain('chain-b saw field_a=from-a')
      expect(ctx).toContain('chain-c saw field_a=from-a field_b=from-b')
    })

    test('2: updatedInput survives a subsequent skip', () => {
      sandbox = createSandbox()

      sandbox.writeHook(
        'mutate-input.ts',
        `
export const hook = {
  meta: { name: "mutate-input" },
  PreToolUse(ctx: Record<string, unknown>) {
    const toolInput = ctx.toolInput as Record<string, unknown>
    return {
      result: "allow" as const,
      updatedInput: { ...toolInput, added: "mutated" },
    }
  },
}
`,
      )
      sandbox.writeHook(
        'skipper.ts',
        `
export const hook = {
  meta: { name: "skipper" },
  PreToolUse() {
    return { result: "skip" as const }
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
mutate-input: {}
skipper: {}
PreToolUse:
  order: [mutate-input, skipper]
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
      // updatedInput from mutate-input should survive despite skipper returning skip
      expect(output.hookSpecificOutput.updatedInput.added).toBe('mutated')
    })

    test('3: updatedInput as non-object (string) is spread by patch-merge (not validated)', () => {
      sandbox = createSandbox()

      sandbox.writeHook(
        'string-input.ts',
        `
export const hook = {
  meta: { name: "string-input" },
  PreToolUse() {
    return {
      result: "allow" as const,
      updatedInput: "not-an-object" as any,
    }
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
string-input: {}
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      // The engine does not validate the type of `updatedInput`. Spreading a
      // string primitive yields character-indexed keys; the original base keys
      // still merge through.
      expect(output.hookSpecificOutput.updatedInput).toBeDefined()
      expect(typeof output.hookSpecificOutput.updatedInput).toBe('object')
      expect(output.hookSpecificOutput.updatedInput.command).toBe('ls -la')
    })

    test('4: contract violation in parallel group prevents subsequent sequential group', () => {
      sandbox = createSandbox()

      // Parallel hook returning updatedInput — contract violation
      sandbox.writeHook(
        'parallel-mutate.ts',
        `
export const hook = {
  meta: { name: "parallel-mutate" },
  PreToolUse(ctx: Record<string, unknown>) {
    const toolInput = ctx.toolInput as Record<string, unknown>
    return {
      result: "allow" as const,
      updatedInput: { ...toolInput, bad: true },
    }
  },
}
`,
      )
      // Sequential hook in a later group — should NOT execute due to pipeline block
      sandbox.writeHook(
        'sidecar-writer.ts',
        `
import { writeFileSync } from "fs"
export const hook = {
  meta: { name: "sidecar-writer" },
  PreToolUse(ctx: Record<string, unknown>) {
    // Write a sidecar file to prove this hook ran
    const cwd = process.cwd()
    writeFileSync(cwd + "/sidecar-written.txt", "ran")
    return { result: "allow" as const }
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
parallel-mutate:
  parallel: true
sidecar-writer: {}
PreToolUse:
  order: [parallel-mutate, sidecar-writer]
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      // Contract violation triggers block
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(output.systemMessage).toContain('contract violation')
      // Sequential hook should not have run
      expect(sandbox.fileExists('sidecar-written.txt')).toBe(false)
    })
  })

  // =========================================================================
  // Parallel execution
  // =========================================================================

  describe('parallel execution', () => {
    test('5: all parallel hooks crash with onError:block — block result surfaces', () => {
      sandbox = createSandbox()

      sandbox.writeHook(
        'crash-p1.ts',
        `
export const hook = {
  meta: { name: "crash-p1" },
  PreToolUse() { throw new Error("crash p1") },
}
`,
      )
      sandbox.writeHook(
        'crash-p2.ts',
        `
export const hook = {
  meta: { name: "crash-p2" },
  PreToolUse() { throw new Error("crash p2") },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
crash-p1:
  parallel: true
  onError: block
crash-p2:
  parallel: true
  onError: block
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
      // At least one crash diagnostic is in the reason
      const reason = output.hookSpecificOutput.permissionDecisionReason
      expect(reason).toMatch(/crash-p[12]/)
    })

    test('6: parallel group — one hook crashes (onError:block), sibling injectContext survives in block result', () => {
      sandbox = createSandbox()

      sandbox.writeHook(
        'ctx-parallel.ts',
        `
export const hook = {
  meta: { name: "ctx-parallel" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "parallel context survived" }
  },
}
`,
      )
      sandbox.writeHook(
        'crash-parallel.ts',
        `
export const hook = {
  meta: { name: "crash-parallel" },
  PreToolUse() { throw new Error("parallel crash") },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
ctx-parallel:
  parallel: true
crash-parallel:
  parallel: true
  onError: block
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
      // Crash path short-circuits and emits deny (Decision D-2026-04-19-05).
      // The sibling's injectContext is accumulated into accumulatedInjectContext before
      // the crash block fires (D-2026-04-19-10: outer push is unconditional/authoritative
      // on crash path). The crash-path block result is then merged with the accumulated
      // context (injectContext = accumulatedInjectContext.join) and the M2 translator
      // emits it as additionalContext on the wire:
      expect(output.hookSpecificOutput.additionalContext).toBe('parallel context survived')
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain('crash-parallel')
    })

    test('7: parallel skip + parallel block — block wins cleanly', () => {
      sandbox = createSandbox()

      sandbox.writeHook(
        'skip-parallel.ts',
        `
export const hook = {
  meta: { name: "skip-parallel" },
  PreToolUse() {
    return { result: "skip" as const }
  },
}
`,
      )
      sandbox.writeHook(
        'block-parallel.ts',
        `
export const hook = {
  meta: { name: "block-parallel" },
  PreToolUse() {
    return { result: "block" as const, reason: "parallel block wins" }
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
skip-parallel:
  parallel: true
block-parallel:
  parallel: true
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain('parallel block wins')
    })

    test('8: slow parallel hook abandoned after sibling crashes (onError:block) triggers short-circuit — block result returned promptly', () => {
      sandbox = createSandbox()

      // Slow hook that respects the AbortSignal passed via context.signal.
      // The engine aborts the controller on short-circuit, which causes the
      // signal listener to resolve (or the hook to check signal.aborted).
      // However, if the hook ignores the signal, the process still waits
      // for the promise to settle or the hook's timeout to fire.
      // We use a hook that checks signal to demonstrate the intended pattern.
      sandbox.writeHook(
        'slow-parallel.ts',
        `
export const hook = {
  meta: { name: "slow-parallel" },
  async PreToolUse(ctx: Record<string, unknown>) {
    const signal = ctx.signal as AbortSignal
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 10000)
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve() })
    })
    return { result: "allow" as const, injectContext: "slow hook finished" }
  },
}
`,
      )
      // Fast hook that CRASHES immediately with onError: block.
      // Under M3, structured block no longer short-circuits for PreToolUse (D-2026-04-19-04),
      // but a crash under onError:block DOES still short-circuit for all events including
      // PreToolUse (D-2026-04-19-05). This keeps the test demonstrating signal-aware
      // abandonment via the crash-path short-circuit.
      sandbox.writeHook(
        'fast-crash.ts',
        `
export const hook = {
  meta: { name: "fast-crash" },
  PreToolUse() {
    throw new Error("fast crash")
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
slow-parallel:
  parallel: true
fast-crash:
  parallel: true
  onError: block
`)
      const startMs = Date.now()
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json'), timeout: 15000 })
      const elapsedMs = Date.now() - startMs
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(output.hookSpecificOutput.permissionDecisionReason).toMatch(/fast-crash/)
      // With signal-aware hook, should complete well before the 10s delay.
      // Allow generous margin for subprocess startup overhead.
      expect(elapsedMs).toBeLessThan(5000)
    })
  })

  // =========================================================================
  // Ordering
  // =========================================================================

  describe('ordering', () => {
    test('9: order list references hook that does not handle triggered event — runtime throw, exit 2', () => {
      sandbox = createSandbox()

      // Hook that only handles PostToolUse, NOT PreToolUse
      sandbox.writeHook(
        'post-only.ts',
        `
export const hook = {
  meta: { name: "post-only" },
  PostToolUse() { return { result: "skip" as const } },
}
`,
      )
      sandbox.writeHook(
        'allow-pre.ts',
        `
export const hook = {
  meta: { name: "allow-pre" },
  PreToolUse() { return { result: "allow" as const } },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
post-only: {}
allow-pre: {}
PreToolUse:
  order: [post-only, allow-pre]
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      // orderHooksForEvent throws, engine catches it as fatal error → exit 2
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('post-only')
      expect(result.stderr).toContain('does not handle this event')
    })

    test('10: single-hook order list — normal execution, no partition warning', () => {
      sandbox = createSandbox()

      sandbox.writeHook(
        'solo.ts',
        `
export const hook = {
  meta: { name: "solo" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "solo ran" }
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
solo: {}
PreToolUse:
  order: [solo]
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
      expect(output.hookSpecificOutput.additionalContext).toContain('solo ran')
      // No sandwich warning in stderr
      expect(result.stderr).not.toContain('Warning')
    })

    test('11: all hooks in order list are parallel — single parallel group', () => {
      sandbox = createSandbox()

      sandbox.writeHook(
        'par-a.ts',
        `
export const hook = {
  meta: { name: "par-a" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "par-a ran" }
  },
}
`,
      )
      sandbox.writeHook(
        'par-b.ts',
        `
export const hook = {
  meta: { name: "par-b" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "par-b ran" }
  },
}
`,
      )
      sandbox.writeHook(
        'par-c.ts',
        `
export const hook = {
  meta: { name: "par-c" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "par-c ran" }
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
par-a:
  parallel: true
par-b:
  parallel: true
par-c:
  parallel: true
PreToolUse:
  order: [par-a, par-b, par-c]
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
      const ctx = output.hookSpecificOutput.additionalContext
      expect(ctx).toContain('par-a ran')
      expect(ctx).toContain('par-b ran')
      expect(ctx).toContain('par-c ran')
    })

    test('12: unordered parallel hooks hoist to front, ordered sequential in middle, unordered sequential at end', () => {
      sandbox = createSandbox()

      // Unordered parallel hook — should hoist to front
      sandbox.writeHook(
        'unord-par.ts',
        `
export const hook = {
  meta: { name: "unord-par" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "unord-par ran" }
  },
}
`,
      )
      // Ordered sequential hook — in the order list
      sandbox.writeHook(
        'ord-seq.ts',
        `
export const hook = {
  meta: { name: "ord-seq" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "ord-seq ran" }
  },
}
`,
      )
      // Unordered sequential hook — should go to end
      sandbox.writeHook(
        'unord-seq.ts',
        `
export const hook = {
  meta: { name: "unord-seq" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "unord-seq ran" }
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
unord-par:
  parallel: true
ord-seq: {}
unord-seq: {}
PreToolUse:
  order: [ord-seq]
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      const ctx = output.hookSpecificOutput.additionalContext
      expect(ctx).toContain('unord-par ran')
      expect(ctx).toContain('ord-seq ran')
      expect(ctx).toContain('unord-seq ran')
      // Verify ordering: unord-par (front) → ord-seq (middle) → unord-seq (end)
      const idxUnordPar = ctx.indexOf('unord-par ran')
      const idxOrdSeq = ctx.indexOf('ord-seq ran')
      const idxUnordSeq = ctx.indexOf('unord-seq ran')
      expect(idxUnordPar).toBeLessThan(idxOrdSeq)
      expect(idxOrdSeq).toBeLessThan(idxUnordSeq)
    })
  })

  // =========================================================================
  // Lifecycle interactions
  // =========================================================================

  describe('lifecycle interactions', () => {
    test('13: sequential chain — beforeHook blocks hook A, hook B still runs', () => {
      sandbox = createSandbox()

      // Hook A has beforeHook that blocks — handler never runs
      sandbox.writeHook(
        'before-block-a.ts',
        `
import { writeFileSync } from "fs"
export const hook = {
  meta: { name: "before-block-a" },
  beforeHook(event: any) {
    return event.block({ reason: "before blocked A" })
  },
  PreToolUse() {
    // Should NOT execute — beforeHook short-circuits
    writeFileSync(process.cwd() + "/hook-a-ran.txt", "ran")
    return { result: "allow" as const }
  },
}
`,
      )
      // Hook B runs normally after A's block
      sandbox.writeHook(
        'normal-b.ts',
        `
import { writeFileSync } from "fs"
export const hook = {
  meta: { name: "normal-b" },
  PreToolUse() {
    writeFileSync(process.cwd() + "/hook-b-ran.txt", "ran")
    return { result: "allow" as const, injectContext: "hook-b executed" }
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
before-block-a: {}
normal-b: {}
PreToolUse:
  order: [before-block-a, normal-b]
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      // beforeHook block is treated as a structured deny vote (rank 3) in the M3 reducer.
      // Hook B's allow vote (rank 0) loses — deny wins via precedence.
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain('before blocked A')
      // Hook A's handler should NOT have run (beforeHook still short-circuits hook A's handler)
      expect(sandbox.fileExists('hook-a-ran.txt')).toBe(false)
      // Under M3, the sequential pipeline continues after hook A's deny vote — hook B runs
      expect(sandbox.fileExists('hook-b-ran.txt')).toBe(true)
      // Hook B's allow-loser injectContext is accumulated into the deny winner per M3 D2 rules,
      // and emitted as additionalContext by the M2 translator:
      expect(output.hookSpecificOutput.additionalContext).toContain('hook-b executed')
    })

    test('15: afterHook throws in parallel group with onError:continue — crash swallowed, sibling result used', () => {
      sandbox = createSandbox()

      sandbox.writeHook(
        'after-crash.ts',
        `
export const hook = {
  meta: { name: "after-crash" },
  afterHook() {
    throw new Error("afterHook exploded")
  },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`,
      )
      sandbox.writeHook(
        'sibling-ctx.ts',
        `
export const hook = {
  meta: { name: "sibling-ctx" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "sibling survived" }
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
after-crash:
  parallel: true
  onError: continue
sibling-ctx:
  parallel: true
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
      expect(output.hookSpecificOutput.additionalContext).toContain('sibling survived')
      // Crash diagnostic surfaced via systemMessage
      expect(output.systemMessage).toContain('after-crash')
      expect(output.systemMessage).toContain('Continuing')
    })

    test('16: timeout fires during beforeHook phase — still blocked', () => {
      sandbox = createSandbox()

      sandbox.writeHook(
        'before-hang.ts',
        `
export const hook = {
  meta: { name: "before-hang" },
  async beforeHook() {
    // Hang forever in beforeHook
    await new Promise(() => {})
  },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
before-hang:
  timeout: 500
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json'), timeout: 10000 })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      // Timeout triggers fail-closed (default onError: block)
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain('timed out')
    })
  })

  // =========================================================================
  // Degenerate cases
  // =========================================================================

  describe('degenerate cases', () => {
    test('17: all hooks return skip on guard event — action proceeds (exit 0, no output)', () => {
      sandbox = createSandbox()

      sandbox.writeHook(
        'skip-a.ts',
        `
export const hook = {
  meta: { name: "skip-a" },
  PreToolUse() { return { result: "skip" as const } },
}
`,
      )
      sandbox.writeHook(
        'skip-b.ts',
        `
export const hook = {
  meta: { name: "skip-b" },
  PreToolUse() { return { result: "skip" as const } },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
skip-a: {}
skip-b: {}
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      // No output — all hooks skipped
      expect(result.stdout.trim()).toBe('')
    })

    test('18: all hooks return null/undefined — same as all-skip', () => {
      sandbox = createSandbox()

      sandbox.writeHook(
        'null-a.ts',
        `
export const hook = {
  meta: { name: "null-a" },
  PreToolUse() { return null },
}
`,
      )
      sandbox.writeHook(
        'undef-b.ts',
        `
export const hook = {
  meta: { name: "undef-b" },
  PreToolUse() { return undefined },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
null-a: {}
undef-b: {}
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      // No output — null/undefined treated as skip
      expect(result.stdout.trim()).toBe('')
    })

    test('19: injectContext from two parallel groups — both accumulated in final output', () => {
      sandbox = createSandbox()

      // Group 1: parallel hooks
      sandbox.writeHook(
        'par-g1a.ts',
        `
export const hook = {
  meta: { name: "par-g1a" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "group1-a" }
  },
}
`,
      )
      sandbox.writeHook(
        'par-g1b.ts',
        `
export const hook = {
  meta: { name: "par-g1b" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "group1-b" }
  },
}
`,
      )
      // Sequential separator
      sandbox.writeHook(
        'seq-mid.ts',
        `
export const hook = {
  meta: { name: "seq-mid" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "seq-middle" }
  },
}
`,
      )
      // Group 2: parallel hooks
      sandbox.writeHook(
        'par-g2a.ts',
        `
export const hook = {
  meta: { name: "par-g2a" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "group2-a" }
  },
}
`,
      )
      sandbox.writeHook(
        'par-g2b.ts',
        `
export const hook = {
  meta: { name: "par-g2b" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "group2-b" }
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
par-g1a:
  parallel: true
par-g1b:
  parallel: true
seq-mid: {}
par-g2a:
  parallel: true
par-g2b:
  parallel: true
PreToolUse:
  order: [par-g1a, par-g1b, seq-mid, par-g2a, par-g2b]
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      const ctx = output.hookSpecificOutput.additionalContext
      expect(ctx).toContain('group1-a')
      expect(ctx).toContain('group1-b')
      expect(ctx).toContain('seq-middle')
      expect(ctx).toContain('group2-a')
      expect(ctx).toContain('group2-b')
      // Verify ordering: group 1 contexts before seq-middle before group 2 contexts
      const idxG1a = ctx.indexOf('group1-a')
      const idxG1b = ctx.indexOf('group1-b')
      const idxMid = ctx.indexOf('seq-middle')
      const idxG2a = ctx.indexOf('group2-a')
      const idxG2b = ctx.indexOf('group2-b')
      expect(Math.max(idxG1a, idxG1b)).toBeLessThan(idxMid)
      expect(idxMid).toBeLessThan(Math.min(idxG2a, idxG2b))
    })

    test('20: injectContext + onError:trace in same pipeline — both appear in additionalContext', () => {
      sandbox = createSandbox()

      // Hook that injects context normally
      sandbox.writeHook(
        'ctx-hook.ts',
        `
export const hook = {
  meta: { name: "ctx-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "normal context" }
  },
}
`,
      )
      // Hook that crashes with onError:trace
      sandbox.writeHook(
        'trace-crash.ts',
        `
export const hook = {
  meta: { name: "trace-crash" },
  PreToolUse() {
    throw new Error("trace crash error")
  },
}
`,
      )
      sandbox.writeConfig(`
version: "1.0.0"
ctx-hook: {}
trace-crash:
  onError: trace
PreToolUse:
  order: [ctx-hook, trace-crash]
`)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
      const ctx = output.hookSpecificOutput.additionalContext
      // Both normal context and trace message should appear
      expect(ctx).toContain('normal context')
      expect(ctx).toContain('trace-crash')
      expect(ctx).toContain('trace')
    })
  })
})
