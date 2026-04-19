import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseYamlFile, ConfigNotFoundError } from './parse.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-parse-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('parseYamlFile', () => {
  test('parses a valid YAML file and returns the correct object', async () => {
    const filePath = join(tempDir, 'config.yml')
    writeFileSync(
      filePath,
      `version: "1.0.0"\nlog-bash-commands:\n  config:\n    logDir: ".clooks/logs"\n`,
    )
    const result = await parseYamlFile(filePath)
    expect(result).toEqual({
      version: '1.0.0',
      'log-bash-commands': {
        config: { logDir: '.clooks/logs' },
      },
    })
  })

  test('throws on missing file', async () => {
    const filePath = join(tempDir, 'nonexistent.yml')
    expect(parseYamlFile(filePath)).rejects.toThrow('config file not found')
  })

  test('throws ConfigNotFoundError (not generic Error) when file does not exist', async () => {
    const filePath = join(tempDir, 'nonexistent.yml')
    try {
      await parseYamlFile(filePath)
      expect(true).toBe(false) // should not reach here
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigNotFoundError)
    }
  })

  test('throws on malformed YAML', async () => {
    const filePath = join(tempDir, 'bad.yml')
    writeFileSync(filePath, '[unmatched bracket')
    expect(parseYamlFile(filePath)).rejects.toThrow('invalid YAML')
  })

  test('throws on non-mapping YAML', async () => {
    const filePath = join(tempDir, 'array.yml')
    writeFileSync(filePath, '- item1\n- item2\n')
    expect(parseYamlFile(filePath)).rejects.toThrow('must contain a YAML mapping')
  })
})
