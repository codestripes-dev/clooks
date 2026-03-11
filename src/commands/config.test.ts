import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test'
import { Command } from 'commander'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createConfigCommand } from './config.js'
import type { ClooksConfig } from '../config/types.js'
import type { LoadConfigResult, LoadConfigOptions } from '../config/index.js'
import type { HookName, Milliseconds } from '../types/branded.js'

// Mock @clack/prompts to avoid TTY issues in tests
mock.module('@clack/prompts', () => ({
  intro: mock(),
  outro: mock(),
  log: {
    success: mock(),
    info: mock(),
    warning: mock(),
    error: mock(),
  },
}))

function makeConfig(overrides?: Partial<ClooksConfig>): ClooksConfig {
  return {
    version: '1.0.0',
    global: {
      timeout: 30000 as Milliseconds,
      onError: 'block',
      maxFailures: 3,
      maxFailuresMessage: 'Too many failures',
    },
    hooks: {
      ['my-hook' as HookName]: {
        resolvedPath: '.clooks/hooks/my-hook.ts',
        config: {},
        parallel: false,
        origin: 'project',
      },
    },
    events: {},
    ...overrides,
  }
}

function makeResult(overrides?: Partial<LoadConfigResult>): LoadConfigResult {
  return {
    config: makeConfig(),
    shadows: [],
    hasProjectConfig: true,
    ...overrides,
  }
}

function createTestProgram(loadConfig: (root: string, options?: LoadConfigOptions) => Promise<LoadConfigResult | null>) {
  const program = new Command()
  program.exitOverride()
  program.option('--json', 'JSON output')
  program.addCommand(createConfigCommand(loadConfig))
  return program
}

