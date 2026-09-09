import { expect, test } from 'bun:test'
import { homedir } from 'os'
import { getHomeDir } from './platform.js'

test('getHomeDir returns the operating system home directory', () => {
  expect(getHomeDir()).toBe(homedir())
  expect(getHomeDir().length).toBeGreaterThan(0)
})
