import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSandbox, formatDiagnostics, type Sandbox } from './helpers/sandbox'

const root = join(import.meta.dir, '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
let sandbox: Sandbox | undefined
afterEach(() => sandbox?.cleanup())

test('validation scripts share the runner while retaining the direct Docker interface', () => {
  expect(pkg.scripts['test:validation']).toBe('bun test/tooling/run-validation.ts all')
  expect(pkg.scripts['test:e2e']).toBe('bun test/tooling/run-validation.ts e2e')
  expect(pkg.scripts['test:e2e:build']).toBe('docker build -q -t clooks-e2e -f test/Dockerfile .')
  expect(pkg.scripts['test:e2e:run']).toBe(
    'docker run --rm -v ./src:/app/src:ro -v ./test:/app/test:ro -v ./schemas:/app/schemas:ro -v ./tsconfig.json:/app/tsconfig.json:ro -v ./bunfig.toml:/app/bunfig.toml:ro -v ./hookcoverage.toml:/app/hookcoverage.toml:ro -v ./.clooks/vendor/plugin:/app/.clooks/vendor/plugin:ro clooks-e2e',
  )
})

test('Docker mounts the authoritative test config and retains coverage policy', () => {
  const config = Bun.TOML.parse(readFileSync(join(root, 'bunfig.toml'), 'utf8')) as {
    test: {
      root: string
      coverageThreshold: { lines: number; functions: number }
      coveragePathIgnorePatterns: string[]
      pathIgnorePatterns?: string[]
    }
  }
  expect(pkg.scripts['test:e2e:run']).toContain('-v ./bunfig.toml:/app/bunfig.toml:ro')
  expect(config.test.root).toBe('src/')
  expect(config.test.coverageThreshold).toEqual({ lines: 0.95, functions: 0.95 })
  expect(config.test.coveragePathIgnorePatterns).toEqual(['**/tmp/**', '.clooks/vendor/plugin/**'])
  expect(config.test.pathIgnorePatterns).toBeUndefined()
})

test('hook coverage is report-only and excludes engine measurement, not test discovery', () => {
  expect(pkg.scripts['test:e2e:run']).toContain('-v ./hookcoverage.toml:/app/hookcoverage.toml:ro')
  const config = Bun.TOML.parse(readFileSync(join(root, 'hookcoverage.toml'), 'utf8'))
  expect(config).toEqual({
    test: {
      root: 'src/',
      coverageReporter: ['text', 'lcov'],
      coverageDir: 'coverage/hooks',
      coverageSkipTestFiles: true,
      coveragePathIgnorePatterns: ['**/tmp/**', 'src/**', 'test/**'],
    },
  })
})

test.each([0, 23])('coverage command propagates child status %i and output', (code) => {
  sandbox = createSandbox()
  sandbox.writeFile(
    'bun',
    `#!/bin/bash\nprintf '%s\\n' "$CLAUDECODE" "$@"\nprintf 'coverage diagnostic' >&2\nexit ${code}\n`,
  )
  sandbox.writeEntrypoint(
    `#!/bin/bash\nchmod +x ./bun\nexport PATH="$PWD:$PATH"\n${pkg.scripts['test:coverage']}\n`,
  )
  const result = sandbox.runEntrypoint()
  expect(result.exitCode, formatDiagnostics(result)).toBe(code)
  expect(result.stdout).toBe('1\ntest\n--coverage\nsrc/\n')
  expect(result.stderr).toBe('coverage diagnostic')
})

test.each([0, 23])('hook coverage command propagates child status %i and output', (code) => {
  sandbox = createSandbox()
  sandbox.writeFile(
    'bun',
    `#!/bin/bash\nprintf '%s\\n' "$CLAUDECODE" "$@"\nprintf 'hook coverage diagnostic' >&2\nexit ${code}\n`,
  )
  sandbox.writeEntrypoint(
    `#!/bin/bash\nchmod +x ./bun\nexport PATH="$PWD:$PATH"\n${pkg.scripts['test:coverage:hooks']}\n`,
  )
  const result = sandbox.runEntrypoint()
  expect(result.exitCode, formatDiagnostics(result)).toBe(code)
  expect(result.stdout).toBe(
    '1\ntest\n--config=./hookcoverage.toml\n--coverage\n./src/default-hooks/\n',
  )
  expect(result.stderr).toBe('hook coverage diagnostic')
})

test('coverage commands measure separate owners using the actual Bun config flag', () => {
  sandbox = createSandbox()
  for (const config of ['bunfig.toml', 'hookcoverage.toml']) {
    sandbox.writeFile(config, readFileSync(join(root, config), 'utf8'))
  }
  const source = [
    'export function reached() { return 1 }',
    'export function missed() {',
    '  return 2',
    '}',
  ].join('\n')
  sandbox.writeFile('src/support.ts', source)
  sandbox.writeFile('.clooks/vendor/plugin/example/hook.ts', source)
  sandbox.writeFile(
    'src/default-hooks/ownership.test.ts',
    [
      "import { expect, test } from 'bun:test'",
      "import { reached as engine } from '../support'",
      "import { reached as hook } from '../../.clooks/vendor/plugin/example/hook'",
      "test('both owners execute', () => { expect(engine() + hook()).toBe(2) })",
    ].join('\n'),
  )
  for (const [script, directory, expectedSource, status] of [
    ['test:coverage', 'unit', 'src/support.ts', 1],
    ['test:coverage:hooks', 'hooks', '.clooks/vendor/plugin/example/hook.ts', 0],
  ] as const) {
    sandbox.writeEntrypoint(`#!/bin/bash\n${pkg.scripts[script]}\n`)
    const result = sandbox.runEntrypoint()
    expect(result.exitCode, formatDiagnostics(result)).toBe(status)
    expect(result.stderr).toContain('1 pass')
    const records = sandbox
      .readFile(`coverage/${directory}/lcov.info`)
      .split('\n')
      .filter((line) => line.startsWith('SF:'))
    expect(records).toEqual([`SF:${expectedSource}`])
  }
})

test('Docker entrypoint rejects missing config before compilation', () => {
  sandbox = createSandbox()
  sandbox.writeFile('src/cli.ts', '// Compile gate fixture')
  sandbox.writeFile('compile-probe', '#!/bin/bash\nprintf reached > compile-reached\nexit 29\n')
  sandbox.writeEntrypoint(
    '#!/bin/bash\nchmod +x compile-probe\nmkdir -p node_modules/.bin\ncp compile-probe node_modules/.bin/tsc\n',
  )
  expect(sandbox.runEntrypoint().exitCode).toBe(0)
  sandbox.writeEntrypoint(readFileSync(join(root, 'test/docker-entrypoint.sh'), 'utf8'))
  const missing = sandbox.runEntrypoint()
  expect(missing.exitCode, formatDiagnostics(missing)).toBe(1)
  expect(missing.stderr).toContain('bunfig.toml not bind-mounted')
  expect(sandbox.fileExists('compile-reached')).toBe(false)
  sandbox.writeFile('bunfig.toml', '[test]\nroot = "src/"\n')
  const configured = sandbox.runEntrypoint()
  expect(configured.exitCode, formatDiagnostics(configured)).toBe(29)
  expect(sandbox.readFile('compile-reached')).toBe('reached')
})

test('Docker entrypoint forwards explicit test paths without changing option values', () => {
  sandbox = createSandbox()
  sandbox.writeFile('src/cli.ts', '// Compile gate fixture')
  sandbox.writeFile('bunfig.toml', '[test]\nroot = "src/"\n')
  sandbox.writeFile('test/e2e/example.e2e.test.ts', '// Path fixture')
  sandbox.writeFile('tsc', '#!/bin/bash\nexit 0\n')
  sandbox.writeFile(
    'bun',
    '#!/bin/bash\nif [ "$1" = build ]; then exit 0; fi\nprintf "%s\\n" "$@"\n',
  )
  sandbox.writeEntrypoint(
    '#!/bin/bash\nchmod +x tsc bun\nmkdir -p node_modules/.bin\ncp tsc node_modules/.bin/tsc\n',
  )
  expect(sandbox.runEntrypoint().exitCode).toBe(0)
  sandbox.writeFile(
    'docker-entrypoint.sh',
    readFileSync(join(root, 'test/docker-entrypoint.sh'), 'utf8'),
  )
  sandbox.writeEntrypoint('#!/bin/bash\nexport PATH="$PWD:$PATH"\nbash docker-entrypoint.sh\n')
  const defaultRun = sandbox.runEntrypoint()
  expect(defaultRun.exitCode, formatDiagnostics(defaultRun)).toBe(0)
  expect(defaultRun.stdout).toBe('test\n./test/e2e/\n')
  sandbox.writeEntrypoint(
    '#!/bin/bash\nexport PATH="$PWD:$PATH"\nbash docker-entrypoint.sh ./test/e2e/example.e2e.test.ts src/ --coverage --timeout 5000 --retry 2 --test-name-pattern src/ plain-filter ./test/e2e/ /absolute/example.test.ts\n',
  )
  const explicit = sandbox.runEntrypoint()
  expect(explicit.exitCode, formatDiagnostics(explicit)).toBe(0)
  expect(explicit.stdout).toBe(
    'test\n./test/e2e/example.e2e.test.ts\nsrc/\n--coverage\n--timeout\n5000\n--retry\n2\n--test-name-pattern\nsrc/\nplain-filter\n./test/e2e/\n/absolute/example.test.ts\n',
  )
})
