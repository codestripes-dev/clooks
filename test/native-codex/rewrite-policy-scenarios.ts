import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startFixture, type CapturedRequest } from './fixture-server'
import {
  readCaptures,
  requireSuccess,
  requireThat,
  run,
  save,
  sha256,
  verifyMetadata,
  type RewritePolicyCaseId,
} from './harness'
import { nativeFeedback } from './native-feedback'
import { packCatalog, snapshotTree, type Tree } from './pack-scenarios'

export const shellOriginal = 'touch owned/original'
export const shellRewritten = 'touch owned/rewritten'
export const patchOriginal = '*** Begin Patch\n*** End Patch\n'
export const patchRewritten =
  '*** Begin Patch\n*** Add File: owned/rewritten\n+native\n*** End Patch\n'
export const shellPolicyRule =
  'prefix_rule(pattern=["touch", "owned/rewritten"], decision="forbidden")\n'
export const rewriteCallId = 'rewrite_policy_target'
export const patchControlCallId = 'rewrite_policy_control'

export interface RewritePolicyObservation {
  payloads: any[]
  handlers: any[]
  requests: CapturedRequest[]
  before: Tree
  after: Tree
  sandbox: 'danger-full-access' | 'read-only'
  policyRule?: string
}

function sameTree(actual: Tree, expected: Tree) {
  return (
    JSON.stringify(Object.entries(actual).sort()) ===
    JSON.stringify(Object.entries(expected).sort())
  )
}

export function assertRewritePolicyObservation(
  id: RewritePolicyCaseId,
  observed: RewritePolicyObservation,
) {
  const shell = id === 'REWRITE-SHELL-NATIVE-DENY'
  const original = shell ? shellOriginal : patchOriginal
  const rewritten = shell ? shellRewritten : patchRewritten
  const expectedSandbox = shell ? 'danger-full-access' : 'read-only'
  const expectedCalls = shell
    ? [{ id: rewriteCallId, command: original, decision: 'allow-rewrite' }]
    : [
        { id: patchControlCallId, command: patchOriginal.trimEnd(), decision: 'skip-control' },
        { id: rewriteCallId, command: original, decision: 'allow-rewrite' },
      ]

  requireThat(observed.sandbox === expectedSandbox, 'Wrong native rewrite sandbox')
  requireThat(
    shell ? observed.policyRule === shellPolicyRule : observed.policyRule === undefined,
    'Wrong native command policy boundary',
  )
  requireThat(
    sameTree(observed.before, {}) && sameTree(observed.after, observed.before),
    'Denied rewrite changed target tree',
  )
  requireThat(observed.requests.length === (shell ? 2 : 3), 'Wrong native rewrite request count')
  if (!shell)
    requireThat(
      observed.requests[0]!.body?.tools?.some(
        (tool: any) => tool.type === 'custom' && tool.name === 'apply_patch',
      ),
      'Real apply_patch tool not advertised',
    )

  const pre = observed.payloads.filter((payload) => payload.hook_event_name === 'PreToolUse')
  const post = observed.payloads.filter((payload) => payload.hook_event_name === 'PostToolUse')
  requireThat(pre.length === expectedCalls.length, 'Unexpected native rewrite invocation count')
  requireThat(post.length === 0, 'Native-denied rewrite emitted PostToolUse')
  const sessions = new Set<string>()
  for (const expected of expectedCalls) {
    const payload = pre.find((entry) => entry.tool_use_id === expected.id)
    requireThat(
      payload?.tool_name === (shell ? 'Bash' : 'apply_patch') &&
        payload.tool_input?.command === expected.command,
      'Original native rewrite input or identity mismatch',
    )
    requireThat(
      typeof payload.session_id === 'string' && payload.session_id.length > 0,
      'Missing native rewrite session identity',
    )
    sessions.add(payload.session_id)
    const handler = observed.handlers.filter((entry) => entry.callId === expected.id)
    requireThat(
      handler.length === 1 &&
        handler[0].toolName === (shell ? 'Bash' : 'apply_patch') &&
        handler[0].original === expected.command &&
        handler[0].decision === expected.decision &&
        (expected.decision === 'allow-rewrite'
          ? handler[0].updated === rewritten
          : handler[0].updated === undefined),
      'Rewrite hook decision or captured input mismatch',
    )
  }
  requireThat(sessions.size === 1, 'Native rewrite controls left the original session')

  if (!shell) {
    const control = nativeFeedback(observed.requests[1]!, patchControlCallId, false)
    requireThat(
      control.includes('patch rejected: empty patch') &&
        !control.includes('read-only sandbox') &&
        !control.includes('Success. Updated the following files:'),
      'Original patch control did not retain its distinct empty-patch refusal',
    )
  }
  const denied = nativeFeedback(observed.requests[shell ? 1 : 2]!, rewriteCallId, shell)
  requireThat(
    !denied.includes('Command blocked by PreToolUse hook:'),
    'Hook denial is not native permission evidence',
  )
  requireThat(
    shell
      ? denied.includes('policy forbids commands starting with `touch owned/rewritten`')
      : denied.includes(
          'patch rejected: writing is blocked by read-only sandbox; rejected by user approval settings',
        ),
    'Missing rewritten-operation native policy refusal',
  )
  requireThat(
    !denied.includes(shell ? 'Process exited with code 0' : 'Exit code: 0'),
    'Native-denied rewrite reported success',
  )
}

