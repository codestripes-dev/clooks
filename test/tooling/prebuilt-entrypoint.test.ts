import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const entrypoint = resolve(import.meta.dir, '../docker-entrypoint.sh')

test.each(['source', 'prebuilt', 'wrong-hash', 'missing-hash', 'symlink'])(
  'Docker test entrypoint binary selection: %s',
  (mode) => {
    const root = mkdtempSync('/tmp/clooks-prebuilt-')
    try {
      for (const path of ['src', 'node_modules/.bin', 'bin'])
        mkdirSync(join(root, path), { recursive: true })
      writeFileSync(join(root, 'src/cli.ts'), '')
      writeFileSync(join(root, 'bunfig.toml'), '')
      writeFileSync(join(root, 'node_modules/.bin/tsc'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      writeFileSync(
        join(root, 'bin/bun'),
        '#!/bin/sh\nif [ "$1" = build ]; then printf compiled > dist/clooks; else printf tested > tested; fi\n',
        { mode: 0o755 },
      )
      const bytes = 'downloaded artifact'
      const binary = join(root, 'download')
      writeFileSync(binary, bytes)
      const env: Record<string, string> = { PATH: `${root}/bin:/usr/bin:/bin` }
      if (mode !== 'source') {
        env.CLOOKS_TEST_BINARY = binary
        if (mode !== 'missing-hash')
          env.CLOOKS_TEST_BINARY_SHA256 =
            mode === 'wrong-hash'
              ? '0'.repeat(64)
              : createHash('sha256').update(bytes).digest('hex')
        if (mode === 'symlink') {
          symlinkSync(binary, join(root, 'link'))
          env.CLOOKS_TEST_BINARY = join(root, 'link')
        }
      }
      const result = spawnSync('/bin/bash', [entrypoint], {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 5000,
      })
      expect(result.error).toBeUndefined()
      if (mode === 'source' || mode === 'prebuilt') {
        expect(result.status).toBe(0)
        expect(readFileSync(join(root, 'dist/clooks'), 'utf8')).toBe(
          mode === 'source' ? 'compiled' : bytes,
        )
        expect(existsSync(join(root, 'tested'))).toBe(true)
      } else {
        expect(result.status).not.toBe(0)
        expect(existsSync(join(root, 'dist/clooks'))).toBe(false)
        expect(existsSync(join(root, 'tested'))).toBe(false)
      }
      expect(readFileSync(binary, 'utf8')).toBe(bytes)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
