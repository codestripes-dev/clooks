import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloneDeep } from 'lodash-es'
import { hn, ms } from '../../test-utils.js'
import type { ClooksConfig } from '../../config/schema.js'
import type { LoadedHook } from '../../loader.js'
import type { AcceptedPreToolUseVote, ExecutionResult } from '../../engine/types.js'
import { ApprovalStore } from './approval-store.js'
import { codexAdapter } from './adapter.js'
import { jsonRecord } from './tool-codecs.js'
import {
  canonicalHash,
  inlineEligible,
  prepareApprovalAttempt,
  captureApprovalPipeline,
  resolveApprovals,
  validateApprovalOutput,
  type ApprovalPipeline,
} from './approvals.js'

let root: string
let store: ApprovalStore
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clooks-controller-'))
  store = new ApprovalStore(root)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function raw(overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 's',
    cwd: '/project',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf scratch' },
    turn_id: 't',
    tool_use_id: 'id',
    model: 'm',
    permission_mode: 'default',
    ...overrides,
  }
}
function vote(name: string, ordinal: number, reason = name): AcceptedPreToolUseVote {
  return {
    engineResult: { result: 'ask', reason },
    rank: 1,
    hookName: hn(name),
    origin: 'handler',
    ordinal,
    inputBefore: { command: 'rm -rf scratch' },
    inputAfter: { command: 'rm -rf scratch' },
  }
}
function execution(votes = [vote('a', 0), vote('b', 1)]): ExecutionResult {
  return {
    lastResult: cloneDeep(votes.at(-1)?.engineResult),
    preToolUse: { votes, approvals: [], completed: true, inputChanged: false },
    debugMessages: [],
    systemMessages: [],
    traceMessages: [],
    degradedMessages: [],
  }
}
const pipeline: ApprovalPipeline = {
  global: {
    timeout: ms(1000),
    onError: 'block',
    maxFailures: 3,
    maxFailuresMessage: 'failed',
    handoff: false,
  },
  event: null,
  hooks: [],
}
function resolve(ex = execution(), input: Record<string, unknown> = raw(), identity = pipeline) {
  const attempt = prepareApprovalAttempt(input)
  const invocation = codexAdapter.normalizeInvocation(attempt.payload, 'PreToolUse')
  return resolveApprovals(attempt, invocation, ex, identity, store)
}
function token(result: ReturnType<typeof resolve>): string {
  const found = /ca1_[a-f0-9]{64}/.exec(result.result?.reason ?? '')?.[0]
  expect(found).toBeDefined()
  return found!
}