export async function rewritePolicyScenario(id: RewritePolicyCaseId, logRoot: string) {
  verifyMetadata(sha256('/native/bin/codex'))
  const shell = id === 'REWRITE-SHELL-NATIVE-DENY'
  const original = shell ? shellOriginal : patchOriginal
  const rewritten = shell ? shellRewritten : patchRewritten
  const sandbox = shell ? 'danger-full-access' : 'read-only'
  const logs = join(logRoot, id)
  mkdirSync(logs)
  const base = mkdtempSync('/tmp/clooks-native-rewrite-policy-')
  const home = join(base, 'home')
  const codexHome = join(base, 'codex-home')
  const project = join(base, 'project')
  const owned = join(project, 'owned')
  const payloadDir = join(logs, 'payloads')
  const handlerLog = join(logs, 'handlers.jsonl')
  for (const path of [home, codexHome, project, owned, payloadDir])
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
  const clooksSha256 = sha256('/app/dist/clooks')
  const toolCall = (callId: string, command: string) =>
    shell
      ? {
          type: 'function_call',
          call_id: callId,
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: command,
            workdir: project,
            yield_time_ms: 1000,
            max_output_tokens: 2000,
          }),
        }
      : { type: 'custom_tool_call', call_id: callId, name: 'apply_patch', input: command }
  const done = {
    type: 'message',
    role: 'assistant',
    id: 'rewrite_policy_done',
    content: [{ type: 'output_text', text: 'done' }],
  }
  const steps: unknown[] = shell
    ? [toolCall(rewriteCallId, original), done]
    : [
        toolCall(patchControlCallId, patchOriginal.trimEnd()),
        (request: CapturedRequest) => {
          nativeFeedback(request, patchControlCallId, false)
          requireThat(sameTree(snapshotTree(owned), {}), 'Patch control changed target tree')
          return toolCall(rewriteCallId, original)
        },
        done,
      ]
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
    requireThat(JSON.parse(init.stdout).ok === true, 'Rewrite-policy generated init failed')
    cpSync(join(project, '.codex/hooks.json'), join(logs, 'generated-hooks.json'))
    cpSync(join(project, '.clooks/bin/entrypoint.sh'), join(logs, 'generated-entrypoint.sh'))

    const fixturePath = join(logs, 'hook-config.json')
    save(fixturePath, { handlerLog, original, rewritten })
    env.CLOOKS_NATIVE_CASE_CONFIG = fixturePath
    const hook = `import { appendFileSync, readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync(process.env.CLOOKS_NATIVE_CASE_CONFIG, 'utf8'))
export const hook = {
  meta: { name: 'rewrite-native-policy' },
  PreToolUse(ctx) {
    const command = 'command' in ctx.toolInput ? ctx.toolInput.command : undefined
    const rewrite = command === fixture.original
    appendFileSync(fixture.handlerLog, JSON.stringify({
      callId: ctx.toolUseId,
      toolName: ctx.toolName,
      original: command,
      decision: rewrite ? 'allow-rewrite' : 'skip-control',
      updated: rewrite ? fixture.rewritten : undefined,
    }) + '\\n')
    return rewrite ? ctx.allow({ updatedInput: { command: fixture.rewritten } }) : ctx.skip()
  },
}
`
    const hookPath = join(project, '.clooks/hooks/rewrite-native-policy.ts')
    writeFileSync(hookPath, hook)
    writeFileSync(join(logs, 'hook.ts.txt'), hook, { flag: 'wx' })
    writeFileSync(
      join(project, '.clooks/clooks.yml'),
      JSON.stringify({
        version: '1.0.0',
        'rewrite-native-policy': {
          uses: './.clooks/hooks/rewrite-native-policy.ts',
          handoff: false,
          maxFailures: 0,
        },
      }),
    )
    const before = snapshotTree(owned)
    save(join(logs, 'before.json'), before)
    save(join(codexHome, 'models.json'), packCatalog)
    cpSync(join(codexHome, 'models.json'), join(logs, 'models.json'))
    let policyRule: string | undefined
    if (shell) {
      mkdirSync(join(codexHome, 'rules'))
      policyRule = shellPolicyRule
      writeFileSync(join(codexHome, 'rules/policy.rules'), policyRule)
      writeFileSync(join(logs, 'policy.rules'), policyRule, { flag: 'wx' })
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
        sandbox,
        'Run the scripted rewrite-policy operations, then finish.',
      ],
      project,
      env,
      join(logs, 'native'),
      60000,
    )
    const captures = readCaptures(payloadDir, handlerLog)
    const observed: RewritePolicyObservation = {
      ...captures,
      requests: server.requests,
      before,
      after: snapshotTree(owned),
      sandbox,
      policyRule,
    }
    save(join(logs, 'observed.json'), observed)
    requireSuccess(result)
    server.assertComplete()
    assertRewritePolicyObservation(id, observed)
    requireThat(sha256(hookPath) === sha256(join(logs, 'hook.ts.txt')), 'Rewrite hook changed')
    requireThat(
      sha256('/app/dist/clooks') === clooksSha256,
      'Clooks changed during rewrite policy case',
    )
    save(join(logs, 'passed.json'), {
      id,
      status: 'passed',
      clooksSha256,
      evidence: 'native policy denial after a direct Clooks input rewrite',
      limitations: [
        'synthetic project trust',
        'hook-trust bypass',
        'synthetic local provider/catalog',
        shell ? 'synthetic forbidden exec-policy rule' : 'read-only patch safety',
      ],
    })
  } catch (error) {
    save(join(logs, 'failure.json'), {
      id,
      status: 'failed',
      error: String(error),
      stack: error instanceof Error ? error.stack : null,
    })
    throw error
  } finally {
    await server.stop()
    rmSync(base, { recursive: true, force: true })
  }
}
