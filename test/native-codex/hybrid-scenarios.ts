import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { startFixture, type CapturedRequest } from './fixture-server'
import { packCatalog, snapshotTree, type Tree } from './pack-scenarios'
import { requireSuccess, requireThat, run, save, sha256, type HybridCaseId } from './harness'

export function nativeFeedback(request: CapturedRequest, call: string, shell: boolean): string {
  const outputs =
    request.body?.input?.filter(
      (item: any) =>
        item?.call_id === call &&
        item.role === undefined &&
        ['function_call_output', 'custom_tool_call_output'].includes(item.type),
    ) ?? []
  requireThat(
    outputs.length === 1 &&
      outputs[0].type === (shell ? 'function_call_output' : 'custom_tool_call_output') &&
      typeof outputs[0].output === 'string',
    'Missing exact native feedback',
  )
  return outputs[0].output
}

export function pendingToken(output: string, alias: string, reason: string): string {
  requireThat(
    output.startsWith(`Command blocked by PreToolUse hook: Hook "${alias}": `) &&
      output.includes(reason) &&
      output.includes('Ask the user and wait for explicit approval.'),
    'Missing attributed pending confirmation',
  )
  const matches = [...output.matchAll(/^Approval token: (ca1_[a-f0-9]{64})$/gm)]
  requireThat(
    matches.length === 1 && /^Expires: \d{4}-\d\d-\d\dT.*Z$/m.test(output),
    'Missing unique pending token or expiry',
  )
  return matches[0]![1]!
}

export function assertTree(actual: Tree, expected: Tree) {
  const sorted = (tree: Tree) => JSON.stringify(Object.entries(tree).sort())
  requireThat(sorted(actual) === sorted(expected), 'Hybrid target tree mismatch')
}

export function assertNativeRewrite(
  output: string,
  shell: boolean,
  denied: boolean,
  consumed: boolean,
  actual: Tree,
  before: Tree,
  permitted: Tree,
) {
  requireThat(consumed, 'Rewrite never passed hybrid approval consumption')
  requireThat(
    !output.includes('Command blocked by PreToolUse hook:'),
    'Hook denial is not native permission evidence',
  )
  if (denied) {
    requireThat(
      shell
        ? output.includes('policy forbids commands starting with `touch owned/rewritten`')
        : output.includes(
            'patch rejected: writing is blocked by read-only sandbox; rejected by user approval settings',
          ),
      'Missing native permission refusal',
    )
    requireThat(
      !output.includes(shell ? 'Process exited with code 0' : 'Exit code: 0'),
      'Denied rewrite reported success',
    )
    assertTree(actual, before)
  } else {
    requireThat(
      output.includes(
        shell ? 'Process exited with code 0' : 'Success. Updated the following files:',
      ),
      'Missing rewrite success feedback',
    )
    assertTree(actual, permitted)
  }
}

const encode = (text: string) => Buffer.from(text).toString('base64')
const done = {
  type: 'message',
  role: 'assistant',
  id: 'hybrid_done',
  content: [{ type: 'output_text', text: 'done' }],
}

interface RetryAttempt {
  call: string
  command: string
  shell: boolean
  phase: string
  output: string
  tree: Tree
}

export function assertRetryCaptures(
  payloads: any[],
  attempts: RetryAttempt[],
  replacement?: string,
): string {
  requireThat(attempts.length > 0, 'Missing retry attempts')
  const sessions = new Set<string>()
  requireThat(
    payloads.filter((p) => p.hook_event_name === 'PreToolUse').length === attempts.length,
    'Unexpected native tool invocation',
  )
  for (const attempt of attempts) {
    const pre = payloads.filter(
      (p) => p.hook_event_name === 'PreToolUse' && p.tool_use_id === attempt.call,
    )
    requireThat(
      pre.length === 1 &&
        pre[0].tool_name === (attempt.shell ? 'Bash' : 'apply_patch') &&
        pre[0].tool_input?.command === attempt.command,
      'Missing exact native retry PreToolUse',
    )
    requireThat(
      typeof pre[0].session_id === 'string' && pre[0].session_id.length > 0,
      'Missing retry session',
    )
    sessions.add(pre[0].session_id)
    const post = payloads.filter(
      (p) => p.hook_event_name === 'PostToolUse' && p.tool_use_id === attempt.call,
    )
    if (['pending', 'replay', 'native-denied', 'original-control'].includes(attempt.phase)) {
      requireThat(post.length === 0, 'Refused retry emitted PostToolUse')
    } else {
      requireThat(
        ['permitted', 'register', 'registration-replay'].includes(attempt.phase),
        'Unknown retry phase',
      )
      requireThat(
        post.length === 1 &&
          post[0].tool_name === (attempt.shell ? 'Bash' : 'apply_patch') &&
          post[0].tool_input?.command ===
            (replacement && attempt.phase === 'permitted' ? replacement : attempt.command) &&
          typeof post[0].tool_response === 'string',
        'Missing exact completed retry PostToolUse',
      )
      if (attempt.phase === 'registration-replay')
        requireThat(
          post[0].tool_response.includes('Unknown, expired or consumed approval token'),
          'Missing failed CLI response',
        )
    }
  }
  requireThat(
    payloads
      .filter((p) => p.hook_event_name === 'PostToolUse')
      .every((p) => attempts.some((a) => a.call === p.tool_use_id)),
    'Unattributed native PostToolUse',
  )
  requireThat(sessions.size === 1, 'Retries left the native session')
  return [...sessions][0]!
}