describe('config command', () => {
  let exitSpy: ReturnType<typeof spyOn>
  let stdoutSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as () => never)
    stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    exitSpy.mockRestore()
    stdoutSpy.mockRestore()
  })

  test('valid config in human mode shows hook count and timeout', async () => {
    const { log, intro, outro } = await import('@clack/prompts')
    const result = makeResult()
    const loadConfig = mock().mockResolvedValue(result)

    const program = createTestProgram(loadConfig)
    await program.parseAsync(['config'], { from: 'user' })

    expect(exitSpy).not.toHaveBeenCalled()
    expect(loadConfig).toHaveBeenCalledTimes(1)
    expect(intro).toHaveBeenCalledWith('clooks config')
    expect(log.info).toHaveBeenCalledWith('Hooks: 1 registered')
    expect(log.info).toHaveBeenCalledWith('Timeout: 30000ms')
    expect(log.info).toHaveBeenCalledWith('onError: block')
    expect(log.info).toHaveBeenCalledWith('maxFailures: 3')
    expect(outro).toHaveBeenCalledWith('Done')
  })

  test('valid config with --json outputs JSON envelope with ok:true', async () => {
    const result = makeResult()
    const loadConfig = mock().mockResolvedValue(result)

    const program = createTestProgram(loadConfig)
    await program.parseAsync(['--json', 'config'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('config')
    expect(parsed.data.version).toBe('1.0.0')
    expect(parsed.data.hooks).toBe(1)
    expect(parsed.data.timeout).toBe(30000)
    expect(parsed.data.onError).toBe('block')
    expect(parsed.data.maxFailures).toBe(3)
  })

  test('null result shows init suggestion', async () => {
    const loadConfig = mock().mockResolvedValue(null)

    const program = createTestProgram(loadConfig)
    await program.parseAsync(['config'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('null result with --json outputs JSON envelope with ok:false', async () => {
    const loadConfig = mock().mockResolvedValue(null)

    const program = createTestProgram(loadConfig)
    await program.parseAsync(['--json', 'config'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)

    // The first stdout.write call contains the JSON error envelope.
    // Subsequent calls may come from the catch block re-processing the mock exit error.
    const firstOutput = String(stdoutSpy.mock.calls[0]?.[0] ?? '')
    const parsed = JSON.parse(firstOutput.trim())

    expect(parsed.ok).toBe(false)
    expect(parsed.command).toBe('config')
    expect(parsed.error).toContain('clooks init')
  })

  test('generic error in human mode exits 1', async () => {
    const loadConfig = mock().mockRejectedValue(new Error('invalid YAML'))

    const program = createTestProgram(loadConfig)
    await program.parseAsync(['config'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('generic error with --json outputs JSON envelope with ok:false', async () => {
    const loadConfig = mock().mockRejectedValue(new Error('invalid YAML'))

    const program = createTestProgram(loadConfig)
    await program.parseAsync(['--json', 'config'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(false)
    expect(parsed.command).toBe('config')
    expect(parsed.error).toContain('invalid YAML')
  })
})

// --- config --resolved tests ---

describe('config --resolved', () => {
  let exitSpy: ReturnType<typeof spyOn>
  let stdoutSpy: ReturnType<typeof spyOn>
  let tempDir: string
  let savedCwd: string
  let savedHomeRoot: string | undefined

  beforeEach(() => {
    exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as () => never)
    stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
    savedCwd = process.cwd()
    savedHomeRoot = process.env.CLOOKS_HOME_ROOT
  })

  afterEach(() => {
    exitSpy.mockRestore()
    stdoutSpy.mockRestore()
    process.chdir(savedCwd)
    if (savedHomeRoot !== undefined) {
      process.env.CLOOKS_HOME_ROOT = savedHomeRoot
    } else {
      delete process.env.CLOOKS_HOME_ROOT
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  function setupThreeLayer() {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-config-resolved-'))
    const homeDir = join(tempDir, 'home')
    const projectDir = join(tempDir, 'project')

    mkdirSync(join(homeDir, '.clooks'), { recursive: true })
    mkdirSync(join(projectDir, '.clooks'), { recursive: true })

    // Home config
    writeFileSync(join(homeDir, '.clooks/clooks.yml'), `version: "1.0.0"\nconfig:\n  timeout: 5000\nsecurity-audit:\n  config:\n    blocked:\n      - "rm -rf"\nPreToolUse:\n  order: [security-audit]\n`)

    // Project config
    writeFileSync(join(projectDir, '.clooks/clooks.yml'), `version: "1.0.0"\nconfig:\n  timeout: 10000\n  onError: block\nlint-guard:\n  config:\n    strict: true\nPreToolUse:\n  order: [lint-guard]\n`)

    // Local config
    writeFileSync(join(projectDir, '.clooks/clooks.local.yml'), `security-audit:\n  config:\n    blocked:\n      - "rm -rf"\n      - "curl | sh"\n`)

    return { homeDir, projectDir }
  }

  function setupHomeOnly() {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-config-resolved-'))
    const homeDir = join(tempDir, 'home')
    const projectDir = join(tempDir, 'project')

    mkdirSync(join(homeDir, '.clooks'), { recursive: true })
    mkdirSync(projectDir, { recursive: true })

    // Home config only
    writeFileSync(join(homeDir, '.clooks/clooks.yml'), `version: "1.0.0"\nconfig:\n  timeout: 5000\nsecurity-audit:\n  config:\n    blocked:\n      - "rm -rf"\n`)

    return { homeDir, projectDir }
  }

  function createResolvedProgram() {
    const loadConfig = mock().mockResolvedValue(null)  // not used in --resolved mode
    const program = new Command()
    program.exitOverride()
    program.option('--json', 'JSON output')
    program.addCommand(createConfigCommand(loadConfig))
    return program
  }

  test('--resolved outputs provenance for a three-layer config', async () => {
    const { homeDir, projectDir } = setupThreeLayer()
    process.chdir(projectDir)
    process.env.CLOOKS_HOME_ROOT = homeDir

    const program = createResolvedProgram()
    await program.parseAsync(['config', '--resolved'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')

    // Should show version from both layers
    expect(output).toContain('version:')
    expect(output).toContain('[home]')
    expect(output).toContain('[project]')

    // Should show config.timeout from both layers
    expect(output).toContain('config.timeout:')

    // Should show hooks
    expect(output).toContain('hook: security-audit')
    expect(output).toContain('hook: lint-guard')

    // Should show local override
    expect(output).toContain('local override')

    // Should show event order
    expect(output).toContain('PreToolUse.order:')
  })

  test('--resolved --json outputs structured data', async () => {
    const { homeDir, projectDir } = setupThreeLayer()
    process.chdir(projectDir)
    process.env.CLOOKS_HOME_ROOT = homeDir

    const program = createResolvedProgram()
    await program.parseAsync(['--json', 'config', '--resolved'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('config')

    const data = parsed.data
    expect(data.version).toBeDefined()
    expect(data.version.value).toBe('1.0.0')
    expect(data.version.layers).toBeArray()
    expect(data.version.layers.length).toBeGreaterThanOrEqual(1)

    expect(data.config).toBeDefined()
    expect(data.config.timeout).toBeDefined()

    expect(data.hooks).toBeDefined()
    expect(data.hooks['security-audit']).toBeDefined()
    expect(data.hooks['security-audit'].origin).toBe('home')
    expect(data.hooks['lint-guard']).toBeDefined()
    expect(data.hooks['lint-guard'].origin).toBe('project')

    expect(data.events).toBeDefined()
    expect(data.events.PreToolUse).toBeDefined()
    expect(data.events.PreToolUse.order).toBeArray()
  })

  test('--resolved with home-only config works', async () => {
    const { homeDir, projectDir } = setupHomeOnly()
    process.chdir(projectDir)
    process.env.CLOOKS_HOME_ROOT = homeDir

    const program = createResolvedProgram()
    await program.parseAsync(['config', '--resolved'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')

    expect(output).toContain('version:')
    expect(output).toContain('[home]')
    expect(output).toContain('hook: security-audit')
    // Should NOT contain project
    expect(output).not.toContain('[project]')
  })

  test('--resolved shows shadow when project hook overrides home hook', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-config-resolved-'))
    const homeDir = join(tempDir, 'home')
    const projectDir = join(tempDir, 'project')

    mkdirSync(join(homeDir, '.clooks'), { recursive: true })
    mkdirSync(join(projectDir, '.clooks'), { recursive: true })

    // Home defines security-audit
    writeFileSync(join(homeDir, '.clooks/clooks.yml'), `version: "1.0.0"\nsecurity-audit:\n  config:\n    blocked:\n      - "rm -rf"\n`)

    // Project also defines security-audit (shadows home)
    writeFileSync(join(projectDir, '.clooks/clooks.yml'), `version: "1.0.0"\nsecurity-audit:\n  config:\n    blocked:\n      - "rm -rf"\n      - "curl | sh"\n`)

    process.chdir(projectDir)
    process.env.CLOOKS_HOME_ROOT = homeDir

    const program = createResolvedProgram()
    await program.parseAsync(['config', '--resolved'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')

    // Should show home entry marked as shadowed
    expect(output).toContain('hook: security-audit  [home]  (shadowed by project)')
    expect(output).toContain('~/.clooks/hooks/security-audit.ts')

    // Should show project entry as active (not shadowed)
    expect(output).toContain('hook: security-audit  [project]')
    expect(output).toContain('.clooks/hooks/security-audit.ts')
  })

  test('--resolved --json shows shadow info in hookDetails', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-config-resolved-'))
    const homeDir = join(tempDir, 'home')
    const projectDir = join(tempDir, 'project')

    mkdirSync(join(homeDir, '.clooks'), { recursive: true })
    mkdirSync(join(projectDir, '.clooks'), { recursive: true })

    writeFileSync(join(homeDir, '.clooks/clooks.yml'), `version: "1.0.0"\nsecurity-audit:\n  config:\n    blocked:\n      - "rm -rf"\n`)
    writeFileSync(join(projectDir, '.clooks/clooks.yml'), `version: "1.0.0"\nsecurity-audit:\n  config:\n    strict: true\n`)

    process.chdir(projectDir)
    process.env.CLOOKS_HOME_ROOT = homeDir

    const program = createResolvedProgram()
    await program.parseAsync(['--json', 'config', '--resolved'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    const details = parsed.data.hookDetails as { name: string; origin: string; shadowed?: boolean }[]
    expect(details).toBeArray()

    const homeEntry = details.find(d => d.origin === 'home' && d.name === 'security-audit')
    expect(homeEntry).toBeDefined()
    expect(homeEntry!.shadowed).toBe(true)

    const projectEntry = details.find(d => d.origin === 'project' && d.name === 'security-audit')
    expect(projectEntry).toBeDefined()
    expect(projectEntry!.shadowed).toBeUndefined()

    // The keyed hooks object should only have the project (active) entry
    expect(parsed.data.hooks['security-audit'].origin).toBe('project')
  })

  test('--resolved with no config shows appropriate message', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-config-resolved-'))
    const projectDir = join(tempDir, 'project')
    const homeDir = join(tempDir, 'home')
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(homeDir, { recursive: true })

    process.chdir(projectDir)
    process.env.CLOOKS_HOME_ROOT = homeDir

    const program = createResolvedProgram()
    await program.parseAsync(['config', '--resolved'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('--resolved human output: alias hook shows uses + resolved lines', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-config-resolved-'))
    const homeDir = join(tempDir, 'home')
    const projectDir = join(tempDir, 'project')

    mkdirSync(join(homeDir, '.clooks'), { recursive: true })
    mkdirSync(join(projectDir, '.clooks'), { recursive: true })

    writeFileSync(join(projectDir, '.clooks/clooks.yml'), `version: "1.0.0"\nverbose-logger:\n  uses: log-bash\n  config:\n    verbose: true\n`)

    process.chdir(projectDir)
    process.env.CLOOKS_HOME_ROOT = homeDir

    const program = createResolvedProgram()
    await program.parseAsync(['config', '--resolved'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')

    expect(output).toContain('hook: verbose-logger  [project]')
    expect(output).toContain('  uses: log-bash')
    expect(output).toContain('  resolved: .clooks/hooks/log-bash.ts')
    expect(output).toContain('  config.verbose: true')
    // source: line should NOT appear for alias hooks
    expect(output).not.toContain('  source:')
  })

  test('--resolved human output: non-alias hook omits uses/resolved', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-config-resolved-'))
    const homeDir = join(tempDir, 'home')
    const projectDir = join(tempDir, 'project')

    mkdirSync(join(homeDir, '.clooks'), { recursive: true })
    mkdirSync(join(projectDir, '.clooks'), { recursive: true })

    writeFileSync(join(projectDir, '.clooks/clooks.yml'), `version: "1.0.0"\nlog-bash: {}\n`)

    process.chdir(projectDir)
    process.env.CLOOKS_HOME_ROOT = homeDir

    const program = createResolvedProgram()
    await program.parseAsync(['config', '--resolved'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')

    expect(output).toContain('hook: log-bash  [project]')
    expect(output).toContain('  source: .clooks/hooks/log-bash.ts')
    expect(output).not.toContain('  uses:')
    expect(output).not.toContain('  resolved:')
  })

  test('--resolved JSON output: alias hook has uses + resolved fields', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-config-resolved-'))
    const homeDir = join(tempDir, 'home')
    const projectDir = join(tempDir, 'project')

    mkdirSync(join(homeDir, '.clooks'), { recursive: true })
    mkdirSync(join(projectDir, '.clooks'), { recursive: true })

    writeFileSync(join(projectDir, '.clooks/clooks.yml'), `version: "1.0.0"\nverbose-logger:\n  uses: log-bash\n  config:\n    verbose: true\n`)

    process.chdir(projectDir)
    process.env.CLOOKS_HOME_ROOT = homeDir

    const program = createResolvedProgram()
    await program.parseAsync(['--json', 'config', '--resolved'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    const hookKeyed = parsed.data.hooks['verbose-logger']
    expect(hookKeyed.uses).toBe('log-bash')
    expect(hookKeyed.resolved).toBe('.clooks/hooks/log-bash.ts')

    const hookDetail = parsed.data.hookDetails.find((d: { name: string }) => d.name === 'verbose-logger')
    expect(hookDetail.uses).toBe('log-bash')
    expect(hookDetail.resolved).toBe('.clooks/hooks/log-bash.ts')
  })

  test('--resolved JSON output: non-alias hook omits uses/resolved', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-config-resolved-'))
    const homeDir = join(tempDir, 'home')
    const projectDir = join(tempDir, 'project')

    mkdirSync(join(homeDir, '.clooks'), { recursive: true })
    mkdirSync(join(projectDir, '.clooks'), { recursive: true })

    writeFileSync(join(projectDir, '.clooks/clooks.yml'), `version: "1.0.0"\nlog-bash: {}\n`)

    process.chdir(projectDir)
    process.env.CLOOKS_HOME_ROOT = homeDir

    const program = createResolvedProgram()
    await program.parseAsync(['--json', 'config', '--resolved'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    const hookKeyed = parsed.data.hooks['log-bash']
    expect(hookKeyed.uses).toBeUndefined()
    expect(hookKeyed.resolved).toBeUndefined()
    expect(hookKeyed.source).toBe('.clooks/hooks/log-bash.ts')
  })

  test('--resolved human output: path-like uses', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-config-resolved-'))
    const homeDir = join(tempDir, 'home')
    const projectDir = join(tempDir, 'project')

    mkdirSync(join(homeDir, '.clooks'), { recursive: true })
    mkdirSync(join(projectDir, '.clooks'), { recursive: true })

    writeFileSync(join(projectDir, '.clooks/clooks.yml'), `version: "1.0.0"\ncustom-hook:\n  uses: "./lib/hook.ts"\n`)

    process.chdir(projectDir)
    process.env.CLOOKS_HOME_ROOT = homeDir

    const program = createResolvedProgram()
    await program.parseAsync(['config', '--resolved'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')

    expect(output).toContain('  uses: ./lib/hook.ts')
    expect(output).toContain('  resolved: ./lib/hook.ts')
  })

  test('--resolved human output: two aliases of same hook both appear with uses lines', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-config-resolved-'))
    const homeDir = join(tempDir, 'home')
    const projectDir = join(tempDir, 'project')

    mkdirSync(join(homeDir, '.clooks'), { recursive: true })
    mkdirSync(join(projectDir, '.clooks'), { recursive: true })

    writeFileSync(join(projectDir, '.clooks/clooks.yml'), `version: "1.0.0"\nverbose:\n  uses: base\nquiet:\n  uses: base\n`)

    process.chdir(projectDir)
    process.env.CLOOKS_HOME_ROOT = homeDir

    const program = createResolvedProgram()
    await program.parseAsync(['config', '--resolved'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')

    expect(output).toContain('hook: verbose  [project]')
    expect(output).toContain('hook: quiet  [project]')
    // Both should show uses: base and resolve to the same path
    const usesMatches = output.match(/  uses: base/g)
    expect(usesMatches).toHaveLength(2)
    const resolvedMatches = output.match(/  resolved: .clooks\/hooks\/base\.ts/g)
    expect(resolvedMatches).toHaveLength(2)
  })
})
