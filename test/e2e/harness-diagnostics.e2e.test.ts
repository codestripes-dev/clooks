import { afterEach, expect, test } from 'bun:test'
import { createSandbox, formatDiagnostics, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox | undefined
afterEach(() => sandbox?.cleanup())

test('diagnostic formatting retains raw status, signal, elapsed time and both streams', () => {
  const message = formatDiagnostics({
    exitCode: 2,
    rawExitCode: null,
    signalCode: 'SIGTERM',
    elapsedMs: 12.25,
    stdout: 'out marker',
    stderr: 'err marker',
  })
  expect(message).toBe(
    'Subprocess: exitCode=2, rawExitCode=null, signalCode=SIGTERM, elapsedMs=12.3\nstdout:\nout marker\nstderr:\nerr marker',
  )
})

test('compiled synchronous and asynchronous runs retain successful process metadata', async () => {
  sandbox = createSandbox()
  for (const result of [sandbox.run(['--version']), await sandbox.runAsync(['--version'])]) {
    expect(result.exitCode, formatDiagnostics(result)).toBe(0)
    expect(result.rawExitCode).toBe(0)
    expect(result.signalCode).toBeNull()
    expect(Number.isFinite(result.elapsedMs)).toBe(true)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(result.stdout.trim().length).toBeGreaterThan(0)
  }
})

test('compiled synchronous and asynchronous failures retain stderr and raw status', async () => {
  sandbox = createSandbox()
  for (const result of [
    sandbox.run(['--no-such-option']),
    await sandbox.runAsync(['--no-such-option']),
  ]) {
    expect(result.exitCode, formatDiagnostics(result)).not.toBe(0)
    expect(result.rawExitCode).toBe(result.exitCode)
    expect(result.signalCode).toBeNull()
    expect(result.stderr).toContain('unknown option')
  }
})

test.each([0, 7])('entrypoint retains child-selected exit %i', (code) => {
  sandbox = createSandbox()
  sandbox.writeEntrypoint(
    `#!/bin/bash\nprintf 'output marker'\nprintf 'error marker' >&2\nexit ${code}\n`,
  )
  const result = sandbox.runEntrypoint()
  expect(result.exitCode, formatDiagnostics(result)).toBe(code)
  expect(result.rawExitCode).toBe(code)
  expect(result.signalCode).toBeNull()
  expect(result.stdout).toBe('output marker')
  expect(result.stderr).toBe('error marker')
})

test('signal termination is visible in an actual failing assertion', () => {
  sandbox = createSandbox()
  sandbox.writeEntrypoint("#!/bin/bash\nprintf 'signal marker' >&2\nkill -TERM $$\n")
  const result = sandbox.runEntrypoint()
  expect(result.signalCode, formatDiagnostics(result)).toBe('SIGTERM')
  expect(result.exitCode).toBe(result.rawExitCode ?? 2)
  expect(result.stderr).toBe('signal marker')
  expect(Number.isFinite(result.elapsedMs)).toBe(true)
  expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
  let failure = ''
  try {
    expect(result.exitCode, formatDiagnostics(result)).toBe(0)
  } catch (error) {
    failure = String(error)
  }
  expect(failure).toContain('signalCode=SIGTERM')
  expect(failure).toContain(`rawExitCode=${result.rawExitCode}`)
  expect(failure).toContain('elapsedMs=')
  expect(failure).toContain('signal marker')
})
