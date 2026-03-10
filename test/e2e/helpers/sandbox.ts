import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, symlinkSync, chmodSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Path to the compiled binary. Must run `bun run build` before E2E tests.
const CLOOKS_BIN = join(import.meta.dir, '../../../dist/clooks')

export interface RunResult {
  /** Exit code. Null (signal-killed process) is coerced to 2 (fail-closed). */
  exitCode: number
  stdout: string
  stderr: string
}

export interface Sandbox {
  /** Absolute path to the temporary project directory. */
  dir: string
  /** Absolute path to the fake HOME directory (sibling of project dir). */
  home: string
  run(args: string[], opts?: { stdin?: string; env?: Record<string, string>; timeout?: number; cwd?: string }): RunResult
  runEntrypoint(opts?: { stdin?: string; env?: Record<string, string> }): RunResult
  writeFile(relativePath: string, content: string): void
  writeConfig(yamlContent: string): void
  writeHook(filename: string, content: string): void
  writeEntrypoint(scriptContent: string): void
  writeHomeConfig(yamlContent: string): void
  writeHomeHook(filename: string, content: string): void
  writeStubBinary(scriptContent: string): void
  removeClooksBinary(): void
  /** Restore the clooks binary symlink after it was removed. */
  restoreBinary(): void
  readFile(relativePath: string): string
  fileExists(relativePath: string): boolean
  writeHomeFile(relativePath: string, content: string): void
  writeLocalConfig(yamlContent: string): void
  readHomeFile(relativePath: string): string
  homeFileExists(relativePath: string): boolean
  cleanup(): void
}

export function createSandbox(): Sandbox {
  if (process.env.CLOOKS_E2E_DOCKER !== 'true') {
    throw new Error(
      'E2E tests must run inside Docker for hermetic isolation.\n' +
      'Run: bun run test:e2e\n' +
      'To bypass (local debugging only): CLOOKS_E2E_DOCKER=true bun test test/e2e/'
    )
  }

  if (!existsSync(CLOOKS_BIN)) {
    throw new Error(`E2E: compiled binary not found at ${CLOOKS_BIN}. Run 'bun run build' first.`)
  }

  const base = mkdtempSync(join(tmpdir(), 'clooks-e2e-'))
  const dir = join(base, 'project')
  const home = join(base, 'home')
  mkdirSync(dir, { recursive: true })
  mkdirSync(home, { recursive: true })

  // Put the compiled binary on PATH so the entrypoint finds it via `command -v clooks`.
  const binDir = join(base, 'bin')
  mkdirSync(binDir, { recursive: true })

  try {
    symlinkSync(CLOOKS_BIN, join(binDir, 'clooks'))
  } catch {
    cpSync(CLOOKS_BIN, join(binDir, 'clooks'))
  }
  chmodSync(join(binDir, 'clooks'), 0o755)

  const sandboxPath = binDir + ':' + '/usr/local/bin:/usr/bin:/bin'

  const sandbox: Sandbox = {
    dir,
    home,

    run(args, opts) {
      const proc = Bun.spawnSync([CLOOKS_BIN, ...args], {
        cwd: opts?.cwd ?? dir,
        stdin: opts?.stdin !== undefined ? Buffer.from(opts.stdin) : undefined,
        env: { HOME: home, CLOOKS_HOME_ROOT: home, PATH: sandboxPath, ...opts?.env },
        ...(opts?.timeout ? { timeout: opts.timeout } : {}),
      })
      return {
        exitCode: proc.exitCode ?? 2,
        stdout: proc.stdout.toString(),
        stderr: proc.stderr.toString(),
      }
    },

    runEntrypoint(opts) {
      const entrypointPath = join(dir, '.clooks', 'bin', 'entrypoint.sh')
      const proc = Bun.spawnSync(['bash', entrypointPath], {
        cwd: dir,
        stdin: opts?.stdin !== undefined ? Buffer.from(opts.stdin) : undefined,
        env: {
          HOME: home,
          CLOOKS_HOME_ROOT: home,
          PATH: sandboxPath,
          ...opts?.env,
        },
      })
      return {
        exitCode: proc.exitCode ?? 2,
        stdout: proc.stdout.toString(),
        stderr: proc.stderr.toString(),
      }
    },

    writeFile(relativePath, content) {
      const fullPath = join(dir, relativePath)
      mkdirSync(join(fullPath, '..'), { recursive: true })
      writeFileSync(fullPath, content)
    },

    writeConfig(yamlContent) {
      sandbox.writeFile('.clooks/clooks.yml', yamlContent)
    },

    writeHook(filename, content) {
      sandbox.writeFile(join('.clooks', 'hooks', filename), content)
    },

    writeEntrypoint(scriptContent) {
      const entrypointPath = join(dir, '.clooks', 'bin', 'entrypoint.sh')
      mkdirSync(join(entrypointPath, '..'), { recursive: true })
      writeFileSync(entrypointPath, scriptContent, { mode: 0o755 })
    },

    writeHomeConfig(yamlContent) {
      const configPath = join(home, '.clooks', 'clooks.yml')
      mkdirSync(join(configPath, '..'), { recursive: true })
      writeFileSync(configPath, yamlContent)
    },

    writeHomeHook(filename, content) {
      const hookPath = join(home, '.clooks', 'hooks', filename)
      mkdirSync(join(hookPath, '..'), { recursive: true })
      writeFileSync(hookPath, content)
    },

    writeStubBinary(scriptContent) {
      const binaryPath = join(binDir, 'clooks')
      rmSync(binaryPath, { force: true })
      writeFileSync(binaryPath, scriptContent, { mode: 0o755 })
    },

    removeClooksBinary() {
      rmSync(join(binDir, 'clooks'), { force: true })
    },

    restoreBinary() {
      const binaryPath = join(binDir, 'clooks')
      rmSync(binaryPath, { force: true })
      try {
        symlinkSync(CLOOKS_BIN, binaryPath)
      } catch {
        cpSync(CLOOKS_BIN, binaryPath)
      }
      chmodSync(binaryPath, 0o755)
    },

    readFile(relativePath) {
      return readFileSync(join(dir, relativePath), 'utf8')
    },

    fileExists(relativePath) {
      return existsSync(join(dir, relativePath))
    },

    writeHomeFile(relativePath, content) {
      const fullPath = join(home, relativePath)
      mkdirSync(join(fullPath, '..'), { recursive: true })
      writeFileSync(fullPath, content)
    },

    writeLocalConfig(yamlContent) {
      sandbox.writeFile('.clooks/clooks.local.yml', yamlContent)
    },

    readHomeFile(relativePath) {
      return readFileSync(join(home, relativePath), 'utf8')
    },

    homeFileExists(relativePath) {
      return existsSync(join(home, relativePath))
    },

    cleanup() {
      rmSync(base, { recursive: true, force: true })
    },
  }

  return sandbox
}