describe('approval binding and carrier', () => {
  test('canonical JSON preserves opaque own keys, exact bytes and array order', () => {
    const a = JSON.parse('{"__proto__":{"z":1,"a":2},"constructor":" x ","v":[1,2]}')
    const b = JSON.parse('{"v":[1,2],"constructor":" x ","__proto__":{"a":2,"z":1}}')
    expect(canonicalHash(a)).toBe(canonicalHash(b))
    for (const changed of [
      { ...a, v: [2, 1] },
      { ...a, constructor: 'x' },
      { v: [1, 2], constructor: ' x ' },
    ])
      expect(canonicalHash(changed)).not.toBe(canonicalHash(a))
    for (const bad of [undefined, NaN, () => 1, { x: undefined }, new Date(), new Array(2)])
      expect(() => canonicalHash(bad)).toThrow('lossless JSON')
  })
  test('base excludes only transient IDs and unrelated envelope metadata', () => {
    const base = prepareApprovalAttempt(raw()).baseInvocationHash
    expect(
      prepareApprovalAttempt(raw({ turn_id: 'next', tool_use_id: 'next', model: 'other' }))
        .baseInvocationHash,
    ).toBe(base)
    for (const override of [
      { session_id: 'other' },
      { cwd: '/other' },
      { tool_name: 'exec_command' },
      { agent_id: 'child' },
      { tool_input: { command: 'rm -rf other' } },
    ])
      expect(prepareApprovalAttempt(raw(override)).baseInvocationHash).not.toBe(base)
    const minimal = {
      hook_event_name: 'PreToolUse',
      session_id: 's',
      cwd: '/project',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf scratch' },
    }
    expect(prepareApprovalAttempt(minimal).baseInvocationHash).toBe(base)
    for (const input of [
      null,
      [],
      'bad',
      {},
      raw({ hook_event_name: 'Stop' }),
      raw({ agent_id: null }),
      raw({ cwd: '' }),
      raw({ tool_input: [] }),
    ])
      expect(() => prepareApprovalAttempt(input)).toThrow()
  })
  test.each([
    'rm -rf scratch',
    "rm -rf './scratch dir'",
    'clooks approve ca1_abc',
    '/bin/echo "literal arg"',
    'ls\t-a  ',
    './command',
  ])('accepts direct literal command %s', (command) => expect(inlineEligible(command)).toBe(true))
  test.each([
    'cd x && rm y',
    'echo x',
    'command rm x',
    'if true',
    'rm x\ny',
    'rm x>y',
    'rm $x',
    'rm `x`',
    'rm \\x',
    'rm *',
    'rm "x$y"',
    'rm a"b"',
    ' rm x',
    "rm 'unterminated",
    'rm # comment',
    'rm (x)',
    'FOO=x rm y',
  ])('rejects uncertain shell %s', (command) => expect(inlineEligible(command)).toBe(false))
  test('strips only recognized carrier for inspection; retains original native prefix separately', () => {
    const id = `ca1_${'a'.repeat(64)}`
    const input = raw({
      tool_input: { command: `CLOOKS_APPROVAL_TOKENS=${id},${id} rm -rf scratch` },
    })
    const attempt = prepareApprovalAttempt(input)
    expect(attempt.presentedTokens).toEqual([id, id])
    expect(attempt.originalInput).toEqual({ command: 'rm -rf scratch' })
    expect(attempt.nativeInput).toEqual(input.tool_input)
    const invocation = codexAdapter.normalizeInvocation(attempt.payload, 'PreToolUse')
    expect(invocation.private.raw.tool_input).toEqual(attempt.originalInput)
    expect(invocation.context.toolInput).toEqual(attempt.originalInput)
    expect(attempt.baseInvocationHash).toBe(prepareApprovalAttempt(raw()).baseInvocationHash)
    for (const command of [
      'CLOOKS_APPROVAL_TOKENS=',
      'CLOOKS_APPROVAL_TOKENS=bad rm x',
      `CLOOKS_APPROVAL_TOKENS=${id} cd x`,
      `CLOOKS_APPROVAL_TOKENS=${Array(65).fill(id).join(',')} rm x`,
    ])
      expect(() => prepareApprovalAttempt(raw({ tool_input: { command } }))).toThrow()
    expect(
      prepareApprovalAttempt(
        raw({
          tool_name: 'mcp__s__t',
          tool_input: { command: `CLOOKS_APPROVAL_TOKENS=${id} rm x` },
        }),
      ).presentedTokens,
    ).toEqual([])
  })
  test('captures effective ordered aliases, entry bytes, loaded config and hook event overrides', async () => {
    const config: ClooksConfig = { version: '1', global: pipeline.global, events: {}, hooks: {} }
    const hooks: LoadedHook[] = ['a', 'b'].map((name) => {
      const hookPath = join(root, name + '.ts')
      writeFileSync(hookPath, name)
      config.hooks[hn(name)] = {
        config: {},
        resolvedPath: hookPath,
        origin: 'project',
        parallel: name === 'b',
        events: { PreToolUse: { onError: 'trace' } },
      }
      return {
        name: hn(name),
        hook: { meta: { name: 'not-the-alias' } } as LoadedHook['hook'],
        config: { default: 1 },
        hookPath,
        configPath: join(root, 'clooks.yml'),
      }
    })
    const identity = await captureApprovalPipeline(hooks, config)
    expect(identity.hooks.map((h) => String(h.hookName))).toEqual(['b', 'a'])
    expect(identity.hooks[0]!.entry).toMatchObject({ events: { PreToolUse: { onError: 'trace' } } })
    hooks[0]!.config.default = 2
    expect(identity.hooks[1]!.config).toEqual({ default: 1 })
    expect(canonicalHash(await captureApprovalPipeline(hooks, config))).not.toBe(
      canonicalHash(identity),
    )
    writeFileSync(hooks[0]!.hookPath, 'changed bytes')
    expect((await captureApprovalPipeline(hooks, config)).hooks[1]!.entryHash).not.toBe(
      identity.hooks[1]!.entryHash,
    )
    rmSync(hooks[0]!.hookPath)
    await expect(captureApprovalPipeline(hooks, config)).rejects.toThrow()
  })
})

