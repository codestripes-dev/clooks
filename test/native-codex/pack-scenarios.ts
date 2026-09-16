import { createHash } from 'node:crypto'
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { startFixture, type CapturedRequest } from './fixture-server'
import { requireSuccess, requireThat, run, save, sha256, type PackCaseId } from './harness'

// Source-derived fixture metadata, not a hosted-model capability claim.
export const packCatalog = {
  models: [
    {
      slug: 'gpt-5.1-codex',
      display_name: 'Native fixture',
      supported_reasoning_levels: [],
      shell_type: 'unified_exec',
      visibility: 'none',
      supported_in_api: true,
      priority: 99,
      support_verbosity: false,
      apply_patch_tool_type: 'freeform',
      truncation_policy: { mode: 'bytes', limit: 10000 },
      experimental_supported_tools: [],
      context_window: 272000,
      base_instructions: 'Execute the scripted tool call.',
    },
  ],
}
export const readToken = 'pack-read-effect-28471\n'
export function packCommand(id: PackCaseId) {
  if (id === 'PACK-SHELL-READ') return 'cat owned/readable.txt'
  const target = id === 'PACK-PATCH-DENY' ? 'nested/bun.lock' : 'editable.txt'
  return `*** Begin Patch\n*** Add File: owned/safe-companion.txt\n+safe\n*** Update File: owned/${target}\n@@\n-before\n+after\n*** End Patch\n`
}
export function packCallId(id: PackCaseId) {
  return id.toLowerCase().replaceAll('-', '_')
}
export type Tree = Record<string, string>
export function snapshotTree(root: string): Tree {
  const result: Tree = {}
  function visit(dir: string, prefix: string) {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      const relative = prefix + name
      const stat = lstatSync(path)
      requireThat(stat.isDirectory() || stat.isFile(), 'Unexpected target tree entry')
      result[relative] = stat.isDirectory() ? 'directory' : readFileSync(path).toString('base64')
      if (stat.isDirectory()) visit(path, relative + '/')
    }
  }
  visit(root, '')
  return result
}
export interface PackObservation {
  payloads: any[]
  requests: CapturedRequest[]
  state: any
  before: Tree
  after: Tree
}
export function assertPackObservation(id: PackCaseId, observed: PackObservation) {
  const { payloads, requests, state, before, after } = observed
  const shell = id === 'PACK-SHELL-READ'
  const denied = id === 'PACK-PATCH-DENY'
  const call = packCallId(id)
  const command = packCommand(id)
  requireThat(requests.length === 2, 'Wrong pack request count')
  requireThat(
    requests[0]!.body?.tools?.some(
      (tool: any) => tool.type === 'custom' && tool.name === 'apply_patch',
    ),
    'Missing real apply_patch advertisement',
  )
  const pre = payloads.filter((p) => p.hook_event_name === 'PreToolUse')
  const post = payloads.filter((p) => p.hook_event_name === 'PostToolUse')
  requireThat(
    pre.length === 1 &&
      pre[0].tool_use_id === call &&
      pre[0].tool_name === (shell ? 'Bash' : 'apply_patch') &&
      pre[0].tool_input?.command === command,
    'Mismatched pack PreToolUse input or call ID',
  )
  requireThat(
    typeof pre[0].session_id === 'string' &&
      pre[0].session_id.length > 0 &&
      payloads.every((p) => p.session_id === pre[0].session_id),
    'Mismatched pack session',
  )
  const name = shell ? 'prefer-builtin-tools' : 'no-edit-protected'
  const records = state?.scopes?.main?.[name]
  requireThat(
    Array.isArray(records) &&
      records.filter((r: any) => r.event === 'PreToolUse').length === 1 &&
      records.some(
        (r: any) => r.event === 'PreToolUse' && r.decision === (denied ? 'block' : 'skip'),
      ),
    'Missing actual pack decision',
  )
  requireThat(
    Object.values(state.scopes).every((scope: any) =>
      Object.values(scope).every(
        (rs: any) => Array.isArray(rs) && rs.every((r: any) => r.decision !== 'error'),
      ),
    ),
    'Pack error receipt',
  )
  const outputs =
    requests[1]!.body?.input?.filter(
      (item: any) =>
        item.type === 'custom_tool_call_output' || item.type === 'function_call_output',
    ) ?? []
  requireThat(
    outputs.length === 1 &&
      outputs[0].call_id === call &&
      outputs[0].type === (shell ? 'function_call_output' : 'custom_tool_call_output') &&
      typeof outputs[0].output === 'string',
    'Mismatched pack feedback type or call ID',
  )
  const output: string = outputs[0].output
  const encode = (s: string) => Buffer.from(s).toString('base64')
  const expectedBefore: Tree = shell
    ? { 'readable.txt': encode(readToken) }
    : denied
      ? { nested: 'directory', 'nested/bun.lock': encode('before\n') }
      : { 'editable.txt': encode('before\n') }
  const equal = (a: Tree, b: Tree) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())
  requireThat(equal(before, expectedBefore), 'Wrong target preimage')
  if (denied) {
    requireThat(post.length === 0, 'Denied patch emitted PostToolUse')
    requireThat(
      output.startsWith(
        'Command blocked by PreToolUse hook: [no-edit-protected] Blocked: owned/nested/bun.lock\nRule: lock-files\n',
      ) &&
        output.includes('This is a lock file managed by your package manager.') &&
        output.endsWith(`. Command: ${command}`),
      'Missing protected-path denial feedback',
    )
    requireThat(equal(after, before), 'Denied patch changed target tree')
  } else {
    requireThat(
      post.length === 1 &&
        post[0].tool_use_id === call &&
        post[0].tool_input?.command === command &&
        typeof post[0].tool_response === 'string',
      'Missing pack PostToolUse input or call ID',
    )
    if (shell) {
      requireThat(
        output.includes('Process exited with code 0') &&
          output.includes(readToken.trim()) &&
          post[0].tool_response.includes(readToken.trim()),
        'Missing real shell read result',
      )
      requireThat(equal(after, before), 'Read changed target tree')
    } else {
      requireThat(
        output.includes('Exit code: 0') &&
          output.includes('Success. Updated the following files:') &&
          output.includes('A owned/safe-companion.txt') &&
          output.includes('M owned/editable.txt') &&
          post[0].tool_response.includes('Success. Updated the following files:'),
        'Missing native patch success',
      )
      requireThat(
        equal(after, {
          'editable.txt': encode('after\n'),
          'safe-companion.txt': encode('safe\n'),
        }),
        'Patch success effects mismatch',
      )
    }
  }
}

