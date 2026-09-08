import { join, dirname } from 'path'
import { createSandbox, type Sandbox } from './sandbox'

export function createRegistrationSandbox(): Sandbox {
  const sandbox = createSandbox()
  const run = sandbox.run.bind(sandbox)
  const runAsync = sandbox.runAsync.bind(sandbox)
  const runEntrypoint = sandbox.runEntrypoint.bind(sandbox)
  sandbox.run = (args, opts) =>
    run(args, {
      ...opts,
      env: { CODEX_HOME: join(sandbox.home, '.codex'), ...opts?.env },
    })
  sandbox.runAsync = (args, opts) =>
    runAsync(args, {
      ...opts,
      env: { CODEX_HOME: join(sandbox.home, '.codex'), ...opts?.env },
    })
  sandbox.runEntrypoint = (opts) =>
    runEntrypoint({
      ...opts,
      env: { CODEX_HOME: join(sandbox.home, '.codex'), ...opts?.env },
    })
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
