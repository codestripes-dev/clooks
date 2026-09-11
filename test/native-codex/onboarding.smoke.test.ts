import { test } from 'bun:test'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { modelReadableText, requireSuccess, requireThat, run, save, sha256 } from './harness'
import {
  assertSkill,
  onboardingCases,
  onboardingPin,
  onboardingProvider,
  type OnboardingTurn,
} from './onboarding'

if (
  process.env.CLOOKS_E2E_DOCKER !== 'true' ||
  process.env.CLOOKS_NATIVE_MODE !== '--onboarding' ||
  process.env.CLOOKS_MARKETPLACE_ROOT !== '/onboarding-marketplace' ||
  process.env.CLOOKS_NATIVE_LOGDIR !== '/export'
) {
  throw new Error('Use scripts/test-codex-native.sh --onboarding in disposable Docker')
}

function quote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

async function scenario(id: string) {
  requireThat(process.getuid!() !== 0, 'Onboarding must run non-root')
  requireThat(sha256('/native/bin/codex') === onboardingPin, 'Requires pinned Codex 0.154.0')
  requireThat(!existsSync('/usr/local/bin/clooks'), 'Onboarding cannot use a global Clooks link')
  const logs = join('/export', id)
  mkdirSync(logs)
  const base = mkdtempSync('/tmp/clooks-onboarding-')
  const home = join(base, 'home')
  const codexHome = join(home, '.codex')
  const project = join(base, 'project')
  const managed = join(home, '.local/bin/clooks')
  const external = join(base, 'external-bin')
  const decline = id === 'ONBOARDING-DECLINE'
  const reuse = id === 'ONBOARDING-REUSE-REMOVE'
  const binary = reuse ? join(external, 'clooks') : managed
  const clooksSha256 = sha256('/app/dist/clooks')
  const version = JSON.parse(readFileSync('/app/package.json', 'utf8')).version as string
  for (const path of [home, codexHome, project, external]) mkdirSync(path, { recursive: true })
  if (reuse) {
    copyFileSync('/app/dist/clooks', binary)
    chmodSync(binary, 0o755)
  }
  const turns: OnboardingTurn[] = []
  const provider = onboardingProvider(logs, project, turns, version)
  const env: Record<string, string> = {
    HOME: home,
    CODEX_HOME: codexHome,
    CODEX_SQLITE_HOME: codexHome,
    CLOOKS_HOME_ROOT: home,
    CLOOKS_E2E_DOCKER: 'true',
    CLOOKS_INSTALL_BASE_URL: `http://127.0.0.1:${provider.port}/releases`,
    CLOOKS_VERSION: version,
    PATH: `${external}:${home}/.local/bin:/native/bin:/usr/local/bin:/usr/bin:/bin`,
    SHELL: '/bin/bash',
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    TERM: 'xterm-256color',
  }
  const config = `model = "gpt-5.1-codex"
model_provider = "onboarding"
approval_policy = "never"
sandbox_mode = "danger-full-access"
check_for_update_on_startup = false
[projects.${JSON.stringify(project)}]
trust_level = "trusted"
[features]
enable_request_compression = false
[model_providers.onboarding]
name = "Offline onboarding fixture"
base_url = "http://127.0.0.1:${provider.port}/v1"
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
  writeFileSync(join(codexHome, 'config.toml'), config)
  writeFileSync(join(logs, 'config.toml'), config)
  let calls = 0
  const cli = async (args: string[]) => {
    const result = await run(
      ['/native/bin/codex', ...args],
      project,
      env,
      join(logs, `cli-${++calls}`),
      20_000,
    )
    requireSuccess(result)
    return result.stdout
  }
  let sessions = 0
  const tui = async (review: 'accept' | 'decline' | 'none', selected: OnboardingTurn[]) => {
    const session = join(logs, `session-${++sessions}`)
    mkdirSync(session)
    const result = await run(
      [
        '/usr/bin/expect',
        '/app/test/native-codex/onboarding.exp',
        review,
        join(session, 'terminal.log'),
        ...selected.flatMap((turn) => [turn.prompt, turn.done]),
      ],
      project,
      env,
      join(session, 'driver'),
      100_000,
    )
    requireSuccess(result)
    requireThat(result.stdout.includes('ONBOARDING_NATIVE_EXIT_ZERO'), 'No native orderly exit')
    if (review !== 'none')
      requireThat(
        result.stdout.includes(`ONBOARDING_TRUST_CHOICE=${review}`),
        'Missing trust choice',
      )
    provider.assertComplete()
  }
  const untouched = () => {
    requireThat(!existsSync(managed), 'Implicit managed binary installation')
    requireThat(
      !existsSync(join(project, '.clooks')) && !existsSync(join(project, '.codex')),
      'Implicit project init',
    )
    requireThat(
      !existsSync(join(home, '.clooks')) && !existsSync(join(home, '.bashrc')),
      'Implicit home setup',
    )
    requireThat(provider.downloads.length === 0, 'Implicit download')
  }
  try {
    requireThat((await cli(['--version'])).trim() === 'codex-cli 0.154.0', 'Wrong native version')
    await cli(['plugin', 'marketplace', 'add', '/onboarding-marketplace', '--json'])
    const installed = JSON.parse(
      await cli(['plugin', 'add', 'clooks@clooks-marketplace', '--json']),
    )
    const cache = installed.installedPath
    requireThat(
      installed.name === 'clooks' &&
        installed.version === version &&
        typeof cache === 'string' &&
        cache.startsWith(codexHome + '/'),
      'Wrong installed plugin/cache identity',
    )
    const listed = JSON.parse(await cli(['plugin', 'list', '--json']))
    requireThat(
      listed.installed?.some((item: any) => item.name === 'clooks' && item.enabled),
      'Plugin not enabled',
    )
    save(join(logs, 'installed.json'), installed)
    const installer = join(cache, 'skills/setup/scripts/install.sh')
    const skill = readFileSync(join(cache, 'codex-skills/setup/SKILL.md'), 'utf8')
    requireThat(
      skill === readFileSync('/onboarding-marketplace/clooks/codex-skills/setup/SKILL.md', 'utf8'),
      'Cached skill differs',
    )
    requireThat(
      sha256(installer) ===
        sha256('/onboarding-marketplace/clooks/skills/setup/scripts/install.sh'),
      'Cached installer differs',
    )
    untouched()
    const hello: OnboardingTurn = {
      prompt: 'Hello ONBOARDING_HELLO',
      done: 'ONBOARDING_HELLO_DONE',
      commands: [],
      inspect(body) {
        assertSkill(body, skill, false)
        const reminder = modelReadableText(body.input).some((part) =>
          part.includes('This is a reminder only:'),
        )
        requireThat(reminder === (!decline && !reuse), 'Unexpected reminder delivery')
      },
      complete: untouched,
    }
    const registration = join(project, '.codex/hooks.json')
    let beforeReinit = ''
    const setup: OnboardingTurn = {
      prompt: `$clooks:setup ${decline ? 'check' : 'install and initialize Codex, then repeat project init once'} ONBOARDING_SETUP`,
      done: 'ONBOARDING_SETUP_DONE',
      commands: decline
        ? [`bash ${quote(installer)} check`]
        : [
            `bash ${quote(installer)} install`,
            `bash ${quote(installer)} resolve`,
            (output) => {
              const resolved = output.split('Output:\n').at(-1)!.trim()
              requireThat(resolved === binary, `Wrong selected binary: ${resolved}`)
              return `${quote(resolved)} init --agent codex`
            },
            () => {
              beforeReinit = readFileSync(registration, 'utf8')
              return `${quote(binary)} init --agent codex`
            },
          ],
      ...(decline ? { exitCode: 1 } : {}),
      inspect(body) {
        assertSkill(body, skill, true)
      },
      complete() {
        if (decline) {
          untouched()
          return
        }
        requireThat(
          sha256(binary) === clooksSha256,
          'Installed/reused binary differs from compiled artifact',
        )
        requireThat(
          readFileSync(registration, 'utf8') === beforeReinit,
          'Reinit changed native registration',
        )
        requireThat(
          !existsSync(join(project, '.claude')) && !existsSync(join(home, '.clooks')),
          'Wrong agent/scope setup',
        )
        const hooks = JSON.parse(beforeReinit).hooks
        requireThat(
          Object.keys(hooks).length === 11 &&
            Object.values(hooks).every(
              (groups: any) => groups.length === 1 && groups[0].hooks.length === 1,
            ),
          'Duplicate or incomplete runtime registration',
        )
        if (reuse) {
          requireThat(
            !existsSync(managed) &&
              !existsSync(join(home, '.bashrc')) &&
              provider.downloads.length === 0,
            'Reuse mutated installation',
          )
        } else {
          requireThat(
            JSON.stringify(provider.downloads) ===
              JSON.stringify([
                `/releases/download/v${version}/checksums.txt`,
                `/releases/download/v${version}/clooks-linux-x64`,
              ]),
            'Wrong installer downloads',
          )
        }
      },
    }
    turns.push(hello, setup)
    await tui(decline ? 'decline' : 'accept', [hello, setup])
    if (!decline) {
      writeFileSync(join(logs, 'generated-hooks.json'), beforeReinit)
      const timeline = join(logs, 'runtime.jsonl')
      const context = 'onboarding-runtime-context-9157'
      const marker = join(project, 'runtime-marker')
      const observer = `import { appendFileSync } from 'node:fs'
function record(ctx) {
  appendFileSync(${JSON.stringify(timeline)}, JSON.stringify({event:ctx.event, session:ctx.sessionId, input:ctx.toolInput})+'\\n')
  return ctx.skip(ctx.event === 'SessionStart' ? {injectContext:${JSON.stringify(context)}} : {})
}
export const hook = {meta:{name:'onboarding-observer'}, SessionStart:record, PostToolUse:record}
`
      writeFileSync(join(project, '.clooks/hooks/onboarding-observer.ts'), observer)
      writeFileSync(
        join(project, '.clooks/clooks.yml'),
        'version: "1.0.0"\nonboarding-observer: {}\n',
      )
      const dispatch = (label: string): OnboardingTurn => ({
        prompt: `Run fixture command ONBOARDING_${label}`,
        done: `ONBOARDING_${label}_DONE`,
        commands: [`printf onboarding-runtime-effect > ${quote(marker)}`],
        inspect(body) {
          assertSkill(body, skill, false)
          requireThat(
            modelReadableText(body.input).some((part) => part.includes(context)),
            'No real runtime context delivered',
          )
          requireThat(
            !modelReadableText(body.input).some((part) =>
              part.includes('This is a reminder only:'),
            ),
            'Ready bootstrap not silent',
          )
        },
        complete() {
          requireThat(
            readFileSync(marker, 'utf8') === 'onboarding-runtime-effect',
            'Native shell effect missing',
          )
        },
      })
      const runtime = dispatch('RUNTIME')
      turns.push(runtime)
      await tui('accept', [runtime])
      const first = readFileSync(timeline, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      requireThat(
        first.length === 2 &&
          first[0].event === 'SessionStart' &&
          first[1].event === 'PostToolUse' &&
          first[0].session === first[1].session,
        'Runtime dispatch missing or duplicated',
      )
      if (reuse) {
        const configBytes = readFileSync(join(project, '.clooks/clooks.yml'), 'utf8')
        await cli(['plugin', 'remove', 'clooks@clooks-marketplace', '--json'])
        requireThat(
          sha256(binary) === clooksSha256 &&
            readFileSync(registration, 'utf8') === beforeReinit &&
            readFileSync(join(project, '.clooks/clooks.yml'), 'utf8') === configBytes,
          'Plugin removal uninstalled runtime/config',
        )
        const removedList = JSON.parse(await cli(['plugin', 'list', '--json']))
        requireThat(
          !removedList.installed?.some((item: any) => item.name === 'clooks'),
          'Plugin still installed',
        )
        rmSync(marker)
        const removed = dispatch('REMOVED')
        turns.push(removed)
        await tui('none', [removed])
        const after = readFileSync(timeline, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        requireThat(
          after.length === 4 &&
            after[2].event === 'SessionStart' &&
            after[3].event === 'PostToolUse',
          'Removal disabled or duplicated runtime',
        )
      }
    }
    save(join(logs, 'passed.json'), {
      id,
      status: 'passed',
      codexSha256: onboardingPin,
      clooksSha256,
      sessions,
      downloads: provider.downloads,
      evidence: 'real native TUI and tools, scripted local provider',
      limitations: [
        'synthetic project trust',
        'isolated danger-full-access',
        'not live-model obedience',
      ],
    })
  } catch (error) {
    save(join(logs, 'failure.json'), {
      error: String(error),
      stack: error instanceof Error ? error.stack : null,
      providerErrors: provider.errors,
      downloads: provider.downloads,
    })
    throw error
  } finally {
    await provider.stop()
    rmSync(base, { recursive: true, force: true })
    save(join(logs, 'cleanup.json'), { removed: !existsSync(base) })
  }
}

test('actual marketplace onboarding through native trust, explicit setup and registered runtime', async () => {
  for (const id of onboardingCases) await scenario(id)
  save('/export/completed.json', {
    mode: '--onboarding',
    completed: onboardingCases.length,
    cases: onboardingCases,
  })
}, 330_000)
