import { test } from 'bun:test'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { modelReadableText, requireSuccess, requireThat, run, save, sha256 } from './harness'
import {
  assertSkill,
  assertRuntimeRegistration,
  onboardingCases,
  onboardingPin,
  onboardingPacks,
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
  let createHook = false
  let packs:
    | {
        installed: string[]
        denial: boolean
        idempotent: boolean
        cachePreserved: boolean
        explicitUpdate: boolean
      }
    | undefined
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
        assertRuntimeRegistration(hooks)
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
      if (id === 'ONBOARDING-INSTALL') {
        const authorSkillPath = join(cache, 'codex-skills/create-hook/SKILL.md')
        const authorSkill = readFileSync(authorSkillPath, 'utf8')
        const guidePath = join(cache, 'skills/create-hook/SKILL.md')
        const guide = readFileSync(guidePath, 'utf8')
        const guideLines = guide.trimEnd().split('\n')
        const guideChunks: string[] = []
        for (let line = 0; line < guideLines.length; line += 40) {
          guideChunks.push(guideLines.slice(line, line + 40).join('\n'))
        }
        requireThat(
          authorSkill ===
            readFileSync(
              '/onboarding-marketplace/clooks/codex-skills/create-hook/SKILL.md',
              'utf8',
            ) &&
            guide ===
              readFileSync('/onboarding-marketplace/clooks/skills/create-hook/SKILL.md', 'utf8'),
          'Cached authoring skill or shared guide differs',
        )
        const hookPath = join(project, '.clooks/hooks/onboarding-created.ts')
        const fixture = JSON.stringify({
          event: 'PreToolUse',
          provider: 'codex',
          toolName: 'Bash',
          toolInput: { command: 'printf smoke' },
          originalToolInput: { command: 'printf smoke' },
          toolUseId: 'authoring-smoke',
        })
        const author: OnboardingTurn = {
          prompt:
            '$clooks:create-hook Scaffold, test and register a skip-only PreToolUse hook named onboarding-created. ONBOARDING_CREATE_HOOK',
          done: 'ONBOARDING_CREATE_HOOK_DONE',
          commands: [
            ...guideChunks.map((_, index) => (output: string) => {
              if (index > 0) {
                requireThat(
                  output.includes(guideChunks[index - 1]!),
                  `Shared guide section ${index} was truncated or missing`,
                )
              }
              return `sed -n '${index * 40 + 1},${(index + 1) * 40}p' ${quote(guidePath)}`
            }),
            (output) => {
              requireThat(
                output.includes(guideChunks.at(-1)!),
                'Final shared guide section was truncated or missing',
              )
              return `${quote(binary)} new-hook --name onboarding-created --event PreToolUse`
            },
            `printf '%s' ${quote(fixture)} | ${quote(binary)} test ${quote(hookPath)}`,
            (output) => {
              const result = JSON.parse(output.split('Output:\n').at(-1)!.trim())
              requireThat(
                result.result === 'skip',
                'Scaffolded hook did not pass its synthetic test',
              )
              return `printf '%s\\n' 'onboarding-created: {}' >> ${quote(join(project, '.clooks/clooks.yml'))}`
            },
          ],
          inspect(body) {
            assertSkill(body, authorSkill, true)
          },
          complete() {
            requireThat(
              readFileSync(hookPath, 'utf8').includes('onboarding-created'),
              'Hook was not scaffolded',
            )
            requireThat(
              readFileSync(join(project, '.clooks/clooks.yml'), 'utf8').includes(
                '\nonboarding-created: {}\n',
              ),
              'Hook was not registered',
            )
            requireThat(
              readFileSync(registration, 'utf8') === beforeReinit,
              'Authoring changed native registration',
            )
            createHook = true
          },
        }
        turns.push(author)
        await tui('none', [author])
      }
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

        const installs: Record<string, { cache: string; manifest: any }> = {}
        const files = (root: string, prefix = ''): Record<string, string> => {
          const hashes: Record<string, string> = {}
          for (const entry of readdirSync(join(root, prefix), { withFileTypes: true }).sort(
            (a, b) => a.name.localeCompare(b.name),
          )) {
            const path = join(prefix, entry.name)
            requireThat(entry.isDirectory() || entry.isFile(), `Unexpected package entry: ${path}`)
            if (entry.isDirectory()) Object.assign(hashes, files(root, path))
            else hashes[path] = sha256(join(root, path))
          }
          return hashes
        }
        for (const pack of onboardingPacks) {
          const result = JSON.parse(
            await cli(['plugin', 'add', `${pack}@clooks-marketplace`, '--json']),
          )
          const source = join('/onboarding-marketplace', pack)
          const manifest = JSON.parse(readFileSync(join(source, 'clooks-pack.json'), 'utf8'))
          const pluginManifest = JSON.parse(
            readFileSync(join(source, '.claude-plugin/plugin.json'), 'utf8'),
          )
          requireThat(
            result.name === pack &&
              result.version === pluginManifest.version &&
              result.installedPath ===
                join(codexHome, 'plugins/cache/clooks-marketplace', pack, result.version),
            'Wrong pack install identity',
          )
          const cache = result.installedPath as string
          requireThat(
            !existsSync(join(source, '.codex-plugin')) && !existsSync(join(cache, '.codex-plugin')),
            'Duplicate Codex pack manifest',
          )
          const sourceFiles = files(source)
          requireThat(
            JSON.stringify(files(cache)) === JSON.stringify(sourceFiles),
            'Actual pack install changed bytes',
          )
          requireThat(
            sha256(join(cache, 'hooks/types.d.ts')) ===
              sha256('/app/src/generated/clooks-types.d.ts.txt'),
            'Pack declarations differ from runtime',
          )
          installs[pack] = { cache, manifest }
          save(join(logs, `pack-${pack}.json`), { result, sourceFiles, manifest })
        }
        const packList = JSON.parse(await cli(['plugin', 'list', '--json']))
        for (const pack of onboardingPacks)
          requireThat(
            packList.installed.some((item: any) => item.name === pack && item.enabled),
            'Installed pack disabled',
          )
        requireThat(
          !existsSync(join(home, '.clooks/vendor/plugin')) &&
            !existsSync(join(home, '.clooks/clooks.yml')),
          'CLI install implicitly vendored packs',
        )
        const vendor = join(home, '.clooks/vendor/plugin')
        const userYml = join(home, '.clooks/clooks.yml')
        const sentinel = join(project, 'compound-first-effect')
        const secondSentinel = join(project, 'compound-second-effect')
        const compound = `touch ${quote(sentinel)} && touch ${quote(secondSentinel)}`
        const reason = `Compound command detected. Instead:
  - Use apply_patch for file edits when available
  - Run commands separately in individual shell tool calls
  - Write a dedicated bash script in tmp/ for multi-step sequences
  - If both commands MUST run together and a script is overkill, prefix with ALLOW_COMPOUND=true`
        const deny = (label: string): OnboardingTurn => ({
          prompt: `Run compound fixture ONBOARDING_PACK_${label}`,
          done: `ONBOARDING_PACK_${label}_DONE`,
          commands: [compound],
          denialReason: reason,
          inspect(body) {
            requireThat(
              modelReadableText(body.input).some((part) =>
                part.includes('The no-compound-commands clooks hook is active'),
              ),
              'Actual core SessionStart context missing',
            )
          },
          complete() {
            requireThat(
              !existsSync(sentinel) && !existsSync(secondSentinel),
              'Denied compound command created a sentinel',
            )
          },
        })
        const discover = deny('DISCOVER')
        turns.push(discover)
        await tui('none', [discover])
        const registered = Bun.YAML.parse(readFileSync(userYml, 'utf8')) as Record<string, any>
        const hookNames: string[] = []
        for (const [pack, installedPack] of Object.entries(installs)) {
          for (const [hook, definition] of Object.entries(installedPack.manifest.hooks) as Array<
            [string, any]
          >) {
            hookNames.push(hook)
            requireThat(
              sha256(join(vendor, pack, `${hook}.ts`)) ===
                sha256(join(installedPack.cache, definition.path)),
              `Native discovery bytes differ: ${hook}`,
            )
            requireThat(
              registered[hook]?.uses === `./.clooks/vendor/plugin/${pack}/${hook}.ts`,
              `Missing user registration: ${hook}`,
            )
            requireThat(
              registered[hook]?.enabled === (definition.autoEnable === false ? false : undefined),
              `Wrong default enablement: ${hook}`,
            )
          }
        }
        requireThat(
          JSON.stringify(
            Object.keys(registered)
              .filter((key) => key !== 'version')
              .sort(),
          ) === JSON.stringify(hookNames.sort()),
          'Missing or duplicate pack registrations',
        )
        requireThat(
          !existsSync(join(project, '.clooks/vendor/plugin')),
          'User activation vendored into project',
        )
        const snapshot = () => ({
          user: readFileSync(userYml, 'utf8'),
          project: readFileSync(join(project, '.clooks/clooks.yml'), 'utf8'),
          registration: readFileSync(registration, 'utf8'),
          vendor: files(vendor),
        })
        const firstPackState = snapshot()
        save(join(logs, 'packs-discovered.json'), firstPackState)
        const repeat = deny('REPEAT')
        turns.push(repeat)
        await tui('none', [repeat])
        requireThat(
          JSON.stringify(snapshot()) === JSON.stringify(firstPackState),
          'Repeated session changed vendor/config bytes',
        )
        save(join(logs, 'packs-repeated.json'), snapshot())

        const core = installs['clooks-core-hooks']!
        const sourceHook = join(core.cache, 'hooks/no-compound-commands.ts')
        const vendorHook = join(vendor, 'clooks-core-hooks/no-compound-commands.ts')
        writeFileSync(
          sourceHook,
          readFileSync(sourceHook, 'utf8') + '\n// Native pack cache update fixture.\n',
        )
        writeFileSync(
          vendorHook,
          readFileSync(vendorHook, 'utf8') + '\n// User-owned vendor customization fixture.\n',
        )
        registered['no-bare-mv'].enabled = false
        writeFileSync(userYml, Bun.YAML.stringify(registered))
        const customized = snapshot()
        const cached = deny('CACHE_CHANGED')
        turns.push(cached)
        await tui('none', [cached])
        requireThat(
          JSON.stringify(snapshot()) === JSON.stringify(customized),
          'Cache refresh silently replaced user copies or settings',
        )
        save(join(logs, 'packs-cache-preserved.json'), {
          ...snapshot(),
          cacheHook: sha256(sourceHook),
        })

        const updated = await run(
          [binary, 'update', 'plugin:clooks-core-hooks', '--json'],
          project,
          env,
          join(logs, 'pack-explicit-update'),
          20_000,
        )
        requireSuccess(updated)
        const updateResult = JSON.parse(updated.stdout)
        requireThat(
          updateResult.ok === true &&
            updateResult.data.errors.length === 0 &&
            updateResult.data.updated.includes('no-compound-commands'),
          'Compiled update did not report core update',
        )
        requireThat(
          sha256(vendorHook) === sha256(sourceHook),
          'Explicit update did not copy changed cache bytes',
        )
        const updatedState = snapshot()
        requireThat(
          updatedState.user === customized.user &&
            updatedState.project === customized.project &&
            updatedState.registration === customized.registration,
          'Explicit update changed settings or registrations',
        )
        for (const [pack, installedPack] of Object.entries(installs)) {
          for (const [hook, definition] of Object.entries(installedPack.manifest.hooks) as Array<
            [string, any]
          >) {
            requireThat(
              sha256(join(vendor, pack, `${hook}.ts`)) ===
                sha256(join(installedPack.cache, definition.path)),
              `Post-update bytes differ: ${hook}`,
            )
          }
        }
        save(join(logs, 'packs-updated.json'), { ...updatedState, updateResult })
        packs = {
          installed: onboardingPacks,
          denial: true,
          idempotent: true,
          cachePreserved: true,
          explicitUpdate: true,
        }
      }
    }
    save(join(logs, 'passed.json'), {
      id,
      status: 'passed',
      codexSha256: onboardingPin,
      clooksSha256,
      sessions,
      downloads: provider.downloads,
      ...(id === 'ONBOARDING-INSTALL' ? { createHook } : {}),
      ...(packs ? { packs } : {}),
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
