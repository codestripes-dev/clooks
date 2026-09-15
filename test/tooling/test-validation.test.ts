import { afterEach, expect, test } from 'bun:test'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  discover,
  parseArgs,
  partition,
  phaseTimings,
  sourceIdentity,
  verifyExecution,
  verifyCoverage,
  type WorkerCount,
} from './run-validation'

if (process.env.CLOOKS_E2E_DOCKER !== 'true') {
  throw new Error('Tooling tests must run inside the test Docker container')
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const selected = ['./test/e2e/a.e2e.test.ts', './test/e2e/nested/b.e2e.test.ts']
const imageID = `sha256:${'a'.repeat(64)}`
const containerID = (name: string) => createHash('sha256').update(name).digest('hex')

function fixture(fileCount = 2) {
  const root = mkdtempSync(join(tmpdir(), 'clooks-validation tooling-'))
  roots.push(root)
  const put = (path: string, data: string) => {
    const destination = join(root, path)
    mkdirSync(join(destination, '..'), { recursive: true })
    writeFileSync(destination, data)
  }
  for (const path of [
    'src/cli.ts',
    'test/Dockerfile',
    'test/docker-entrypoint.sh',
    'schemas/example.json',
    'scripts/example.ts',
    'package.json',
    '.github/workflows/release.yml',
    'bun.lock',
    'tsconfig.json',
    'bunfig.toml',
    'hookcoverage.toml',
    '.dockerignore',
    '.clooks/vendor/plugin/example.ts',
    ...selected,
  ]) {
    put(path, '// fixture\n')
  }
  const files = [...selected]
  for (let index = selected.length; index < fileCount; index++) {
    const path = `./test/e2e/extra-${index}.e2e.test.ts`
    files.push(path)
    put(path, '// extra fixture\n')
  }
  const scripts = JSON.parse(
    readFileSync(join(import.meta.dir, '../../package.json'), 'utf8'),
  ).scripts
  put('package.json', JSON.stringify({ name: 'validation-fixture', type: 'module', scripts }))
  put('tsconfig.json', '{"compilerOptions":{}}\n')
  put('schemas/example.json', '{}\n')
  put('bunfig.toml', '[test]\nroot = "src/"\n')
  put('hookcoverage.toml', '[test]\nroot = "src/"\n')
  put('bun.lock', '{"lockfileVersion":1,"workspaces":{},"packages":{}}\n')
  put('.dockerignore', 'tmp/\n')
  put('test/tooling/run-validation.ts', '')
  put('test/tooling/fixture.test.ts', '// tooling fixture\n')
  cpSync(join(import.meta.dir, 'run-validation.ts'), join(root, 'test/tooling/run-validation.ts'))
  cpSync(
    join(import.meta.dir, 'onboarding-inputs.ts'),
    join(root, 'test/tooling/onboarding-inputs.ts'),
  )
  put('bin/docker', `#!${process.execPath}\n${fakeDocker}`)
  chmodSync(join(root, 'bin/docker'), 0o755)
  symlinkSync(process.execPath, join(root, 'bin/bun'))
  return { root, put, files: files.sort() }
}

// Only this executable is exposed as Docker to the child. No nested daemon access.
const fakeDocker = String.raw`
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
const args = process.argv.slice(2)
const scenario = process.env.FAKE_SCENARIO || 'success'
const root = process.cwd()
const state = join(root, 'fake-state')
const idFor = (name) => createHash('sha256').update(name).digest('hex')
mkdirSync(state, { recursive: true })
appendFileSync(join(root, 'events.jsonl'), JSON.stringify({ args, pid: process.pid }) + '\n')
const value = (flag) => args[args.indexOf(flag) + 1]
const sleep = () => new Promise(() => setInterval(() => {}, 1000))
if (args[0] === 'run' && scenario.startsWith('direct-')) {
  process.exit(scenario === 'direct-fail' ? 23 : 0)
} else if (args[0] === 'build') {
  if (scenario === 'marketplace-source-drift') appendFileSync(join(root, 'marketplace/clooks/install.sh'), '// live change\n')
  if (scenario === 'descendant-hang') {
    process.on('SIGTERM', () => process.exit(0))
    spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); require("node:fs").writeFileSync("grandchild.json", JSON.stringify({ pid: process.pid })); setInterval(() => {}, 1000)'], { stdio: 'inherit' })
    await sleep()
  }
  if (scenario === 'build-hang') await sleep()
  if (scenario === 'build-fail') process.exit(17)
  if (scenario !== 'missing-iid') {
    writeFileSync(value('--iidfile'), scenario === 'empty-iid' ? '' : scenario === 'bad-iid' ? 'clooks-e2e' : 'sha256:' + 'a'.repeat(64) + '\n')
  }
} else if (args[0] === 'create') {
  const name = value('--name')
  const label = value('--label').split('=')[1]
  writeFileSync(join(state, idFor(name) + '.json'), JSON.stringify({
    args, Id: idFor(name),
    Config: { Labels: { 'clooks.validation.attempt': scenario === 'foreign-collision' ? 'foreign' : label } },
  }))
  if (scenario === 'create-hang') await sleep()
  if (scenario === 'create-fail' || scenario === 'foreign-collision') process.exit(19)
  console.log('fake-container-id')
} else if (args[0] === 'start') {
  const name = args.at(-1)
  if (scenario === 'tooling-fail' && name.endsWith('-tooling')) process.exit(29)
  if (scenario === 'worker-hang') await sleep()
  if (scenario === 'worker-fail' || (scenario === 'mixed-workers' && name.endsWith('-2'))) process.exit(23)
  const create = JSON.parse(readFileSync(join(state, idFor(name) + '.json'), 'utf8')).args
  let files = create.filter((arg) => arg.startsWith('./test/e2e/') && arg.endsWith('.test.ts'))
  if (create.includes('./test/e2e/')) files = ['./test/e2e/a.e2e.test.ts', './test/e2e/nested/b.e2e.test.ts']
  if (create.includes('./test/tooling/')) files = ['./test/tooling/fixture.test.ts']
  if (create.includes('./test/plugin-onboarding/')) files = ['./test/plugin-onboarding/plugin-onboarding.e2e.test.ts']
  if (scenario === 'marketplace-snapshot-drift') {
    const mount = create.find((arg) => arg.endsWith(',dst=/onboarding-marketplace,readonly'))
    const snapshot = mount.slice('type=bind,src='.length, -',dst=/onboarding-marketplace,readonly'.length)
    appendFileSync(join(snapshot, 'clooks/install.sh'), '// snapshot change\n')
  }
  if (create.includes('--coverage')) files = ['./src/cli.test.ts']
  if (scenario === 'missing-file') files = files.slice(1)
  if (scenario === 'duplicate-file') files = files.map(() => files[0])
  if (scenario === 'wrong-file') files = files.map((file, index) => index === 0 ? './test/e2e/wrong.e2e.test.ts' : file)
  if (scenario === 'source-drift') appendFileSync(join(root, 'src/cli.ts'), '// changed\n')
  const tests = scenario === 'zero-tests' ? 0 : files.length
  const failures = scenario === 'summary-failure' ? 1 : 0
  if (scenario !== 'missing-timing') {
    console.error('__CLOOKS_VALIDATION_TRACE__ 1700000000.000000 ./node_modules/.bin/tsc --noEmit')
    console.error('__CLOOKS_VALIDATION_TRACE__ 1700000001.000000 mkdir -p dist')
    console.error('__CLOOKS_VALIDATION_TRACE__ 1700000001.010000 bun build --compile --bytecode --format=esm --outfile dist/clooks src/cli.ts')
    console.error('__CLOOKS_VALIDATION_TRACE__ 1700000002.010000 exec bun test ' + files.join(' '))
  }
  if (scenario !== 'quiet-output') {
    for (const [index, file] of files.entries()) {
      console.error(file.slice(2) + ':')
      console.error((scenario === 'skipped-file' && index === 0 ? '(skip)' : '(pass)') + ' fixture [1.00ms]')
    }
  }
  console.error('\n ' + tests + ' pass\n ' + failures + ' fail\nRan ' + tests + ' tests across ' + files.length + ' files. [1.00s]')
  if (scenario === 'coverage-fail' && name.endsWith('-coverage')) process.exit(37)
} else if (args[0] === 'cp') {
  if (scenario === 'missing-lcov') process.exit(31)
  const file = scenario === 'wrong-owner-lcov' ? '.clooks/vendor/plugin/hook.ts' : 'src/cli.ts'
  writeFileSync(args[2], scenario === 'empty-lcov' ? '' : 'SF:' + file + '\nFNF:1\nFNH:1\nLF:1\nLH:1\nDA:1,1\nend_of_record\n')
} else if (args[0] === 'container' && args[1] === 'inspect') {
  if (scenario === 'inspect-warning') console.error('Docker inspect warning: diagnostic only')
  console.log(readFileSync(join(state, idFor(args.at(-1)) + '.json'), 'utf8'))
} else if (args[0] === 'rm') {
  if (scenario === 'cleanup-fail') process.exit(41)
  const id = args.at(-1)
  if (!/^[a-f0-9]{64}$/.test(id)) process.exit(44)
  rmSync(join(state, id + '.json'))
} else {
  throw new Error('Unexpected Docker command: ' + JSON.stringify(args))
}
`

interface Event {
  args: string[]
  pid: number
}

test('fake Docker removes only the requested ID without reading disappearing peer state', async () => {
  const { root, put } = fixture()
  const id = 'f'.repeat(64)
  put('fake-state/aab-peer.json', 'incomplete peer write')
  const dangling = join(root, 'fake-state/aaa-deleted-peer.json')
  symlinkSync('already-removed-peer', dangling)
  put(`fake-state/${id}.json`, JSON.stringify({ Id: id }))
  const child = Bun.spawn([join(root, 'bin/docker'), 'rm', '-f', id], {
    cwd: root,
    env: { ...process.env, FAKE_SCENARIO: 'success' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(code, stdout + stderr).toBe(0)
  expect(existsSync(join(root, `fake-state/${id}.json`))).toBe(false)
  expect(lstatSync(dangling).isSymbolicLink()).toBe(true)
  expect(readFileSync(join(root, 'fake-state/aab-peer.json'), 'utf8')).toBe('incomplete peer write')
})

function events(root: string): Event[] {
  const path = join(root, 'events.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Event)
}

function launch(
  root: string,
  scenario = 'success',
  args = ['e2e', '--workers', '1'],
  script?: string,
  marketplaceRoot?: string,
) {
  const child = Bun.spawn(
    script
      ? [process.execPath, 'run', script, ...args]
      : [process.execPath, join(root, 'test/tooling/run-validation.ts'), ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: join(root, 'bin'),
        FAKE_SCENARIO: scenario,
        CLOOKS_MARKETPLACE_ROOT: marketplaceRoot,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { child, output }
}

async function finish(run: ReturnType<typeof launch>) {
  const code = await run.child.exited
  const [stdout, stderr] = await run.output
  return { code, stdout, stderr }
}

function report(root: string) {
  const base = join(root, 'tmp/isolated-e2e-workers')
  const attempts = readdirSync(base)
  expect(attempts).toHaveLength(1)
  const attempt = join(base, attempts[0]!)
  return { attempt, data: JSON.parse(readFileSync(join(attempt, 'report.json'), 'utf8')) }
}

test('ordinary validation has no marketplace dependency or mount', async () => {
  const { root } = fixture()
  expect((await finish(launch(root))).code).toBe(0)
  expect(report(root).data.onboarding).toBeUndefined()
  const create = events(root).find((event) => event.args[0] === 'create')!
  expect(create.args.some((arg) => arg.includes('/onboarding-marketplace'))).toBe(false)
})

test.each(['success', 'marketplace-source-drift', 'marketplace-snapshot-drift'])(
  'explicit marketplace freezes real inputs and verifies snapshot: %s',
  async (scenario) => {
    const { root, put } = fixture()
    put('marketplace/clooks/install.sh', '#!/bin/bash\n')
    chmodSync(join(root, 'marketplace/clooks/install.sh'), 0o751)
    put('marketplace/.claude-plugin/marketplace.json', '{"name":"claude"}\n')
    put('marketplace/.agents/plugins/marketplace.json', '{"name":"codex","plugins":[]}\n')
    const result = await finish(
      launch(root, scenario, ['e2e', './test/plugin-onboarding/'], undefined, './marketplace'),
    )
    const { attempt, data } = report(root)
    expect(result.code, result.stdout + result.stderr).toBe(
      scenario === 'marketplace-snapshot-drift' ? 1 : 0,
    )
    const snapshot = join(attempt, 'onboarding-marketplace')
    expect(data.onboarding.source).toBe(join(root, 'marketplace'))
    expect(data.onboarding.snapshot).toBe(snapshot)
    expect(JSON.parse(readFileSync(join(attempt, 'onboarding-inputs.json'), 'utf8'))).toEqual(
      data.onboarding.manifest,
    )
    expect(lstatSync(join(snapshot, 'clooks/install.sh')).mode & 0o777).toBe(0o751)
    const create = events(root).find((event) => event.args[0] === 'create')!
    expect(create.args).toContain(`type=bind,src=${snapshot},dst=/onboarding-marketplace,readonly`)
    expect(create.args).toContain('CLOOKS_MARKETPLACE_ROOT=/onboarding-marketplace')
    expect(create.args[create.args.indexOf('--network') + 1]).toBe('none')
    expect(
      create.args.some((arg) => arg.startsWith(`type=bind,src=${join(root, 'marketplace')},`)),
    ).toBe(false)
    if (scenario === 'marketplace-snapshot-drift')
      expect(data.error).toContain('Onboarding snapshot verification failed')
    else expect(readFileSync(join(snapshot, 'clooks/install.sh'), 'utf8')).toBe('#!/bin/bash\n')
  },
)

test.each(['', './missing-marketplace'])(
  'explicit invalid marketplace fails before Docker: %s',
  async (source) => {
    const { root } = fixture()
    expect((await finish(launch(root, 'success', ['e2e'], undefined, source))).code).toBe(1)
    expect(events(root)).toEqual([])
    expect(report(root).data.results).toEqual([])
  },
)

test('CLI accepts only bounded full-suite worker modes', () => {
  expect(parseArgs(['e2e'])).toEqual({ mode: 'e2e', workers: 4, args: [] })
  expect(parseArgs(['all'])).toEqual({ mode: 'all', workers: 4, args: [] })
  expect(parseArgs(['e2e', '--workers', '1']).workers).toBe(1)
  expect(parseArgs(['e2e', '--workers', '2']).workers).toBe(2)
  expect(parseArgs(['all', '--workers', '1']).workers).toBe(1)
  const args = [
    './test/e2e/a.e2e.test.ts',
    '--test-name-pattern',
    'space ; $x',
    '',
    '--timeout',
    '5000',
  ]
  expect(parseArgs(['e2e', ...args])).toEqual({ mode: 'e2e', workers: 1, args })
  for (const args of [
    [],
    ['unknown'],
    ['e2e', '--workers', '0'],
    ['e2e', '--workers', '3'],
    ['e2e', '--workers', '1.0'],
    ['e2e', '--workers', ''],
    ['e2e', '--workers', '2', '--workers', '1'],
    ['all', '--timeout', '0'],
    ['all', './test/e2e/'],
  ]) {
    expect(() => parseArgs(args)).toThrow('Usage:')
  }
})

test('recursive discovery and greedy balancing are stable and exactly once', () => {
  const { root } = fixture()
  const files = discover(root)
  expect(files.map((file) => file.path)).toEqual(selected)
  expect(partition(files, 1)).toEqual([selected])
  expect(partition(files, 2)).toEqual([[selected[0]!], [selected[1]!]])
  expect(partition([...files].reverse(), 2)).toEqual(partition(files, 2))
  const weighted = [
    { path: './test/e2e/a.e2e.test.ts', bytes: 30 },
    { path: './test/e2e/b.e2e.test.ts', bytes: 20 },
    { path: './test/e2e/c.e2e.test.ts', bytes: 10 },
  ]
  expect(partition(weighted, 2)).toEqual([
    [weighted[0]!.path],
    [weighted[1]!.path, weighted[2]!.path],
  ])
})

test.each([4, 8, 16, 32] as const)(
  'bounded %i-worker selection is deterministic, complete and nonempty',
  (workers) => {
    expect(parseArgs(['e2e', '--workers', String(workers)]).workers).toBe(workers)
    expect(parseArgs(['all', '--workers', String(workers)]).workers).toBe(workers)
    const files = Array.from({ length: workers * 2 + 3 }, (_, index) => ({
      path: `./test/e2e/file-${String(index).padStart(3, '0')}.e2e.test.ts`,
      bytes: (index % 7) * 13,
    }))
    const groups = partition(files, workers)
    expect(groups).toHaveLength(workers)
    expect(groups.every((group) => group.length > 0)).toBe(true)
    expect(groups.flat().sort()).toEqual(files.map((file) => file.path).sort())
    expect(new Set(groups.flat()).size).toBe(files.length)
    expect(partition([...files].reverse(), workers)).toEqual(groups)
    for (const group of groups) expect(group).toEqual([...group].sort())

    const zeros = files.slice(0, workers * 2).map((file) => ({ ...file, bytes: 0 }))
    expect(partition(zeros, workers)).toEqual(
      Array.from({ length: workers }, (_, index) => [
        zeros[index]!.path,
        zeros[index + workers]!.path,
      ]),
    )
    expect(partition(files.slice(0, workers), workers).every((group) => group.length === 1)).toBe(
      true,
    )
    expect(() => partition(files.slice(0, workers - 1), workers)).toThrow('Empty')
    expect(() => partition([...files, files[0]!], workers)).toThrow('duplicate')
  },
)

test('higher-count greedy selection prioritizes bytes, then file count, then worker index', () => {
  const files = [8, 4, 4, 4, 4, 0, 0, 0].map((bytes, index) => ({
    path: `./test/e2e/${index}.e2e.test.ts`,
    bytes,
  }))
  expect(partition(files, 4)).toEqual([
    [files[0]!.path],
    [files[1]!.path, files[4]!.path],
    [files[2]!.path, files[5]!.path, files[7]!.path],
    [files[3]!.path, files[6]!.path],
  ])
})

test.each([0, -1, 3, 6, 64, 1.5, NaN, Infinity])(
  'invalid worker count is rejected by CLI and exported partition: %s',
  (workers) => {
    expect(() => parseArgs(['e2e', '--workers', String(workers)])).toThrow('Usage:')
    expect(() => parseArgs(['all', '--workers', String(workers)])).toThrow('Usage:')
    expect(() => partition([{ path: selected[0]!, bytes: 1 }], workers as WorkerCount)).toThrow(
      'Invalid worker count',
    )
  },
)

test('partition rejects empty, duplicate, invalid and underfilled selections', () => {
  const file = { path: selected[0]!, bytes: 1 }
  expect(() => partition([], 1)).toThrow()
  expect(() => partition([file], 2)).toThrow()
  expect(() => partition([file, file], 2)).toThrow()
  for (const path of ['src/example.test.ts', './test/e2e/../bad.e2e.test.ts', '']) {
    expect(() => partition([{ path, bytes: 1 }], 1)).toThrow()
  }
  const quoted = { path: './test/e2e/space ; dollar$.e2e.test.ts', bytes: 1 }
  expect(partition([quoted], 1)).toEqual([[quoted.path]])
})

test('fingerprint covers actual inputs and tooling but excludes attempt artifacts', () => {
  const { root, put } = fixture()
  const initial = sourceIdentity(root)
  put('tmp/isolated-e2e-workers/previous/log.txt', 'artifact')
  expect(sourceIdentity(root)).toBe(initial)
  put('.dockerignore', 'changed')
  expect(sourceIdentity(root)).not.toBe(initial)
  const next = sourceIdentity(root)
  put('test/tooling/run-validation.ts', 'changed')
  expect(sourceIdentity(root)).not.toBe(next)
})

test('summary counts reject zero, missing and failing execution', () => {
  const good =
    selected.map((file) => `${file}:\n(pass) fixture [1ms]\n`).join('') +
    ' 2 pass\n 0 fail\nRan 2 tests across 2 files. [1.00s]\n'
  expect(verifyExecution(good, selected).files).toBe(2)
  for (const log of [
    '',
    good.replace('2 tests', '0 tests'),
    good.replace('0 fail', '1 fail'),
    good.replace('2 files', '1 files'),
  ]) {
    expect(() => verifyExecution(log, selected)).toThrow()
  }
})

test('execution evidence requires exact unique file headers and positive cases per file', () => {
  const body = selected.map((file) => `${file}:\n(pass) fixture [1ms]\n`).join('')
  const summary = ' 2 pass\n 0 fail\nRan 2 tests across 2 files. [1.00s]\n'
  expect(verifyExecution(body + summary, selected).executed).toEqual(
    selected.map((file) => ({ file, passed: 1 })),
  )
  for (const output of [
    summary,
    body.replace(selected[1]!, selected[0]!) + summary,
    body.replace(selected[1]!, './test/e2e/wrong.e2e.test.ts') + summary,
    body.replace('(pass)', '(skip)') + summary.replace('2 pass', '1 pass'),
  ]) {
    expect(() => verifyExecution(output, selected)).toThrow()
  }
})

test('phase timings use trace boundaries and the unchanged Bun test duration', () => {
  const log = [
    '__CLOOKS_VALIDATION_TRACE__ 1700000000.000000 ./node_modules/.bin/tsc --noEmit',
    '__CLOOKS_VALIDATION_TRACE__ 1700000001.000000 mkdir -p dist',
    '__CLOOKS_VALIDATION_TRACE__ 1700000001.010000 bun build --compile --bytecode --format=esm --outfile dist/clooks src/cli.ts',
    '__CLOOKS_VALIDATION_TRACE__ 1700000002.010000 exec bun test ./test/e2e/',
  ].join('\n')
  expect(phaseTimings(log, '1.25s')).toEqual({ typecheckMs: 1000, compileMs: 1000, testMs: 1250 })
  expect(phaseTimings('', '1ms')).toEqual({ typecheckMs: null, compileMs: null, testMs: 1 })
})

test.each([1, 2, 4, 8] as const)(
  'fake Docker positive control with %i workers retains identity and selection',
  async (workers) => {
    const { root, files } = fixture(workers)
    const result = await finish(launch(root, 'success', ['e2e', '--workers', String(workers)]))
    expect(result.code, result.stdout + result.stderr).toBe(0)
    const { attempt, data } = report(root)
    expect(data.sourceHash).toBe(data.sourceHashAfter)
    expect(data.imageID).toBe(imageID)
    expect(data.results).toHaveLength(workers)
    expect(data.results.flatMap((worker: { files: string[] }) => worker.files).sort()).toEqual(
      files,
    )
    const commands = events(root)
    expect(commands.filter((event) => event.args[0] === 'build')).toHaveLength(1)
    const creates = commands.filter((event) => event.args[0] === 'create')
    expect(creates).toHaveLength(workers)
    expect(new Set(data.results.map((worker: { name: string }) => worker.name)).size).toBe(workers)
    for (const worker of data.results) {
      expect(worker.inspect.code).toBe(0)
      expect(worker.cleanup.code).toBe(0)
      expect(worker.cleanup.argv.at(-1)).toBe(containerID(worker.name))
    }
    for (const { args } of creates) {
      expect(args).toContain(imageID)
      expect(args).toContain(`clooks.validation.attempt=${data.attemptID}`)
      expect(args).not.toContain('clooks-e2e')
      expect(args).not.toContain('--user')
      expect(args).not.toContain('--network')
      expect(args).toContain(`type=bind,src=${root}/bunfig.toml,dst=/app/bunfig.toml,readonly`)
      expect(args.slice(args.indexOf(imageID) + 1, args.indexOf(imageID) + 7)).toEqual([
        '-u',
        'CLAUDECODE',
        '-u',
        'REPL_ID',
        '-u',
        'AGENT',
      ])
      expect(args).toContain('PS4=__CLOOKS_VALIDATION_TRACE__ ${EPOCHREALTIME} ')
      if (workers === 1) expect(args).toContain('./test/e2e/')
    }
    expect(commands.filter((event) => event.args[0] === 'rm')).toHaveLength(workers)
    expect(readdirSync(join(root, 'fake-state')).filter((path) => path.endsWith('.json'))).toEqual(
      [],
    )
    expect(existsSync(join(attempt, 'build.log'))).toBe(true)
    expect(existsSync(join(attempt, 'manifest.json'))).toBe(true)
  },
  20_000,
)

test('combined package gate builds once and sequences tooling, coverage and four E2E workers', async () => {
  const { root } = fixture(4)
  const result = await finish(launch(root, 'success', [], 'test:validation'))
  expect(result.code, result.stdout + result.stderr).toBe(0)
  const { data } = report(root)
  expect(data.workers).toBe(4)
  expect(data.results.map((worker: { kind: string }) => worker.kind)).toEqual([
    'tooling',
    'coverage',
    ...Array.from({ length: 4 }, () => 'e2e'),
  ])
  const commands = events(root)
  const builds = commands.filter((event) => event.args[0] === 'build')
  expect(builds).toHaveLength(1)
  expect(builds[0]!.args.slice(1, 3)).toEqual(['-t', 'clooks-e2e'])
  const creates = commands.filter((event) => event.args[0] === 'create')
  expect(creates).toHaveLength(6)
  for (const create of creates) expect(create.args).toContain(imageID)
  expect(creates[0]!.args.at(-1)).toBe('./test/tooling/')
  expect(creates[0]!.args).not.toContain('--coverage')
  expect(creates[1]!.args.slice(-2)).toEqual(['--coverage', 'src/'])
  expect(creates[1]!.args).not.toContain('CLAUDECODE')
  for (const index of [0, 1]) {
    const cleanupIndex = commands.findIndex(
      (event) => event.args[0] === 'rm' && event.args.at(-1) === data.results[index].containerID,
    )
    expect(cleanupIndex).toBeGreaterThan(0)
    expect(commands.indexOf(creates[index + 1]!)).toBeGreaterThan(cleanupIndex)
  }
  expect(data.results[1].coverageCopy.code).toBe(0)
  expect(data.results[1].coverageFiles).toEqual(['src/cli.ts'])
  expect(readFileSync(data.results[1].coveragePath, 'utf8')).toContain('SF:src/cli.ts')
  expect(readdirSync(join(root, 'fake-state'))).toEqual([])
}, 20_000)

test.each([
  ['tooling-fail', 1, 'run', 29, 'Worker failed: 29'],
  ['coverage-fail', 2, 'run', 37, 'Worker failed: 37'],
  ['missing-lcov', 2, 'coverageCopy', 31, 'Coverage artifact copy failed'],
  ['empty-lcov', 2, 'run', 0, 'Missing engine coverage'],
  ['wrong-owner-lcov', 2, 'run', 0, 'Unexpected coverage owner'],
  ['cleanup-fail', 1, 'cleanup', 41, 'Removal failed: 41'],
] as const)(
  'combined gate stops after the intended phase failure: %s',
  async (scenario, count, stage, code, error) => {
    const { root } = fixture()
    const result = await finish(launch(root, scenario, ['all', '--workers', '2']))
    expect(result.code).toBe(1)
    const { data } = report(root)
    expect(data.results).toHaveLength(count)
    const failed = data.results.at(-1)
    expect(failed[stage].code).toBe(code)
    expect(failed.error).toContain(error)
    expect(data.error).toContain('later phases not started')
    expect(events(root).filter((event) => event.args[0] === 'create')).toHaveLength(count)
    if (scenario === 'coverage-fail') {
      expect(failed.coverageCopy.code).toBe(0)
      expect(readFileSync(failed.coveragePath, 'utf8')).toContain('SF:src/cli.ts')
    }
  },
  20_000,
)

test('combined gate rejects source changes even when every test phase passed', async () => {
  const { root } = fixture()
  expect((await finish(launch(root, 'source-drift', ['all', '--workers', '2']))).code).toBe(1)
  const { data } = report(root)
  expect(data.error).toContain('let input writers finish, then rerun the complete gate')
  expect(data.results).toHaveLength(4)
  for (const worker of data.results) {
    expect(worker.run.code).toBe(0)
    expect(worker.error).toBeUndefined()
  }
}, 20_000)

test('package wrapper preserves nonempty focused argv and existing Bun empty-argument elision', async () => {
  const { root } = fixture()
  const args = [
    selected[0]!,
    '--test-name-pattern',
    'two words; $(touch injected)',
    '',
    '--timeout',
    '5000',
    'literal*',
  ]
  const result = await finish(launch(root, 'success', args, 'test:e2e'))
  expect(result.code, result.stdout + result.stderr).toBe(0)
  const { data } = report(root)
  expect(data.results).toHaveLength(1)
  expect(data.results[0].kind).toBe('passthrough')
  const create = events(root).find((event) => event.args[0] === 'create')!.args
  // Bun's package-script launcher drops empty arguments before either wrapper receives them.
  expect(create.slice(create.indexOf('/app/test/docker-entrypoint.sh') + 1)).toEqual(
    args.filter((arg) => arg !== ''),
  )
  expect(existsSync(join(root, 'injected'))).toBe(false)
  expect(events(root).filter((event) => event.args[0] === 'build')).toHaveLength(1)
}, 20_000)

test('direct runner preserves empty arguments, spaces and metacharacters exactly', async () => {
  const { root } = fixture()
  const args = [
    selected[0]!,
    '--test-name-pattern',
    'two words; $(touch injected)',
    '',
    '--timeout',
    '5000',
    'literal*',
  ]
  const result = await finish(launch(root, 'success', ['e2e', ...args]))
  expect(result.code, result.stdout + result.stderr).toBe(0)
  const { data } = report(root)
  expect(data.results).toHaveLength(1)
  expect(data.results[0].args).toEqual(args)
  const create = events(root).find((event) => event.args[0] === 'create')!.args
  expect(create.slice(create.indexOf('/app/test/docker-entrypoint.sh') + 1)).toEqual(args)
  expect(existsSync(join(root, 'injected'))).toBe(false)
}, 20_000)

test.each([1, 2, 4, 8] as const)(
  'standalone package wrapper uses configured default or explicit worker override: %i',
  async (workers) => {
    const { root } = fixture(workers)
    const args = workers === 4 ? [] : ['--workers', String(workers)]
    const result = await finish(launch(root, 'success', args, 'test:e2e'))
    expect(result.code, result.stdout + result.stderr).toBe(0)
    expect(report(root).data.results).toHaveLength(workers)
  },
  20_000,
)

test.each(['direct-success', 'direct-fail'])(
  'unchanged direct package wrapper retains launcher argv behavior and status: %s',
  async (scenario) => {
    const { root } = fixture()
    const args = [
      selected[0]!,
      '--test-name-pattern',
      'two words; $(touch injected)',
      '',
      '--timeout',
      '5000',
    ]
    const result = await finish(launch(root, scenario, args, 'test:e2e:run'))
    expect(result.code, result.stdout + result.stderr).toBe(scenario === 'direct-fail' ? 23 : 0)
    const commands = events(root)
    expect(commands).toHaveLength(1)
    expect(commands[0]!.args[0]).toBe('run')
    expect(commands[0]!.args.slice(commands[0]!.args.indexOf('clooks-e2e') + 1)).toEqual(
      args.filter((arg) => arg !== ''),
    )
    expect(existsSync(join(root, 'injected'))).toBe(false)
  },
  20_000,
)

test('combined build failure starts no test phase', async () => {
  const { root } = fixture()
  expect((await finish(launch(root, 'build-fail', ['all', '--workers', '2']))).code).toBe(1)
  const { data } = report(root)
  expect(data.build.code).toBe(17)
  expect(data.error).toContain('Build failed: 17')
  expect(data.results).toEqual([])
  expect(events(root).filter((event) => event.args[0] === 'create')).toEqual([])
})

test('LCOV ownership sanity requires measured engine records, not vendor or tooling coverage', () => {
  const good = 'SF:src/cli.ts\nLF:1\nLH:1\nend_of_record\n'
  expect(verifyCoverage(good)).toEqual(['src/cli.ts'])
  for (const bad of [
    '',
    good + good,
    good.replace('LF:1', 'LF:0'),
    good.replace('src/cli.ts', 'test/tooling/runner.ts'),
    good.replace('src/cli.ts', '.clooks/vendor/plugin/hook.ts'),
  ]) {
    expect(() => verifyCoverage(bad)).toThrow()
  }
})

test('missing input and Docker launch failure cannot succeed', async () => {
  const missing = fixture()
  rmSync(join(missing.root, 'test/e2e'), { recursive: true })
  expect((await finish(launch(missing.root))).code).not.toBe(0)
  expect(events(missing.root)).toEqual([])
  const noDocker = fixture()
  rmSync(join(noDocker.root, 'bin/docker'))
  expect((await finish(launch(noDocker.root))).code).not.toBe(0)
  const { data } = report(noDocker.root)
  expect(data.build.code).not.toBe(0)
  expect(data.build.error).toBeTruthy()
  expect(events(noDocker.root)).toEqual([])
})

test.each([
  ['build-fail', 'build', 17, 'Build failed: 17'],
  ['missing-iid', 'build', 0, 'ENOENT'],
  ['empty-iid', 'build', 0, 'Invalid build image ID'],
  ['bad-iid', 'build', 0, 'Invalid build image ID'],
  ['create-fail', 'create', 19, 'Worker create failed: 19'],
  ['worker-fail', 'run', 23, 'Worker failed: 23'],
  ['zero-tests', 'run', 0, 'Zero tests or failing Bun summary'],
  ['missing-file', 'run', 0, 'Executed file count differs'],
  ['duplicate-file', 'run', 0, 'Executed file headers differ'],
  ['wrong-file', 'run', 0, 'Executed file headers differ'],
  ['skipped-file', 'run', 0, 'Missing positive per-file execution'],
  ['summary-failure', 'run', 0, 'Zero tests or failing Bun summary'],
  ['quiet-output', 'run', 0, 'Executed file headers differ'],
  ['missing-timing', 'run', 0, 'Missing or invalid phase timing'],
  ['cleanup-fail', 'cleanup', 41, ''],
  ['source-drift', 'run', 0, 'Source identity changed'],
] as const)(
  'fake Docker failure stays nonzero and retains report: %s',
  async (scenario, stage, code, error) => {
    const { root } = fixture()
    const result = await finish(launch(root, scenario))
    expect(result.code, result.stdout + result.stderr).not.toBe(0)
    const { data } = report(root)
    expect(data.code).not.toBe(0)
    expect(data.elapsedMs).toBeGreaterThan(0)
    const status = stage === 'build' ? data.build : data.results[0][stage]
    expect(status.code).toBe(code)
    if (error) expect(data.error ?? data.results[0]?.error).toContain(error)
    if (stage !== 'build') expect(data.build.code).toBe(0)
    if (stage === 'run' || stage === 'cleanup') expect(data.results[0].create.code).toBe(0)
    if (stage === 'cleanup') {
      expect(data.results[0].run.code).toBe(0)
      expect(data.results[0].execution.files).toBe(2)
    }
    const commands = events(root)
    const creates = commands.filter((event) => event.args[0] === 'create')
    expect(commands.filter((event) => event.args[0] === 'rm')).toHaveLength(creates.length)
    if (scenario === 'build-fail' || scenario.endsWith('iid')) expect(creates).toHaveLength(0)
  },
  20_000,
)

test('inspect parses stdout separately while retaining stderr warnings in the raw log', async () => {
  const { root } = fixture()
  const result = await finish(launch(root, 'inspect-warning'))
  expect(result.code, result.stdout + result.stderr).toBe(0)
  const worker = report(root).data.results[0]
  expect(worker.inspect.code).toBe(0)
  expect(worker.cleanup.code).toBe(0)
  expect(readFileSync(worker.inspect.log, 'utf8')).toContain('Docker inspect warning')
  const metadata = readFileSync(worker.inspect.stdout, 'utf8')
  expect(metadata).not.toContain('Docker inspect warning')
  expect(JSON.parse(metadata).Id).toBe(worker.containerID)
}, 20_000)

test('foreign collision is preserved but owned creation followed by CLI failure is cleaned', async () => {
  for (const scenario of ['foreign-collision', 'create-fail']) {
    const { root } = fixture()
    const result = await finish(launch(root, scenario))
    expect(result.code).toBe(1)
    const worker = report(root).data.results[0]
    expect(worker.create.code).toBe(19)
    expect(worker.inspect.code).toBe(0)
    const removals = events(root).filter((event) => event.args[0] === 'rm')
    if (scenario === 'foreign-collision') {
      expect(worker.error).toContain('ownership mismatch')
      expect(removals).toEqual([])
      expect(existsSync(join(root, 'fake-state', containerID(worker.name) + '.json'))).toBe(true)
    } else {
      expect(worker.cleanup.code).toBe(0)
      expect(removals.map((event) => event.args.at(-1))).toEqual([containerID(worker.name)])
      expect(existsSync(join(root, 'fake-state', containerID(worker.name) + '.json'))).toBe(false)
    }
  }
}, 20_000)

test.each([2, 4, 8] as const)(
  'mixed %i workers preserve failure and clean all verified IDs',
  async (workers) => {
    const { root } = fixture(workers)
    const result = await finish(
      launch(root, 'mixed-workers', ['e2e', '--workers', String(workers)]),
    )
    expect(result.code).toBe(1)
    const { data } = report(root)
    expect(data.results).toHaveLength(workers)
    expect(data.results[0].run.code).toBe(0)
    expect(data.results[0].execution.files).toBe(1)
    expect(data.results[0].error).toBeUndefined()
    expect(data.results[1].run.code).toBe(23)
    expect(data.results[1].error).toContain('Worker failed: 23')
    for (const worker of data.results) {
      if (worker !== data.results[1]) {
        expect(worker.run.code).toBe(0)
        expect(worker.execution.files).toBe(1)
        expect(worker.error).toBeUndefined()
      }
      expect(worker.cleanup.code).toBe(0)
      expect(worker.cleanup.argv.at(-1)).toBe(containerID(worker.name))
    }
    expect(readdirSync(join(root, 'fake-state'))).toEqual([])
  },
  20_000,
)

test('TERM-resistant descendant is killed after its direct parent exits', async () => {
  const { root } = fixture()
  const run = launch(root, 'descendant-hang')
  let descendant: number | undefined
  const running = (pid: number) => {
    try {
      // Orphans may briefly remain zombies under the test container's PID 1.
      return !/^State:\s+Z\b/m.test(readFileSync(`/proc/${pid}/status`, 'utf8'))
    } catch {
      return false
    }
  }
  try {
    const deadline = performance.now() + 8000
    while (!existsSync(join(root, 'grandchild.json'))) {
      if (performance.now() > deadline) throw new Error('Descendant never became ready')
      await Bun.sleep(20)
    }
    descendant = JSON.parse(readFileSync(join(root, 'grandchild.json'), 'utf8')).pid
    expect(running(descendant!)).toBe(true)
    run.child.kill('SIGTERM')
    const result = await finish(run)
    expect(result.code).toBe(143)
    const { data } = report(root)
    expect(data.build.signal).toBeNull()
    expect(data.build.error).toBe('Cancelled')
    expect(data.build.code).not.toBe(0)
    const reapDeadline = performance.now() + 2000
    while (running(descendant!) && performance.now() < reapDeadline) await Bun.sleep(20)
    expect(running(descendant!)).toBe(false)
  } finally {
    if (descendant && running(descendant)) process.kill(descendant, 'SIGKILL')
    if (run.child.exitCode === null) run.child.kill('SIGKILL')
    await run.child.exited
    await run.output
  }
}, 20_000)

test('empty discovery fails before building and nonsense flags launch nothing', async () => {
  const { root } = fixture()
  rmSync(join(root, 'test/e2e'), { recursive: true })
  mkdirSync(join(root, 'test/e2e'))
  expect((await finish(launch(root))).code).not.toBe(0)
  expect(events(root)).toEqual([])
  expect(report(root).data.error).toContain('Empty')
  expect((await finish(launch(root, 'success', ['e2e', '--workers', 'garbage']))).code).not.toBe(0)
  expect(events(root)).toEqual([])
})

test.each([
  ['build-hang', 'build', 1, 'SIGINT'],
  ['create-hang', 'create', 1, 'SIGTERM'],
  ['worker-hang', 'start', 2, 'SIGTERM'],
] as const)(
  'cancellation reaps children and cleans only owned names: %s',
  async (scenario, stage, workers, signal) => {
    const { root } = fixture()
    const run = launch(root, scenario, ['e2e', '--workers', String(workers)])
    try {
      const deadline = performance.now() + 8000
      while (events(root).filter((event) => event.args[0] === stage).length < workers) {
        if (performance.now() > deadline) throw new Error(`Never reached ${stage}`)
        await Bun.sleep(20)
      }
      run.child.kill(signal)
      const result = await finish(run)
      expect(result.code, result.stdout + result.stderr).toBe(signal === 'SIGINT' ? 130 : 143)
      const { data } = report(root)
      expect(data.signal).toBe(result.code)
      const commands = events(root)
      const names = commands
        .filter((event) => event.args[0] === 'create')
        .map((event) => event.args[event.args.indexOf('--name') + 1])
      expect(
        commands
          .filter((event) => event.args[0] === 'rm')
          .map((event) => event.args.at(-1))
          .sort(),
      ).toEqual(names.map((name) => containerID(name!)).sort())
      expect(
        readdirSync(join(root, 'fake-state')).filter((path) => path.endsWith('.json')),
      ).toEqual([])
      for (const event of commands) expect(() => process.kill(event.pid, 0)).toThrow()
    } finally {
      if (run.child.exitCode === null) run.child.kill('SIGKILL')
      await run.child.exited
      await run.output
    }
  },
  20_000,
)
