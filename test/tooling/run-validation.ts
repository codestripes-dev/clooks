import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import {
  freezeOnboardingInputs,
  verifyOnboardingInputs,
  type OnboardingInputs,
} from './onboarding-inputs'

const inputs = [
  'src',
  'test',
  'schemas',
  'scripts',
  'package.json',
  '.github/workflows/release.yml',
  'bun.lock',
  'tsconfig.json',
  'bunfig.toml',
  'hookcoverage.toml',
  '.clooks/vendor/plugin',
  '.dockerignore',
] as const
const mounts = inputs.filter((path) => path !== 'bun.lock' && path !== '.dockerignore')
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export interface SelectionFile {
  path: string
  bytes: number
}

const workerCounts = [1, 2, 4, 8, 16, 32] as const
export type WorkerCount = (typeof workerCounts)[number]

export function parseArgs(args: string[]): {
  mode: 'all' | 'e2e'
  workers: WorkerCount
  args: string[]
} {
  const [mode, ...rest] = args
  let workers: WorkerCount = 4
  const usage = () => {
    throw new Error(
      'Usage: bun test/tooling/run-validation.ts all|e2e [--workers 1|2|4|8|16|32] [Bun arguments for e2e]',
    )
  }
  if (mode !== 'all' && mode !== 'e2e') return usage()
  if (rest[0] === '--workers') {
    const count = workerCounts.find((value) => String(value) === rest[1])
    if (count === undefined) return usage()
    workers = count
    rest.splice(0, 2)
    if (rest[0] === '--workers') return usage()
  }
  if (mode === 'all' && rest.length) return usage()
  return { mode, workers: rest.length ? (1 as const) : workers, args: rest }
}

function walk(root: string, relative: string): string[] {
  const info = lstatSync(join(root, relative))
  if (info.isFile()) return [relative]
  if (!info.isDirectory()) throw new Error(`Unsupported input (not a regular file): ${relative}`)
  return readdirSync(join(root, relative))
    .sort(compare)
    .flatMap((name) => walk(root, `${relative}/${name}`))
}

export function discover(root: string): SelectionFile[] {
  return walk(root, 'test/e2e')
    .filter((path) => path.endsWith('.e2e.test.ts'))
    .map((path) => ({ path: `./${path}`, bytes: lstatSync(join(root, path)).size }))
}

export function partition(files: SelectionFile[], workers: WorkerCount): string[][] {
  if (!workerCounts.includes(workers)) throw new Error('Invalid worker count')
  if (files.length < workers) throw new Error('Empty discovery or worker selection')
  const seen = new Set<string>()
  for (const file of files) {
    if (
      !file.path.startsWith('./test/e2e/') ||
      !file.path.endsWith('.e2e.test.ts') ||
      /[\r\n\0]/.test(file.path) ||
      file.path
        .slice(2)
        .split('/')
        .some((part) => part === '' || part === '.' || part === '..') ||
      seen.has(file.path) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0
    ) {
      throw new Error(`Invalid or duplicate selection: ${file.path}`)
    }
    seen.add(file.path)
  }
  const groups: string[][] = Array.from({ length: workers }, () => [])
  const sizes = Array.from({ length: workers }, () => 0)
  for (const file of [...files].sort((a, b) => b.bytes - a.bytes || compare(a.path, b.path))) {
    let index = 0
    for (let candidate = 1; candidate < workers; candidate++) {
      if (
        sizes[candidate]! < sizes[index]! ||
        (sizes[candidate] === sizes[index] && groups[candidate]!.length < groups[index]!.length)
      )
        index = candidate
    }
    groups[index]!.push(file.path)
    sizes[index]! += file.bytes
  }
  for (const group of groups) group.sort(compare)
  if (groups.some((group) => group.length === 0)) throw new Error('Empty worker selection')
  return groups
}

export function verifySummary(log: string, expectedCount?: number) {
  const plain = log.replace(/\x1b\[[0-9;]*m/g, '')
  const summaries = [...plain.matchAll(/^Ran (\d+) tests? across (\d+) files?\. \[([^\]]+)\]$/gm)]
  const summary = summaries.at(-1)
  const passes = [...plain.matchAll(/^\s*(\d+) pass\s*$/gm)].at(-1)
  const failures = [...plain.matchAll(/^\s*(\d+) fail\s*$/gm)].at(-1)
  if (!summary || !passes || !failures) throw new Error('Missing Bun execution summary')
  const tests = Number(summary[1])
  const fileCount = Number(summary[2])
  if (
    tests < Number(passes[1]) ||
    tests === 0 ||
    Number(passes[1]) === 0 ||
    Number(failures[1]) !== 0
  ) {
    throw new Error('Zero tests or failing Bun summary')
  }
  if (fileCount === 0 || (expectedCount !== undefined && fileCount !== expectedCount)) {
    throw new Error('Executed file count differs from manifest')
  }
  return { tests, files: fileCount, passed: Number(passes[1]), bunElapsed: summary[3] }
}

