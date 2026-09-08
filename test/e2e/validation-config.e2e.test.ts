import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSandbox, formatDiagnostics, type Sandbox } from './helpers/sandbox'

const root = join(import.meta.dir, '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
let sandbox: Sandbox | undefined
afterEach(() => sandbox?.cleanup())

test('Docker mounts the authoritative test config and retains coverage policy', () => {
  const config = Bun.TOML.parse(readFileSync(join(root, 'bunfig.toml'), 'utf8')) as {
    test: { root: string; coverageThreshold: { lines: number; functions: number } }
  }
  expect(pkg.scripts['test:e2e:run']).toContain('-v ./bunfig.toml:/app/bunfig.toml:ro')
  expect(config.test.root).toBe('src/')
  expect(config.test.coverageThreshold).toEqual({ lines: 0.95, functions: 0.95 })
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
