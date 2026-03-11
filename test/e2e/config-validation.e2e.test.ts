import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('config validation', () => {
  test('1. empty config file (zero bytes) — exit 2', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('')

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    // Empty YAML parses as null → "must contain a YAML mapping, got null"
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('must contain a YAML mapping')
  })

  test('2. config is a YAML scalar (just "hello") — exit 2', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('hello')

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    // YAML scalar parses as string → "must contain a YAML mapping, got string"
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('must contain a YAML mapping')
  })

  test('3. config is a YAML array — exit 2', () => {
    sandbox = createSandbox()
    sandbox.writeConfig(`
- item1
- item2
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    // YAML array → "must contain a YAML mapping, got array"
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('must contain a YAML mapping')
  })

  test('4. missing version field — exit 2', () => {
    sandbox = createSandbox()
    sandbox.writeConfig(`
config:
  timeout: 5000
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('missing required "version" field')
  })

  test('5. version is a number — exit 2', () => {
    sandbox = createSandbox()
    sandbox.writeConfig(`
version: 1
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('"version" must be a string')
  })

  test('6. global onError: trace — exit 2', () => {
    sandbox = createSandbox()
    sandbox.writeConfig(`
version: "1.0.0"
config:
  onError: trace
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('cannot be "trace"')
    expect(result.stderr).toContain('global')
  })

  test('7. event-level onError — exit 2, "event-level onError has been removed"', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', `
export const hook = {
  meta: { name: "allow-all" },
  PreToolUse() { return { result: "allow" as const } },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
allow-all: {}
PreToolUse:
  onError: continue
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('event-level onError has been removed')
  })

  test('8. hook events sub-map has unknown event name — exit 2', () => {
    sandbox = createSandbox()
    sandbox.writeHook('bad-events.ts', `
export const hook = {
  meta: { name: "bad-events" },
  PreToolUse() { return { result: "allow" as const } },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
bad-events:
  events:
    NonExistentEvent:
      onError: continue
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('unknown event')
    expect(result.stderr).toContain('NonExistentEvent')
  })

  test('9. hook events sub-map onError:trace on non-injectable event — exit 2', () => {
    sandbox = createSandbox()
    sandbox.writeHook('trace-bad.ts', `
export const hook = {
  meta: { name: "trace-bad" },
  SessionEnd() { return null },
}
`)
    // SessionEnd is not in INJECTABLE_EVENTS, so trace should be rejected
    sandbox.writeConfig(`
version: "1.0.0"
trace-bad:
  events:
    SessionEnd:
      onError: trace
`)

    const stdin = loadEvent('session-end.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('cannot be "trace"')
    expect(result.stderr).toContain('SessionEnd')
    expect(result.stderr).toContain('does not support additionalContext')
  })

  test('10. order list references hook not in config — exit 2', () => {
    sandbox = createSandbox()
    sandbox.writeHook('real-hook.ts', `
export const hook = {
  meta: { name: "real-hook" },
  PreToolUse() { return { result: "allow" as const } },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
real-hook: {}
PreToolUse:
  order: [real-hook, ghost-hook]
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('ghost-hook')
    expect(result.stderr).toContain('not defined')
  })
})
