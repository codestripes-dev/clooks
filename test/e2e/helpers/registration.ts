import { join, dirname } from 'path'
import { expect } from 'bun:test'
import { createSandbox, type Sandbox } from './sandbox'

export function expectPreToolUsePair(
  groups: unknown,
  provider: 'claude-code' | 'codex',
  baseCommand: string,
) {
  const entries = groups as Array<{ hooks: Array<{ input?: { owner?: unknown } }> }>
  const owner = entries[0]?.hooks.find((hook) => hook.input)?.input?.owner
  expect(owner).toMatch(/^(global|project:[a-f0-9]{32})$/)
  const agentPrefix = `CLOOKS_AGENT=${provider} `
  const launcher = baseCommand.startsWith(agentPrefix)
    ? baseCommand.slice(agentPrefix.length)
    : baseCommand
  expect(groups).toEqual([
    {
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: `CLOOKS_APPROVAL_PROTOCOL=1 CLOOKS_APPROVAL_OWNER=${owner} CLOOKS_APPROVAL_DISPOSITION=run ${agentPrefix}${launcher}`,
          timeout: 330,
        },
        {
          type: 'mcp_tool',
          server: 'clooks',
          tool: 'check',
          timeout: 330,
          input: {
            protocol: 1,
            provider,
            owner,
            session_id: '${session_id}',
            tool_use_id: '${tool_use_id}',
            ...(provider === 'codex' ? { turn_id: '${turn_id}' } : {}),
          },
        },
      ],
    },
  ])
}

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
    const started = performance.now()
    const result = Bun.spawnSync(['/bin/bash', join(sandbox.dir, '.clooks/bin/entrypoint.sh')], {
      cwd: sandbox.dir,
      stdin: Buffer.from(opts?.stdin ?? ''),
      env: { ...registrationEnv(sandbox), ...opts?.env },
      timeout: 10_000,
    })
    return {
      exitCode: result.exitCode ?? 2,
      rawExitCode: result.exitCode,
      signalCode: result.signalCode ?? null,
      elapsedMs: performance.now() - started,
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