export function verifyExecution(log: string, expected: string[]) {
  // Quiet-agent output is disabled only for full E2E workers. Require actual file/case
  // progress as well as the final summary; a selection manifest alone is not execution.
  const summary = verifySummary(log, expected.length)
  const plain = log.replace(/\x1b\[[0-9;]*m/g, '')
  if (expected.length === 0 || new Set(expected).size !== expected.length) {
    throw new Error('Invalid expected manifest')
  }
  const executed: { file: string; passed: number }[] = []
  for (const line of plain.split('\n')) {
    const header = line.match(/^(?:\.\/|\/app\/)?(test\/e2e\/[^\r\n]+\.e2e\.test\.ts):\s*$/)
    if (header) executed.push({ file: `./${header[1]}`, passed: 0 })
    else if (/^\s*(?:\(pass\)|\u2713) /.test(line)) {
      const current = executed.at(-1)
      if (!current) throw new Error('Passing case before any file header')
      current.passed++
    }
  }
  const headers = executed.map((file) => file.file).sort(compare)
  if (JSON.stringify(headers) !== JSON.stringify([...expected].sort(compare))) {
    throw new Error('Executed file headers differ from manifest')
  }
  if (
    executed.some((file) => file.passed === 0) ||
    executed.reduce((sum, file) => sum + file.passed, 0) !== summary.passed
  ) {
    throw new Error('Missing positive per-file execution or inconsistent pass count')
  }
  return { ...summary, executed }
}

export function verifyCoverage(lcov: string) {
  const records = lcov.split('end_of_record')
  if (records.pop()!.trim()) throw new Error('Incomplete LCOV record')
  let measuredEngine = false
  const files = records.map((record) => {
    const fields = record.trim().split('\n')
    const sources = fields.filter((line) => line.startsWith('SF:'))
    const file = sources[0]
      ?.slice(3)
      .replace(/^\/app\//, '')
      .replace(/^\.\//, '')
    const lines = fields.find((line) => line.startsWith('LF:'))?.slice(3)
    if (sources.length !== 1 || !file || !lines || !/^\d+$/.test(lines)) {
      throw new Error('Empty or invalid LCOV source record')
    }
    if (file.includes('.clooks/vendor/plugin/') || file.startsWith('test/tooling/')) {
      throw new Error('Unexpected coverage owner')
    }
    if (file.startsWith('src/') && Number(lines) > 0) measuredEngine = true
    return file
  })
  if (!measuredEngine || new Set(files).size !== files.length) {
    throw new Error('Missing engine coverage or duplicate LCOV sources')
  }
  return files
}

export function phaseTimings(log: string, bunElapsed?: string) {
  const trace = [...log.matchAll(/^__CLOOKS_VALIDATION_TRACE__ (\d+\.\d+) (.*)$/gm)]
  const startOf = (command: string) => {
    const line = trace.find((match) => match[2] === command)
    return line ? Number(line[1]) * 1000 : undefined
  }
  const typecheck = startOf('./node_modules/.bin/tsc --noEmit')
  const mkdir = startOf('mkdir -p dist')
  const compile = startOf(
    'bun build --compile --bytecode --format=esm --outfile dist/clooks src/cli.ts',
  )
  const test = trace.find((match) => match[2]?.startsWith('exec bun test '))
  const duration = bunElapsed?.match(/^(\d+(?:\.\d+)?)(ms|s)$/)
  return {
    typecheckMs: typecheck !== undefined && mkdir !== undefined ? mkdir - typecheck : null,
    compileMs: compile !== undefined && test ? Number(test[1]) * 1000 - compile : null,
    testMs: duration ? Number(duration[1]) * (duration[2] === 's' ? 1000 : 1) : null,
  }
}

export function sourceIdentity(root: string) {
  const hash = createHash('sha256')
  for (const path of inputs.flatMap((input) => walk(root, input)).sort(compare)) {
    const bytes = readFileSync(join(root, path))
    hash.update(JSON.stringify([path, bytes.length, lstatSync(join(root, path)).mode & 0o111]))
    hash.update(bytes)
  }
  return hash.digest('hex')
}

interface CommandResult {
  argv: string[]
  log: string
  code: number
  signal: NodeJS.Signals | null
  elapsedMs: number
  error?: string
  stdout?: string
}

interface WorkerResult {
  kind: 'e2e' | 'tooling' | 'coverage' | 'passthrough'
  name: string
  files: string[]
  args: string[]
  create?: CommandResult
  run?: CommandResult
  cleanup?: CommandResult
  inspect?: CommandResult
  containerID?: string
  execution?: ReturnType<typeof verifySummary> | ReturnType<typeof verifyExecution>
  coverageCopy?: CommandResult
  coveragePath?: string
  coverageFiles?: string[]
  timings?: ReturnType<typeof phaseTimings>
  error?: string
}

export async function runValidation(
  root: string,
  workers: WorkerCount,
  mode: 'all' | 'e2e' = 'e2e',
  args: string[] = [],
): Promise<number> {
  const started = performance.now()
  const attempts = join(root, 'tmp/isolated-e2e-workers')
  mkdirSync(attempts, { recursive: true })
  const attempt = mkdtempSync(join(attempts, 'run-'))
  const attemptID = randomUUID()
  chmodSync(attempt, 0o755)
  const report: {
    workers: number
    mode: string
    attemptID: string
    sourceHash?: string
    sourceHashAfter?: string
    onboarding?: { source: string; snapshot: string; manifest: OnboardingInputs }
    imageID?: string
    build?: CommandResult
    results: WorkerResult[]
    error?: string
    signal: number
    code: number
    elapsedMs: number
  } = { workers, mode, attemptID, results: [], signal: 0, code: 1, elapsedMs: 0 }
  const active = new Set<() => void>()
  const attempted = new Set<string>()
  let cancelled = 0
  const stop = (signal: number) => {
    if (cancelled) return
    cancelled = signal
    for (const terminate of active) terminate()
  }
  const onInt = () => stop(130)
  const onTerm = () => stop(143)
  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)

  async function command(
    argv: string[],
    label: string,
    timeoutMs: number,
    cleanup = false,
    captureStdout = false,
  ) {
    const log = join(attempt, `${label}.log`)
    writeFileSync(join(attempt, `${label}.argv.json`), JSON.stringify(argv, null, 2) + '\n')
    const fd = openSync(log, 'w')
    const began = performance.now()
    const result: CommandResult = { argv, log, code: 1, signal: null, elapsedMs: 0 }
    let stdout = ''
    try {
      if (cancelled && !cleanup) throw new Error('Cancelled before launch')
      await new Promise<void>((done) => {
        const child = spawn(argv[0]!, argv.slice(1), {
          cwd: root,
          stdio: ['ignore', captureStdout ? 'pipe' : fd, fd],
          detached: true,
        })
        let closed = false
        let terminating = false
        let escalated = false
        const finish = () => {
          if (!closed || (terminating && !escalated)) return
          clearTimeout(deadline)
          active.delete(terminate)
          done()
        }
        const terminate = () => {
          if (terminating) return
          terminating = true
          result.error = cancelled && !cleanup ? 'Cancelled' : 'Command deadline exceeded'
          try {
            if (child.pid) process.kill(-child.pid, 'SIGTERM')
          } catch {
            // The process group may already have exited.
          }
          // Keep escalation alive after the leader closes: descendants can ignore TERM
          // while retaining the leader's process group and inherited file descriptors.
          setTimeout(() => {
            try {
              if (child.pid) process.kill(-child.pid, 'SIGKILL')
            } catch {
              // ESRCH is expected when the entire group exited on TERM.
            }
            escalated = true
            finish()
          }, 2000)
        }
        const deadline = setTimeout(terminate, timeoutMs)
        if (!cleanup) active.add(terminate)
        if (captureStdout) {
          child.stdout!.on('data', (chunk: Buffer) => {
            writeSync(fd, chunk)
            if (Buffer.byteLength(stdout) + chunk.length > 65_536) {
              terminate()
              result.error = 'Structured stdout exceeded 64 KiB'
            } else {
              stdout += chunk.toString('utf8')
            }
          })
        }
        child.on('error', (error) => {
          result.error = error.message
        })
        child.on('close', (code, signal) => {
          closed = true
          result.code = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)
          result.signal = signal
          if (result.error && result.code === 0) result.code = 1
          finish()
        })
      })
    } catch (error) {
      result.error = String(error)
    } finally {
      closeSync(fd)
      result.elapsedMs = performance.now() - began
      if (captureStdout) {
        result.stdout = join(attempt, `${label}.stdout`)
        writeFileSync(result.stdout, stdout)
      }
      writeFileSync(join(attempt, `${label}.status.json`), JSON.stringify(result, null, 2) + '\n')
    }
    return result
  }

  async function cleanupWorker(worker: WorkerResult) {
    if (!attempted.delete(worker.name)) return
    try {
      worker.inspect = await command(
        ['docker', 'container', 'inspect', '--format', '{{json .}}', worker.name],
        `${worker.name}-inspect`,
        20_000,
        true,
        true,
      )
      if (worker.inspect.code !== 0)
        throw new Error(`Ownership inspection failed: ${worker.inspect.code}`)
      const container = JSON.parse(readFileSync(worker.inspect.stdout!, 'utf8')) as {
        Id?: string
        Config?: { Labels?: Record<string, string> }
      }
      if (
        container.Config?.Labels?.['clooks.validation.attempt'] !== attemptID ||
        !container.Id ||
        !/^[a-f0-9]{64}$/.test(container.Id)
      ) {
        throw new Error('Container ownership mismatch; refusing removal')
      }
      worker.containerID = container.Id
      worker.cleanup = await command(
        ['docker', 'rm', '-f', worker.containerID],
        `${worker.name}-cleanup`,
        20_000,
        true,
      )
      if (worker.cleanup.code !== 0) throw new Error(`Removal failed: ${worker.cleanup.code}`)
    } catch (error) {
      worker.error = `${worker.error ?? ''}\nCleanup failed: ${error}`
    }
  }

  async function runWorker(worker: WorkerResult) {
    const workerStarted = performance.now()
    report.results.push(worker)
    try {
      if (cancelled) throw new Error('Cancelled before worker launch')
      console.log(
        `Worker ${worker.name} starting: ${worker.kind}, ${worker.files.length} selected files`,
      )
      attempted.add(worker.name)
      const argv = [
        'docker',
        'create',
        '--pull',
        'never',
        '--name',
        worker.name,
        '--label',
        `clooks.validation.attempt=${attemptID}`,
        '--init',
        '--env',
        'PS4=__CLOOKS_VALIDATION_TRACE__ ${EPOCHREALTIME} ',
        '--entrypoint',
        '/usr/bin/env',
      ]
      for (const path of mounts) {
        argv.push('--mount', `type=bind,src=${join(root, path)},dst=/app/${path},readonly`)
      }
      if (report.onboarding) {
        argv.push(
          '--network',
          'none',
          '--mount',
          `type=bind,src=${report.onboarding.snapshot},dst=/onboarding-marketplace,readonly`,
          '--env',
          'CLOOKS_MARKETPLACE_ROOT=/onboarding-marketplace',
        )
      }
      argv.push(report.imageID!)
      if (worker.kind === 'e2e') argv.push('-u', 'CLAUDECODE', '-u', 'REPL_ID', '-u', 'AGENT')
      argv.push('/bin/bash', '-x', '/app/test/docker-entrypoint.sh', ...worker.args)
      worker.create = await command(argv, `${worker.name}-create`, 60_000)
      if (worker.create.code !== 0) throw new Error(`Worker create failed: ${worker.create.code}`)
      worker.run = await command(
        ['docker', 'start', '--attach', worker.name],
        `${worker.name}-run`,
        1_800_000,
      )
      const log = readFileSync(worker.run.log, 'utf8')
      worker.timings = phaseTimings(log)
      if (worker.kind === 'coverage') {
        worker.coveragePath = join(attempt, 'unit-lcov.info')
        worker.coverageCopy = await command(
          ['docker', 'cp', `${worker.name}:/app/coverage/unit/lcov.info`, worker.coveragePath],
          `${worker.name}-coverage-copy`,
          20_000,
        )
      }
      if (worker.run.code !== 0) throw new Error(`Worker failed: ${worker.run.code}`)
      worker.execution =
        worker.kind === 'e2e'
          ? verifyExecution(log, worker.files)
          : verifySummary(log, worker.kind === 'tooling' ? worker.files.length : undefined)
      if (worker.kind === 'coverage') {
        if (worker.coverageCopy?.code !== 0) throw new Error('Coverage artifact copy failed')
        worker.coverageFiles = verifyCoverage(readFileSync(worker.coveragePath!, 'utf8'))
      }
      worker.timings = phaseTimings(log, worker.execution.bunElapsed)
      if (Object.values(worker.timings).some((value) => value === null || value < 0)) {
        throw new Error('Missing or invalid phase timing evidence')
      }
    } catch (error) {
      worker.error = String(error)
    } finally {
      await cleanupWorker(worker)
      console.log(
        `Worker ${worker.name} finished: ${worker.error ? 'FAIL' : 'PASS'}, ` +
          `${((performance.now() - workerStarted) / 1000).toFixed(2)}s`,
      )
      if (worker.error) console.error(`Worker ${worker.name}: ${worker.error.trim()}`)
    }
  }

  console.log(`Validation artifacts: ${attempt}`)
  try {
    report.sourceHash = sourceIdentity(root)
    const marketplaceRoot = process.env.CLOOKS_MARKETPLACE_ROOT
    if (marketplaceRoot !== undefined) {
      if (!marketplaceRoot.trim())
        throw new Error('CLOOKS_MARKETPLACE_ROOT must be an explicit nonempty path')
      const source = resolve(root, marketplaceRoot)
      const snapshot = join(attempt, 'onboarding-marketplace')
      const manifest = freezeOnboardingInputs(source, snapshot)
      report.onboarding = { source, snapshot, manifest }
      writeFileSync(
        join(attempt, 'onboarding-inputs.json'),
        JSON.stringify(manifest, null, 2) + '\n',
      )
    }
    const files = args.length ? [] : discover(root)
    const groups = args.length ? [] : partition(files, workers)
    writeFileSync(join(attempt, 'manifest.json'), JSON.stringify({ files, groups }, null, 2) + '\n')
    const iidfile = join(attempt, 'image-id')
    console.log(`Build starting; ${files.length} E2E files, ${workers} worker(s)`)
    report.build = await command(
      [
        'docker',
        'build',
        '-t',
        'clooks-e2e',
        '--iidfile',
        iidfile,
        '-f',
        join(root, 'test/Dockerfile'),
        root,
      ],
      'build',
      600_000,
    )
    console.log(
      `Build finished: exit ${report.build.code}, ${(report.build.elapsedMs / 1000).toFixed(2)}s`,
    )
    if (report.build.code !== 0) throw new Error(`Build failed: ${report.build.code}`)
    report.imageID = readFileSync(iidfile, 'utf8').trim()
    if (!/^sha256:[a-f0-9]{64}$/.test(report.imageID)) throw new Error('Invalid build image ID')
    if (mode === 'all') {
      const toolingFiles = walk(root, 'test/tooling').filter((path) => path.endsWith('.test.ts'))
      if (toolingFiles.length === 0) throw new Error('Empty tooling selection')
      for (const kind of ['tooling', 'coverage'] as const) {
        const phase: WorkerResult = {
          kind,
          name: `clooks-validation-${attempt.split('/').at(-1)!}-${kind}`,
          files: kind === 'tooling' ? toolingFiles : [],
          args: kind === 'tooling' ? ['./test/tooling/'] : ['--coverage', 'src/'],
        }
        await runWorker(phase)
        if (phase.error || cancelled)
          throw new Error(`${kind} phase failed; later phases not started`)
      }
    }
    if (args.length) {
      await runWorker({
        kind: 'passthrough',
        name: `clooks-validation-${attempt.split('/').at(-1)!}-passthrough`,
        files: [],
        args,
      })
    } else {
      await Promise.all(
        groups.map((selection, index) =>
          runWorker({
            kind: 'e2e',
            name: `clooks-validation-${attempt.split('/').at(-1)!}-${index + 1}`,
            files: selection,
            args: workers === 1 ? ['./test/e2e/'] : selection,
          }),
        ),
      )
    }
    report.code = report.results.some((worker) => worker.error || !worker.execution) ? 1 : 0
  } catch (error) {
    report.error = String(error)
  } finally {
    for (const worker of report.results) await cleanupWorker(worker)
    if (report.onboarding) {
      try {
        verifyOnboardingInputs(report.onboarding.snapshot, report.onboarding.manifest)
      } catch (error) {
        report.error = `${report.error ?? ''}\nOnboarding snapshot verification failed: ${error}`
        report.code = 1
      }
    }
    try {
      report.sourceHashAfter = sourceIdentity(root)
      if (report.sourceHashAfter !== report.sourceHash) {
        report.error = `${report.error ?? ''}\nSource identity changed during validation; let input writers finish, then rerun the complete gate`
        report.code = 1
      }
    } catch (error) {
      report.error = `${report.error ?? ''}\nSource fingerprint failed: ${error}`
      report.code = 1
    }
    report.signal = cancelled
    if (cancelled) report.code = cancelled
    report.elapsedMs = performance.now() - started
    writeFileSync(join(attempt, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    process.off('SIGINT', onInt)
    process.off('SIGTERM', onTerm)
    console.log(`Validation exit ${report.code}; report: ${join(attempt, 'report.json')}`)
  }
  return report.code
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2))
    process.exitCode = await runValidation(
      resolve(import.meta.dir, '../..'),
      options.workers,
      options.mode,
      options.args,
    )
  } catch (error) {
    console.error(String(error))
    process.exitCode = 1
  }
}