// Each callback observes native feedback and disk effects before issuing the next assistant call.
export async function hybridScenario(id: HybridCaseId, logRoot: string) {
  const logs = join(logRoot, id)
  mkdirSync(logs)
  const base = mkdtempSync('/tmp/clooks-native-hybrid-')
  const home = join(base, 'home'),
    codexHome = join(base, 'codex-home'),
    project = join(base, 'project')
  const owned = join(project, 'owned'),
    payloadDir = join(logs, 'payloads')
  for (const path of [home, codexHome, project, owned, payloadDir]) mkdirSync(path)
  const env: Record<string, string> = {
    HOME: home,
    CODEX_HOME: codexHome,
    CODEX_SQLITE_HOME: codexHome,
    CLOOKS_HOME_ROOT: home,
    CLOOKS_DEBUG: 'true',
    CLOOKS_LOGDIR: payloadDir,
    PATH: '/app/dist:/native/bin:/native/codex-path:/usr/local/bin:/usr/bin:/bin',
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    TERM: 'dumb',
  }
  const shell = id.includes('SHELL'),
    rewrite = id.includes('REWRITE'),
    denied = id.endsWith('DENY')
  const command = shell
    ? rewrite
      ? 'touch owned/original'
      : 'rm -r owned/victim'
    : rewrite
      ? '*** Begin Patch\n*** End Patch\n'
      : '*** Begin Patch\n*** Add File: owned/original\n+native\n*** End Patch\n'
  const replacement = shell
    ? 'touch owned/rewritten'
    : '*** Begin Patch\n*** Add File: owned/rewritten\n+native\n*** End Patch\n'
  if (!rewrite && shell) {
    mkdirSync(join(owned, 'victim'))
    writeFileSync(join(owned, 'victim/keep.txt'), 'before\n')
  }
  const before = snapshotTree(owned)
  const permitted: Tree = shell
    ? rewrite
      ? { rewritten: encode('') }
      : {}
    : { [rewrite ? 'rewritten' : 'original']: encode('native\n') }
  const issued: string[] = []
  const attempts: RetryAttempt[] = []
  const sources: Record<string, string> = {}
  const clooksSha256 = sha256('/app/dist/clooks')
  const call = (number: number, cmd = command, isShell = shell) =>
    isShell
      ? {
          type: 'function_call',
          call_id: `hybrid_${number}`,
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd,
            workdir: project,
            yield_time_ms: 1000,
            max_output_tokens: 2000,
          }),
        }
      : { type: 'custom_tool_call', call_id: `hybrid_${number}`, name: 'apply_patch', input: cmd }
  const capture = (
    request: CapturedRequest,
    number: number,
    phase: string,
    cmd = command,
    isShell = shell,
  ) => {
    const output = nativeFeedback(request, `hybrid_${number}`, isShell)
    const tree = snapshotTree(owned)
    attempts.push({ call: `hybrid_${number}`, command: cmd, shell: isShell, phase, output, tree })
    save(join(logs, `step-${number}.json`), attempts.at(-1))
    return output
  }
  const rows = () => {
    const db = new Database(join(home, '.clooks/approvals/codex.sqlite'), { readonly: true })
    try {
      return issued.map(
        (token) => db.query('SELECT * FROM approvals WHERE token = ?').get(token) as any,
      )
    } finally {
      db.close()
    }
  }
  const assertConsumed = () => {
    const records = rows()
    save(join(logs, 'consumed.json'), records)
    return (
      records.length === 2 &&
      records.every((r) => r && r.acknowledgedAt !== null && r.consumedAt !== null)
    )
  }
  const alias = (index: number) => (!rewrite && shell ? `rm-${index}` : `ask-${index}`)
  const reason = (index: number) =>
    !rewrite && shell ? '[rm-rf-strict]' : `hybrid confirmation ${index}`
  const pending = (request: CapturedRequest, number: number, index: number, cmd = command) => {
    const output = capture(request, number, 'pending', cmd)
    assertTree(snapshotTree(owned), before)
    const token = pendingToken(output, alias(index), reason(index))
    requireThat(!issued.includes(token), 'Independent asks reused the same token')
    issued.push(token)
  }
  const inline = () => `CLOOKS_APPROVAL_TOKENS=${issued.join(',')} ${command}`
  const register = (index: number) => `/app/dist/clooks approve ${issued[index]} --json`
  const registered = (request: CapturedRequest, number: number, index: number) => {
    const output = capture(request, number, 'register', register(index), true)
    requireThat(
      output.includes('Process exited with code 0') &&
        output.includes('"ok":true') &&
        output.includes('"command":"approve"') &&
        output.includes(issued[index]!),
      'Compiled registration failed',
    )
    assertTree(snapshotTree(owned), before)
    const records = rows()
    requireThat(
      records[index]?.acknowledgedAt !== null && records.every((r) => r?.consumedAt === null),
      'Registration consumed target approvals',
    )
  }
  const helperRegister = async (index: number) => {
    const result = await run(
      ['/app/dist/clooks', 'approve', issued[index]!, '--json'],
      project,
      env,
      join(logs, `synthetic-user-register-${index}`),
      10000,
    )
    requireSuccess(result)
    const output = JSON.parse(result.stdout)
    requireThat(
      output.ok === true && output.command === 'approve' && output.data?.token === issued[index],
      'Synthetic user compiled CLI registration failed',
    )
    assertTree(snapshotTree(owned), before)
    requireThat(
      rows()[index]?.acknowledgedAt !== null && rows().every((r) => r?.consumedAt === null),
      'Synthetic user registration consumed target approvals',
    )
  }
  const permittedStep = (request: CapturedRequest, number: number, cmd: string) => {
    const output = capture(request, number, denied ? 'native-denied' : 'permitted', cmd)
    const consumed = assertConsumed()
    if (rewrite)
      assertNativeRewrite(output, shell, denied, consumed, snapshotTree(owned), before, permitted)
    else {
      requireThat(consumed, 'Two approvals were not consumed together')
      requireThat(
        output.includes(
          shell ? 'Process exited with code 0' : 'Success. Updated the following files:',
        ),
        'Missing permitted native effect feedback',
      )
      assertTree(snapshotTree(owned), permitted)
    }
  }
  // Empty original patch has a distinct native failure, so read-only refusal cannot
  // pass by dropping the rewrite. The newline-free control does not match the asking hook.
  const steps: unknown[] =
    !shell && rewrite
      ? [
          call(0, command.trimEnd()),
          (r: CapturedRequest) => {
            const output = capture(r, 0, 'original-control', command.trimEnd())
            requireThat(
              output.includes('patch rejected: empty patch') &&
                !output.includes('read-only sandbox'),
              'Original patch control did not reach its distinct native rejection',
            )
            assertTree(snapshotTree(owned), before)
            return call(1)
          },
        ]
      : [call(1)]
  if (shell) {
    steps.push((r: CapturedRequest) => {
      pending(r, 1, 1)
      return call(2, inline())
    })
    steps.push((r: CapturedRequest) => {
      pending(r, 2, 2, inline())
      requireThat(
        rows()[0]?.acknowledgedAt !== null && rows()[0]?.consumedAt === null,
        'First acknowledgement did not survive second ask',
      )
      return call(3, inline())
    })
    steps.push((r: CapturedRequest) => {
      permittedStep(r, 3, inline())
      // Restore only this disposable target so replay would have an observable effect.
      if (!rewrite) {
        mkdirSync(join(owned, 'victim'))
        writeFileSync(join(owned, 'victim/keep.txt'), 'before\n')
      }
      save(join(logs, 'replay-preimage.json'), snapshotTree(owned))
      return call(4, inline())
    })
    steps.push((r: CapturedRequest) => {
      const output = capture(r, 4, 'replay', inline())
      requireThat(
        output.startsWith('Command blocked by PreToolUse hook:') &&
          output.includes('Unknown, expired or consumed approval token'),
        'Consumed inline replay was not refused',
      )
      assertTree(snapshotTree(owned), rewrite && !denied ? permitted : before)
      return done
    })
  } else if (denied) {
    // A synthetic user runs the real CLI outside the read-only native shell sandbox.
    // HYBRID-PATCH independently covers agent-side CLI registration through native hooks.
    steps.push(async (r: CapturedRequest) => {
      pending(r, 1, 1)
      await helperRegister(0)
      return call(2)
    })
    steps.push(async (r: CapturedRequest) => {
      pending(r, 2, 2)
      await helperRegister(1)
      return call(3)
    })
    steps.push((r: CapturedRequest) => {
      permittedStep(r, 3, command)
      return call(4)
    })
    steps.push((r: CapturedRequest) => {
      const output = capture(r, 4, 'replay')
      requireThat(
        !issued.includes(pendingToken(output, alias(1), reason(1))),
        'Patch reused consumed approval',
      )
      assertTree(snapshotTree(owned), before)
      return done
    })
  } else {
    steps.push((r: CapturedRequest) => {
      pending(r, 1, 1)
      return call(2, register(0), true)
    })
    steps.push((r: CapturedRequest) => {
      registered(r, 2, 0)
      return call(3)
    })
    steps.push((r: CapturedRequest) => {
      pending(r, 3, 2)
      return call(4, register(1), true)
    })
    steps.push((r: CapturedRequest) => {
      registered(r, 4, 1)
      return call(5)
    })
    steps.push((r: CapturedRequest) => {
      permittedStep(r, 5, command)
      return call(6, register(0), true)
    })
    steps.push((r: CapturedRequest) => {
      const output = capture(r, 6, 'registration-replay', register(0), true)
      requireThat(
        output.includes('Process exited with code 1') &&
          output.includes('Unknown, expired or consumed approval token'),
        'Consumed registration replay was not refused',
      )
      assertTree(snapshotTree(owned), denied ? before : permitted)
      return call(7)
    })
    steps.push((r: CapturedRequest) => {
      const output = capture(r, 7, 'replay')
      const fresh = pendingToken(output, alias(1), reason(1))
      requireThat(!issued.includes(fresh), 'Replayed patch reused consumed approval')
      assertTree(snapshotTree(owned), denied ? before : permitted)
      return done
    })
  }
  const server = startFixture(steps, logs)
  try {
    const init = await run(
      ['/app/dist/clooks', 'init', '--agent', 'codex', '--json'],
      project,
      env,
      join(logs, 'init'),
      15000,
    )
    requireSuccess(init)
    requireThat(JSON.parse(init.stdout).ok === true, 'Hybrid generated init failed')
    for (const [source, target] of [
      ['.codex/hooks.json', 'generated-hooks.json'],
      ['.clooks/bin/entrypoint.sh', 'generated-entrypoint.sh'],
    ] as const)
      cpSync(join(project, source), join(logs, target))
    const config: Record<string, unknown> = {
      version: '1.0.0',
      PreToolUse: { order: [alias(1), alias(2)] },
    }
    let hookPath: string
    if (!rewrite && shell) {
      const relative = '.clooks/vendor/plugin/clooks-core-hooks'
      mkdirSync(join(project, relative), { recursive: true })
      for (const name of ['no-rm-rf.ts', 'types.d.ts']) {
        const path = join(relative, name)
        cpSync(join('/app', path), join(project, path))
        sources[path] = sha256(join('/app', path))
        requireThat(sha256(join(project, path)) === sources[path], 'Hybrid vendor copy mismatch')
      }
      hookPath = `./${relative}/no-rm-rf.ts`
    } else {
      hookPath = './.clooks/hooks/hybrid.ts'
      cpSync('/app/test/native-codex/hybrid-hook.ts', join(project, hookPath))
      sources[hookPath] = sha256(join(project, hookPath))
    }
    for (const index of [1, 2])
      config[alias(index)] = {
        uses: hookPath,
        handoff: false,
        maxFailures: 0,
        ...(!rewrite && shell ? {} : { config: { reason: reason(index) } }),
      }
    writeFileSync(join(project, '.clooks/clooks.yml'), JSON.stringify(config))
    env.CLOOKS_NATIVE_CASE_CONFIG = join(logs, 'hook-config.json')
    save(env.CLOOKS_NATIVE_CASE_CONFIG, {
      handlerLog: join(logs, 'handlers.jsonl'),
      command,
      ...(rewrite ? { replacement } : {}),
    })
    save(join(logs, 'sources.json'), sources)
    save(join(logs, 'before.json'), before)
    save(join(codexHome, 'models.json'), packCatalog)
    cpSync(join(codexHome, 'models.json'), join(logs, 'models.json'))
    if (shell && denied) {
      mkdirSync(join(codexHome, 'rules'))
      const rule = 'prefix_rule(pattern=["touch", "owned/rewritten"], decision="forbidden")\n'
      writeFileSync(join(codexHome, 'rules/policy.rules'), rule)
      writeFileSync(join(logs, 'policy.rules'), rule, { flag: 'wx' })
    }
    const toml = `model = "gpt-5.1-codex"
model_catalog_json = ${JSON.stringify(join(codexHome, 'models.json'))}
model_provider = "native_fixture"
approval_policy = "never"
[projects.${JSON.stringify(project)}]
trust_level = "trusted"
[features]
enable_request_compression = false
[model_providers.native_fixture]
name = "Native fixture"
base_url = "http://127.0.0.1:${server.port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 15000
[shell_environment_policy]
inherit = "all"
ignore_default_excludes = true
`
    writeFileSync(join(codexHome, 'config.toml'), toml)
    writeFileSync(join(logs, 'config.toml'), toml, { flag: 'wx' })
    const result = await run(
      [
        '/native/bin/codex',
        'exec',
        '--skip-git-repo-check',
        '--dangerously-bypass-hook-trust',
        '--json',
        '--sandbox',
        denied && !shell ? 'read-only' : 'danger-full-access',
        'Execute the synthetic approval retry sequence, then finish.',
      ],
      project,
      env,
      join(logs, 'native'),
      60000,
    )
    requireSuccess(result)
    server.assertComplete()
    const payloads = readdirSync(payloadDir)
      .sort()
      .map((file) => JSON.parse(readFileSync(join(payloadDir, file), 'utf8')))
    save(join(logs, 'observed.json'), { attempts, payloads, requests: server.requests })
    if (!shell)
      requireThat(
        server.requests[0]!.body.tools?.some(
          (t: any) => t.type === 'custom' && t.name === 'apply_patch',
        ),
        'Real patch tool not advertised',
      )
    const session = assertRetryCaptures(payloads, attempts, rewrite ? replacement : undefined)
    const statePath = join(
      home,
      '.clooks/turn-state/codex',
      createHash('sha256').update(session).digest('hex').slice(0, 16) + '.json',
    )
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    save(join(logs, 'turn-state.json'), state)
    for (const index of [1, 2]) {
      const records = state?.scopes?.main?.[alias(index)]
      requireThat(
        Array.isArray(records) &&
          records.filter((r: any) => r.event === 'PreToolUse' && r.decision === 'ask').length >=
            3 &&
          records.every((r: any) => r.decision !== 'error' && r.decision !== 'block'),
        'Missing actual asking hook history or unexpected hook failure',
      )
    }
    for (const [path, hash] of Object.entries(sources))
      requireThat(sha256(join(project, path)) === hash, 'Hook changed during retries')
    requireThat(sha256('/app/dist/clooks') === clooksSha256, 'Clooks changed during hybrid case')
    save(join(logs, 'passed.json'), {
      id,
      status: 'passed',
      clooksSha256,
      evidence: 'native CLI with synthetic model/catalog and explicit synthetic acknowledgements',
      limitations: [
        'synthetic project trust',
        'hook-trust bypass',
        'no human-consent proof',
        'exec forces approval never; no PermissionRequest coverage',
        denied && !shell
          ? 'read-only patch safety; synthetic-user CLI registration outside native tool'
          : 'danger-full-access',
        ...(denied && shell ? ['synthetic forbidden exec-policy rule'] : []),
      ],
    })
  } catch (error) {
    save(join(logs, 'failure.json'), {
      id,
      error: String(error),
      stack: error instanceof Error ? error.stack : null,
    })
    throw error
  } finally {
    await server.stop()
    rmSync(base, { recursive: true, force: true })
  }
}
