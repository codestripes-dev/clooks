import type { BeforeHookEvent, AfterHookEvent } from './lifecycle.js'
import type { ClooksHook } from './hook.js'
import { describe, test, expect } from 'bun:test'

describe('lifecycle types', () => {
  test('BeforeHookEvent narrows input by type discriminant', () => {
    const handler = (event: BeforeHookEvent) => {
      if (event.type === 'PreToolUse') {
        const _name: string = event.input.toolName
        void _name
      }
    }
    expect(handler).toBeDefined()
  })

  test('BeforeHookEvent rejects unnarrowed input access', () => {
    const handler = (event: BeforeHookEvent) => {
      // @ts-expect-error — toolName doesn't exist on the unnarrowed union
      const _name: string = event.input.toolName
      void _name
    }
    expect(handler).toBeDefined()
  })

  test('BeforeHookEvent has block / skip / passthrough constructors', () => {
    const handler = (event: BeforeHookEvent) => {
      if (event.type === 'PreToolUse') {
        return event.block({ reason: 'gated' })
      }
      if (event.type === 'PostToolUse') {
        return event.skip()
      }
      return event.passthrough({ debugMessage: 'no-op' })
    }
    expect(handler).toBeDefined()
  })

  test('BeforeHookEvent.block requires opts (reason)', () => {
    const handler = (event: BeforeHookEvent) => {
      if (event.type === 'PreToolUse') {
        // @ts-expect-error — block requires { reason }
        return event.block({})
      }
      return event.passthrough()
    }
    expect(handler).toBeDefined()
  })

  test('BeforeHookEvent has no respond method', () => {
    const handler = (event: BeforeHookEvent) => {
      // @ts-expect-error — respond does not exist on BeforeHookEvent
      event.respond({ result: 'block', reason: 'x' })
    }
    expect(handler).toBeDefined()
  })

  test('BeforeHookEvent void return is permitted', () => {
    const hook: ClooksHook = {
      meta: { name: 'demo' },
      beforeHook(_event) {
        return
      },
      PreToolUse(_ctx) {
        return { result: 'allow' }
      },
    }
    expect(hook.beforeHook).toBeDefined()
  })

  test('AfterHookEvent narrows handlerResult by type discriminant', () => {
    const handler = (event: AfterHookEvent) => {
      if (event.type === 'PreToolUse') {
        // PreToolUseResult union — discriminate further on .result
        if (event.handlerResult.result === 'allow') {
          const _r: 'allow' = event.handlerResult.result
          void _r
        }
      }
    }
    expect(handler).toBeDefined()
  })

  test('AfterHookEvent has only passthrough — no decision verbs', () => {
    const handler = (event: AfterHookEvent) => {
      if (event.type === 'PreToolUse') {
        // @ts-expect-error — block does not exist on AfterHookEvent (observer-only)
        event.block({ reason: 'x' })
        // @ts-expect-error — skip does not exist on AfterHookEvent
        event.skip()
        // @ts-expect-error — allow does not exist on AfterHookEvent
        event.allow()
      }
      return event.passthrough()
    }
    expect(handler).toBeDefined()
  })

  test('AfterHookEvent has no respond method', () => {
    const handler = (event: AfterHookEvent) => {
      // @ts-expect-error — respond does not exist on AfterHookEvent
      event.respond({ result: 'allow' })
    }
    expect(handler).toBeDefined()
  })

  test('AfterHookEvent void return is permitted', () => {
    const hook: ClooksHook = {
      meta: { name: 'demo' },
      afterHook(_event) {
        return
      },
      PreToolUse(_ctx) {
        return { result: 'allow' }
      },
    }
    expect(hook.afterHook).toBeDefined()
  })

  test('ClooksHook accepts return-based lifecycle methods', () => {
    const hook: ClooksHook = {
      meta: { name: 'test-hook' },
      beforeHook(event) {
        if (event.type === 'PreToolUse') {
          return event.block({ reason: 'test' })
        }
        return event.passthrough({ debugMessage: 'gate passed' })
      },
      afterHook(event) {
        if (event.type === 'PreToolUse' && event.handlerResult.result === 'allow') {
          // observer side effect would happen here
        }
        return event.passthrough()
      },
      PreToolUse(_ctx) {
        return { result: 'allow' }
      },
    }
    expect(hook.meta.name).toBe('test-hook')
  })

  test('ClooksHook rejects non-decision return from beforeHook', () => {
    const hook: ClooksHook = {
      meta: { name: 'demo' },
      // @ts-expect-error — return shape must be Block/Skip/Passthrough/void
      beforeHook(_event) {
        return { result: 'allow' as const }
      },
      PreToolUse(_ctx) {
        return { result: 'allow' }
      },
    }
    expect(hook).toBeDefined()
  })
})
