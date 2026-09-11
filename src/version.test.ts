import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { VERSION } from './version'

test('package release version matches the CLI version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(pkg.version).toBe(VERSION)
})