export async function packScenario(id: PackCaseId, logRoot: string) {
  const logs = join(logRoot, id)
  mkdirSync(logs)
  const base = mkdtempSync('/tmp/clooks-native-pack-')
  const home = join(base, 'home'),
    codexHome = join(base, 'codex-home'),
    project = join(base, 'project')
  const payloadDir = join(logs, 'payloads')
  for (const path of [home, codexHome, project, payloadDir, join(project, 'owned')])
    mkdirSync(path, path === home ? { mode: 0o700 } : {})
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
  const shell = id === 'PACK-SHELL-READ'
  const item = shell
    ? {
        type: 'function_call',
        call_id: packCallId(id),
        name: 'exec_command',
        arguments: JSON.stringify({
          cmd: packCommand(id),
          workdir: project,
          yield_time_ms: 1000,
          max_output_tokens: 1000,
        }),
      }
    : {
        type: 'custom_tool_call',
        call_id: packCallId(id),
        name: 'apply_patch',
        input: packCommand(id),
      }
  const server = startFixture(
    [
      item,
      {
        type: 'message',
        role: 'assistant',
        id: 'pack_done',
        content: [{ type: 'output_text', text: 'done' }],
      },
    ],
    logs,
  )
  const clooksSha256 = sha256('/app/dist/clooks')
  try {
    const init = await run(
      ['/app/dist/clooks', 'init', '--agent', 'codex', '--json'],
      project,
      env,
      join(logs, 'init'),
      15000,
    )
    requireSuccess(init)
    requireThat(JSON.parse(init.stdout).ok === true, 'Generated pack init failed')
    cpSync(join(project, '.codex/hooks.json'), join(logs, 'generated-hooks.json'))
    cpSync(join(project, '.clooks/bin/entrypoint.sh'), join(logs, 'generated-entrypoint.sh'))
    const config: Record<string, unknown> = { version: '1.0.0' }
    const sources: Record<string, string> = {}
    for (const [name, pack] of [
      ['prefer-builtin-tools', 'clooks-core-hooks'],
      ['no-edit-protected', 'clooks-project-hooks'],
    ] as const) {
      const relative = `.clooks/vendor/plugin/${pack}`
      mkdirSync(join(project, relative), { recursive: true })
      for (const file of [`${name}.ts`, 'types.d.ts']) {
        const source = join('/app', relative, file),
          destination = join(project, relative, file)
        cpSync(source, destination)
        sources[`${relative}/${file}`] = sha256(source)
        requireThat(sha256(destination) === sha256(source), 'Pack source copy mismatch')
      }
      config[name] = { uses: `./${relative}/${name}.ts` }
    }
    save(join(logs, 'sources.json'), sources)
    writeFileSync(join(project, '.clooks/clooks.yml'), JSON.stringify(config))
    if (shell) writeFileSync(join(project, 'owned/readable.txt'), readToken)
    else if (id === 'PACK-PATCH-DENY') {
      mkdirSync(join(project, 'owned/nested'))
      writeFileSync(join(project, 'owned/nested/bun.lock'), 'before\n')
    } else writeFileSync(join(project, 'owned/editable.txt'), 'before\n')
    const before = snapshotTree(join(project, 'owned'))
    save(join(logs, 'before.json'), before)
    save(join(codexHome, 'models.json'), packCatalog)
    cpSync(join(codexHome, 'models.json'), join(logs, 'models.json'))
    save(join(logs, 'catalog-hash.json'), {
      sha256: sha256(join(codexHome, 'models.json')),
    })
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
        'danger-full-access',
        'Run the scripted tool once, then finish.',
      ],
      project,
      env,
      join(logs, 'native'),
      60000,
    )
    const after = snapshotTree(join(project, 'owned'))
    save(join(logs, 'after.json'), after)
    const payloads = readdirSync(payloadDir)
      .sort()
      .map((file) => JSON.parse(readFileSync(join(payloadDir, file), 'utf8')))
    const session = payloads.find((p) => p.hook_event_name === 'PreToolUse')?.session_id
    requireThat(typeof session === 'string' && session.length > 0, 'Missing pack session ID')
    const statePath = join(
      home,
      '.clooks/turn-state/codex',
      createHash('sha256').update(session).digest('hex').slice(0, 16) + '.json',
    )
    writeFileSync(join(logs, 'turn-state.json'), readFileSync(statePath), {
      flag: 'wx',
      mode: 0o644,
    })
    requireThat(
      sha256(statePath) === sha256(join(logs, 'turn-state.json')),
      'Turn receipt copy mismatch',
    )
    const observed = {
      payloads,
      requests: server.requests,
      state: JSON.parse(readFileSync(statePath, 'utf8')),
      before,
      after,
    }
    save(join(logs, 'observed.json'), observed)
    requireSuccess(result)
    server.assertComplete()
    assertPackObservation(id, observed)
    requireThat(sha256('/app/dist/clooks') === clooksSha256, 'Clooks changed during pack case')
    save(join(logs, 'passed.json'), {
      id,
      status: 'passed',
      clooksSha256,
      evidence: 'native CLI with synthetic model/catalog and actual packs',
      limitations: [
        'synthetic project trust',
        'hook-trust bypass',
        'danger-full-access',
        'inline transport only',
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