describe('approval resolution', () => {
  test('alias alone changes confirmation identity with ordinal/result/input/pipeline fixed', () => {
    const ex = execution([vote('a', 0, 'same reason')])
    const id = token(resolve(ex))
    store.acknowledge(id)
    ex.preToolUse!.votes[0]!.hookName = hn('alias-only-change')
    expect(token(resolve(ex))).not.toBe(id)
    expect(resolve(ex).result?.reason).toContain('alias-only-change')
  })
  test('two confirmations reuse tokens, mix transports, retain reducer fields and consume once', () => {
    const ex = execution()
    ex.lastResult = {
      result: 'ask',
      reason: 'b',
      injectContext: 'winner only',
      debugMessage: 'debug',
    }
    const a = token(resolve(ex))
    expect(token(resolve(ex))).toBe(a)
    const inline = raw({ tool_input: { command: `CLOOKS_APPROVAL_TOKENS=${a} rm -rf scratch` } })
    const b = token(resolve(ex, inline))
    expect(b).not.toBe(a)
    store.acknowledge(b)
    const allowed = resolve(ex)
    expect(allowed.result).toEqual({ ...ex.lastResult, result: 'allow' })
    expect(ex.lastResult.result).toBe('ask')
    expect(allowed.permit?.requiredTokens).toHaveLength(2)
    const attempt = prepareApprovalAttempt(inline)
    const output = codexAdapter.translateFinalOutput({
      eventName: 'PreToolUse',
      invocation: codexAdapter.normalizeInvocation(attempt.payload, 'PreToolUse'),
      result: allowed.result,
      systemMessages: [],
      diagnostics: [],
    })
    expect(output.output).not.toContain('updatedInput')
    validateApprovalOutput(attempt, allowed.permit!, output)
    store.finalizePermit(
      allowed.permit!.baseInvocationHash,
      allowed.permit!.expectedDecisionHash,
      allowed.permit!.requiredTokens,
    )
    expect(() =>
      store.finalizePermit(
        allowed.permit!.baseInvocationHash,
        allowed.permit!.expectedDecisionHash,
        allowed.permit!.requiredTokens,
      ),
    ).toThrow()
  })
  test.each(['', '  ', 'reason'])(
    'exact reason %j binds without trimming and has display-only fallback',
    (reason) => {
      const ex = execution([vote('a', 0, reason)])
      const pending = resolve(ex)
      if (!reason.trim()) expect(pending.result?.reason).toContain('requests confirmation')
      const id = token(pending)
      store.acknowledge(id)
      expect(resolve(ex).result?.reason).toBe(reason)
      ex.preToolUse!.votes[0]!.engineResult.reason = reason + ' '
      ex.lastResult!.reason = reason + ' '
      expect(token(resolve(ex))).not.toBe(id)
    },
  )
  test('changing B confirmation does not invalidate independently acknowledged A', () => {
    const ex = execution()
    const a = token(resolve(ex))
    store.acknowledge(a)
    const b = token(resolve(ex))
    ex.preToolUse!.votes[1]!.engineResult.reason = 'changed B'
    ex.lastResult!.reason = 'changed B'
    const changed = resolve(ex)
    expect(changed.result?.reason).toContain('Hook "b"')
    expect(token(changed)).not.toBe(b)
    store.acknowledge(token(changed))
    expect(resolve(ex).permit?.requiredTokens.some((entry) => entry.token === a)).toBe(true)
  })
  test('binds emitted input, not losing ask materialization', () => {
    const ex = execution()
    ex.preToolUse!.votes[0]!.engineResult.updatedInput = { command: 'rewritten' }
    ex.preToolUse!.votes[0]!.inputAfter = { command: 'rewritten' }
    ex.preToolUse!.votes[1]!.inputBefore = { command: 'rewritten' }
    ex.preToolUse!.votes[1]!.inputAfter = { command: 'rewritten' }
    ex.preToolUse!.inputChanged = true
    ex.preToolUse!.finalToolInput = { command: 'rewritten' }
    store.acknowledge(token(resolve(ex)))
    store.acknowledge(token(resolve(ex)))
    const allowed = resolve(ex)
    expect(allowed.result).not.toHaveProperty('updatedInput')
    expect(allowed.permit!.expectedInputHash).toBe(canonicalHash({ command: 'rm -rf scratch' }))
    ex.lastResult!.updatedInput = { command: 'rewritten' }
    expect(resolve(ex).result?.result).toBe('block')
    store.acknowledge(token(resolve(ex)))
    store.acknowledge(token(resolve(ex)))
    expect(resolve(ex).permit!.expectedInputHash).toBe(canonicalHash({ command: 'rewritten' }))
  })
  test('mode, current pipeline, entry config and observed input changes require reapproval', () => {
    const ex = execution([vote('a', 0)])
    const id = token(resolve(ex))
    store.acknowledge(id)
    expect(resolve(ex).permit).toBeDefined()
    expect(token(resolve(ex, raw({ permission_mode: 'other' })))).not.toBe(id)
    expect(
      token(resolve(ex, raw(), { ...pipeline, global: { ...pipeline.global, timeout: ms(2) } })),
    ).not.toBe(id)
    ex.preToolUse!.votes[0]!.inputAfter = { command: 'other' }
    expect(token(resolve(ex))).not.toBe(id)
  })
  test('blocks and policy failures preserve output without store access; incomplete asks refuse', () => {
    const ex = execution()
    ex.lastResult = { result: 'block', reason: 'explicit' }
    expect(resolve(ex)).toEqual({ result: ex.lastResult })
    ex.lastResult = { result: 'ask', reason: 'a' }
    ex.policyFailure = { eventName: 'PreToolUse', capability: 'test', message: 'failed' }
    expect(resolve(ex)).toEqual({ result: ex.lastResult })
    delete ex.policyFailure
    ex.preToolUse!.completed = false
    expect(() => resolve(ex)).toThrow('Incomplete')
    delete ex.preToolUse
    expect(() => resolve(ex)).toThrow('Incomplete')
    ex.preToolUse = { votes: [], approvals: [], completed: true, inputChanged: false }
    expect(() => resolve(ex)).toThrow('Missing accepted')
    expect(store.exists()).toBe(false)
  })
  test('no-ask carrier rejects stale tokens, no-result succeeds, missing codec refuses', () => {
    expect(resolve(execution([])).result).toBeUndefined()
    const id = token(resolve())
    expect(() =>
      resolve(
        execution([]),
        raw({ tool_input: { command: `CLOOKS_APPROVAL_TOKENS=${id} rm -rf scratch` } }),
      ),
    ).toThrow('does not match')
    const ex = execution([vote('a', 0)])
    ex.lastResult!.updatedInput = { filePath: '/new' }
    expect(() =>
      resolve(ex, raw({ tool_name: 'write_stdin', tool_input: { session_id: 123 } })),
    ).toThrow('codec')
  })
  test.each(['update_plan', 'localtools.inspect', 'spawn_agent'])(
    '%s approval binds the encoded full candidate and invalidates changed rewrites',
    (tool_name) => {
      const tool_input = { keep_null: null, opaque_key: [{ snake_key: 'original' }] }
      const input = { ...raw(), tool_name, tool_input }
      const attempt = prepareApprovalAttempt(input)
      const invocation = codexAdapter.normalizeInvocation(attempt.payload, 'PreToolUse')
      const candidate = invocation.private.tool!.applyPatch(tool_input, { added_key: [false] })
      const ex = execution([
        {
          ...vote('a', 0),
          engineResult: { result: 'ask', reason: 'confirm', updatedInput: candidate },
          inputBefore: tool_input,
          inputAfter: candidate,
        },
      ])
      ex.preToolUse!.inputChanged = true
      ex.preToolUse!.finalToolInput = candidate
      const id = token(resolve(ex, input))
      store.acknowledge(id)
      const allowed = resolve(ex, input)
      expect(allowed.permit!.expectedInputHash).toBe(canonicalHash(candidate))
      const output = codexAdapter.translateFinalOutput({
        eventName: 'PreToolUse',
        invocation,
        result: allowed.result,
        systemMessages: [],
        diagnostics: [],
      })
      expect(JSON.parse(output.output!).hookSpecificOutput.updatedInput).toEqual(candidate)
      validateApprovalOutput(attempt, allowed.permit!, output)
      expect(() =>
        validateApprovalOutput(attempt, allowed.permit!, {
          exitCode: 0,
          output: JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              updatedInput: tool_input,
            },
          }),
        }),
      ).toThrow('differs')
      ex.lastResult!.updatedInput = { ...candidate, added_key: [true] }
      expect(token(resolve(ex, input))).not.toBe(id)
      expect(input.tool_input).toEqual(tool_input)
      expect(attempt.originalInput).toEqual(tool_input)
      expect(invocation.context.toolInput).toEqual(tool_input)
    },
  )
  test('store errors never turn pending asks into permission', () => {
    const id = token(resolve())
    writeFileSync(store.path, 'corrupt')
    expect(() => resolve()).toThrow('storage')
    expect(() =>
      resolve(
        execution(),
        raw({ tool_input: { command: `CLOOKS_APPROVAL_TOKENS=${id} rm -rf scratch` } }),
      ),
    ).toThrow()
  })
  test('serialized output is checked against candidate before consumption', () => {
    const ex = execution([vote('a', 0)])
    const id = token(resolve(ex))
    store.acknowledge(id)
    const permit = resolve(ex).permit!
    const attempt = prepareApprovalAttempt(raw())
    validateApprovalOutput(attempt, permit, { exitCode: 0 })
    const mutated = cloneDeep(attempt)
    jsonRecord(mutated.originalInput).command = 'changed inspection input'
    validateApprovalOutput(mutated, permit, { exitCode: 0 })
    jsonRecord(mutated.nativeInput).command = 'different actual command'
    expect(() => validateApprovalOutput(mutated, permit, { exitCode: 0 })).toThrow('differs')
    const replacement = (
      updatedInput: unknown,
      permissionDecision = 'allow',
      hookEventName = 'PreToolUse',
    ) => ({
      exitCode: 0 as const,
      output: JSON.stringify({
        hookSpecificOutput: { permissionDecision, hookEventName, updatedInput },
      }),
    })
    validateApprovalOutput(attempt, permit, replacement({ command: 'rm -rf scratch' }))
    validateApprovalOutput(
      attempt,
      permit,
      replacement({ command: `CLOOKS_APPROVAL_TOKENS=${id} rm -rf scratch` }),
    )
    for (const bad of [
      { exitCode: 2 as const },
      { exitCode: 0 as const, output: 'invalid' },
      replacement({ command: 'other' }),
      replacement({}, 'deny'),
      replacement({}, 'ask'),
      replacement({}, 'allow', 'Stop'),
      { exitCode: 0 as const, output: '{"continue":false}' },
      { exitCode: 0 as const, output: '{"hookSpecificOutput":{"permissionDecision":"allow"}}' },
    ])
      expect(() => validateApprovalOutput(attempt, permit, bad)).toThrow()
    expect(resolve(ex).permit?.requiredTokens[0]!.token).toBe(id)
  })
})
