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

test('all production package builds compile ESM bytecode after typechecking', () => {
  const { scripts } = JSON.parse(
    readFileSync(resolve(import.meta.dir, '../../package.json'), 'utf8'),
  )
  const builds = Object.entries(scripts).filter(
    ([name]) => name === 'build' || /^build:(darwin|linux)-/.test(name),
  )
  expect(builds).toHaveLength(6)
  for (const [, command] of builds) {
    expect(command).toContain(
      'tsc --noEmit && mkdir -p dist && bun build --compile --bytecode --format=esm ',
    )
    expect(command).toEndWith(' src/cli.ts')
  }
})

test('all five release targets compile ESM bytecode', () => {
  const workflow = Bun.YAML.parse(
    readFileSync(resolve(import.meta.dir, '../../.github/workflows/release.yml'), 'utf8'),
  ) as { jobs: { build: { steps: Array<{ run?: string }> } } }
  const commands = workflow.jobs.build.steps
    .flatMap(({ run }) => (run ?? '').split('\n'))
    .map((line) => line.trim())
    .filter((line) => line.startsWith('bun build '))
    .map((line) => line.split(/\s+/))
  expect(commands).toHaveLength(5)
  for (const command of commands) {
    expect(command).toContain('--compile')
    expect(command).toContain('--bytecode')
    expect(command).toContain('--format=esm')
    expect(command).toContain('src/cli.ts')
  }
  expect(commands.map((command) => command[command.indexOf('--target') + 1]).sort()).toEqual([
    'bun-darwin-arm64',
    'bun-darwin-x64',
    'bun-linux-arm64',
    'bun-linux-x64-baseline',
    'bun-linux-x64-modern',
  ])
})

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
        '#!/bin/sh\nif [ "$1" = build ]; then printf "%s\\n" "$@" > build-args; printf compiled > dist/clooks; else printf tested > tested; fi\n',
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
      if (mode === 'source') {
        expect(readFileSync(join(root, 'build-args'), 'utf8').trim().split('\n')).toEqual([
          'build',
          '--compile',
          '--bytecode',
          '--format=esm',
          '--outfile',
          'dist/clooks',
          'src/cli.ts',
        ])
      } else {
        expect(existsSync(join(root, 'build-args'))).toBe(false)
      }
      expect(readFileSync(binary, 'utf8')).toBe(bytes)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
