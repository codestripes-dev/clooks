import { join, dirname } from 'path'
import { createSandbox, type Sandbox } from './sandbox'

export function createRegistrationSandbox(): Sandbox {
  const sandbox = createSandbox()
  const run = sandbox.run.bind(sandbox)
  const runAsync = sandbox.runAsync.bind(sandbox)
  sandbox.run = (args, opts) =>
    run(args, {
      ...opts,
      timeout: opts?.timeout ?? 10_000,
      env: { ...registrationEnv(sandbox), ...opts?.env },
    })
  sandbox.runAsync = (args, opts) =>
    runAsync(args, {
      ...opts,
      timeout: opts?.timeout ?? 10_000,
      env: { ...registrationEnv(sandbox), ...opts?.env },
    })
  sandbox.runEntrypoint = (opts) => {
    const result = Bun.spawnSync(['/bin/bash', join(sandbox.dir, '.clooks/bin/entrypoint.sh')], {
      cwd: sandbox.dir,
      stdin: Buffer.from(opts?.stdin ?? ''),
      env: { ...registrationEnv(sandbox), ...opts?.env },
      timeout: 10_000,
    })
    return {
      exitCode: result.exitCode ?? 2,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    }
  }
  return sandbox
}

export function registrationEnv(sandbox: Sandbox): Record<string, string> {
  return {
    HOME: sandbox.home,
    CLOOKS_HOME_ROOT: sandbox.home,
    CODEX_HOME: join(sandbox.home, '.codex'),
    PATH: join(dirname(sandbox.dir), 'bin') + ':/usr/local/bin:/usr/bin:/bin',
  }
}
