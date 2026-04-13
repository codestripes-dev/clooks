import { describe, test, expect } from 'bun:test'
import { KNOWN_COMMANDS } from './known-commands.js'
import { program } from './router.js'

describe('KNOWN_COMMANDS', () => {
  test('contains the initial set of commands', () => {
    expect(KNOWN_COMMANDS.has('add')).toBe(true)
    expect(KNOWN_COMMANDS.has('config')).toBe(true)
    expect(KNOWN_COMMANDS.has('init')).toBe(true)
    expect(KNOWN_COMMANDS.has('register')).toBe(true)
    expect(KNOWN_COMMANDS.has('test')).toBe(true)
  })

  test('does not contain deferred commands', () => {
    expect(KNOWN_COMMANDS.has('manage')).toBe(false)
    expect(KNOWN_COMMANDS.has('remove')).toBe(false)
    expect(KNOWN_COMMANDS.has('verify')).toBe(false)
    expect(KNOWN_COMMANDS.has('install')).toBe(false)
  })

  test('matches registered commands in router', () => {
    const registeredNames = new Set(program.commands.map((c) => c.name()))
    expect(registeredNames).toEqual(KNOWN_COMMANDS)
  })
})
