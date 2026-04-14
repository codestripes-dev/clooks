import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

// ---------------------------------------------------------------------------
// Helper: set up a mock plugin cache directory and installed_plugins.json
// ---------------------------------------------------------------------------

function setupMockPluginCache(
  home: string,
  opts: {
    pluginKey: string
    scope: 'user' | 'project' | 'local'
    packName: string
    hooks: Record<string, { path: string; code: string; description: string }>
  },
): string {
  // Create cache dir under sandbox home
  const cacheDir = join(
    home,
    '.claude',
    'plugins',
    'cache',
    'test-marketplace',
    opts.packName,
    '1.0.0',
  )
  mkdirSync(cacheDir, { recursive: true })

  // Write hook source files
  for (const [, hookDef] of Object.entries(opts.hooks)) {
    const hookPath = join(cacheDir, hookDef.path)
    mkdirSync(join(hookPath, '..'), { recursive: true })
    writeFileSync(hookPath, hookDef.code)
  }

  // Write clooks-pack.json manifest
  const manifest = {
    version: 1,
    name: opts.packName,
    hooks: Object.fromEntries(
      Object.entries(opts.hooks).map(([name, def]) => [
        name,
        { path: def.path, description: def.description },
      ]),
    ),
  }
  writeFileSync(join(cacheDir, 'clooks-pack.json'), JSON.stringify(manifest))

  // Read or create installed_plugins.json
  const installedPluginsDir = join(home, '.claude', 'plugins')
  const installedPluginsPath = join(installedPluginsDir, 'installed_plugins.json')
  let plugins: Record<string, unknown[]> = {}
  try {
    const existing = JSON.parse(readFileSync(installedPluginsPath, 'utf-8'))
    plugins = existing.plugins || {}
  } catch {
    // File doesn't exist yet
  }

  if (!plugins[opts.pluginKey]) {
    plugins[opts.pluginKey] = []
  }
  ;(plugins[opts.pluginKey] as unknown[]).push({
    scope: opts.scope,
    installPath: cacheDir,
    version: '1.0.0',
    installedAt: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:00:00.000Z',
  })

  mkdirSync(installedPluginsDir, { recursive: true })
  writeFileSync(installedPluginsPath, JSON.stringify({ version: 2, plugins }))

  return cacheDir
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('plugin vendoring', () => {
  test('(a) discovers plugin pack and vendors hooks on first invocation', () => {
    sandbox = createSandbox()

    // Minimal home config so engine does not exit early
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    setupMockPluginCache(sandbox.home, {
      pluginKey: 'test-pack@test-marketplace',
      scope: 'user',
      packName: 'test-pack',
      hooks: {
        'plugin-hook': {
          path: 'hooks/plugin-hook.ts',
          description: 'A test plugin hook',
          code: `
export const hook = {
  meta: { name: "plugin-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "plugin-hook-executed" }
  },
}
`,
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)

    // Vendor file created in home dir
    expect(sandbox.homeFileExists('.clooks/vendor/plugin/test-pack/plugin-hook.ts')).toBe(true)

    // Config updated with the hook entry
    const config = sandbox.readHomeFile('.clooks/clooks.yml')
    expect(config).toContain('plugin-hook:')
    expect(config).toContain('uses: ./.clooks/vendor/plugin/test-pack/plugin-hook.ts')

    // System message mentions registration
    const output = JSON.parse(result.stdout)
    expect(output.systemMessage).toContain('Registered')
    expect(output.systemMessage).toContain('test-pack')

    // Hook actually executed
    const ctx = output.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('plugin-hook-executed')
  })

  test('(b) idempotent on subsequent invocations', () => {
    sandbox = createSandbox()

    sandbox.writeHomeConfig('version: "1.0.0"\n')

    setupMockPluginCache(sandbox.home, {
      pluginKey: 'idem-pack@test-marketplace',
      scope: 'user',
      packName: 'idem-pack',
      hooks: {
        'idem-hook': {
          path: 'hooks/idem-hook.ts',
          description: 'Idempotency test hook',
          code: `
export const hook = {
  meta: { name: "idem-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "idem-hook-ran" }
  },
}
`,
        },
      },
    })

    const stdin = loadEvent('pre-tool-use-bash.json')

    // First run: should register
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.systemMessage).toContain('Registered')

    // Second run: should NOT re-register (vendor file already exists)
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    const sysMsg2 = o2.systemMessage ?? ''
    expect(sysMsg2).not.toContain('Registered')

    // Hook still executes on second run
    const ctx2 = o2.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx2).toContain('idem-hook-ran')
  })

  test('(c) project-scoped plugin vendors to project directory', () => {
    sandbox = createSandbox()

    // Minimal PROJECT config so engine does not exit early
    sandbox.writeConfig('version: "1.0.0"\n')

    setupMockPluginCache(sandbox.home, {
      pluginKey: 'project-pack@test-marketplace',
      scope: 'project',
      packName: 'project-pack',
      hooks: {
        'project-hook': {
          path: 'hooks/project-hook.ts',
          description: 'A project-scoped plugin hook',
          code: `
export const hook = {
  meta: { name: "project-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "project-plugin-ran" }
  },
}
`,
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)

    // Vendor file created in PROJECT dir (not home)
    expect(sandbox.fileExists('.clooks/vendor/plugin/project-pack/project-hook.ts')).toBe(true)

    // Project config updated
    const config = sandbox.readFile('.clooks/clooks.yml')
    expect(config).toContain('project-hook:')
    expect(config).toContain('uses: ./.clooks/vendor/plugin/project-pack/project-hook.ts')

    // Hook executed
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('project-plugin-ran')
  })

  test('(d) name collision emits warning without blocking', () => {
    sandbox = createSandbox()

    // Write a manual project hook named "existing-hook"
    sandbox.writeHook(
      'existing-hook.ts',
      `
export const hook = {
  meta: { name: "existing-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "existing-ran" }
  },
}
`,
    )
    sandbox.writeConfig(`version: "1.0.0"
existing-hook: {}
`)

    // Set up a project-scoped plugin with a hook also named "existing-hook"
    setupMockPluginCache(sandbox.home, {
      pluginKey: 'collision-pack@test-marketplace',
      scope: 'project',
      packName: 'collision-pack',
      hooks: {
        'existing-hook': {
          path: 'hooks/existing-hook.ts',
          description: 'A hook that collides with an existing one',
          code: `
export const hook = {
  meta: { name: "existing-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "plugin-collision-ran" }
  },
}
`,
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })

    // Should not block
    expect(result.exitCode).toBe(0)

    const output = JSON.parse(result.stdout)

    // System message mentions the conflict
    expect(output.systemMessage).toContain('conflicts')

    // Existing hook ran
    const ctx = output.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('existing-ran')

    // Plugin hook did NOT run
    expect(ctx).not.toContain('plugin-collision-ran')

    // Vendor file was NOT created (collision skipped before copy)
    expect(sandbox.fileExists('.clooks/vendor/plugin/collision-pack/existing-hook.ts')).toBe(false)
  })

  test('(e) clooks update re-vendors from cache', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')

    // Set up the mock plugin cache with version-1 code
    const cacheDir = setupMockPluginCache(sandbox.home, {
      pluginKey: 'update-pack@test-marketplace',
      scope: 'project',
      packName: 'update-pack',
      hooks: {
        'updatable-hook': {
          path: 'hooks/updatable-hook.ts',
          description: 'A hook that will be updated',
          code: `
export const hook = {
  meta: { name: "updatable-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "version-1" }
  },
}
`,
        },
      },
    })

    // Pre-vendor the hook manually (simulate a previous engine run)
    sandbox.writeFile(
      '.clooks/vendor/plugin/update-pack/updatable-hook.ts',
      `
export const hook = {
  meta: { name: "updatable-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "version-1" }
  },
}
`,
    )
    // Add config entry for the pre-vendored hook
    sandbox.writeConfig(`version: "1.0.0"

updatable-hook:
  uses: ./.clooks/vendor/plugin/update-pack/updatable-hook.ts
`)

    // Simulate a plugin update: modify the source file in the cache
    writeFileSync(
      join(cacheDir, 'hooks/updatable-hook.ts'),
      `
export const hook = {
  meta: { name: "updatable-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "version-2" }
  },
}
`,
    )

    // Run the update command
    const result = sandbox.run(['update', 'plugin:update-pack', '--json'])
    expect(result.exitCode).toBe(0)

    // Parse JSON output
    const output = JSON.parse(result.stdout.trim())
    expect(output.ok).toBe(true)
    expect(output.data.updated).toContain('updatable-hook')

    // Vendor file should contain version-2
    const vendorContent = sandbox.readFile('.clooks/vendor/plugin/update-pack/updatable-hook.ts')
    expect(vendorContent).toContain('version-2')

    // Config should be stable (uses path unchanged)
    const config = sandbox.readFile('.clooks/clooks.yml')
    expect(config).toContain('uses: ./.clooks/vendor/plugin/update-pack/updatable-hook.ts')

    // Run engine to verify the updated hook actually executes with version-2
    const engineResult = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(engineResult.exitCode).toBe(0)
    const engineOutput = JSON.parse(engineResult.stdout)
    const ctx = engineOutput.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('version-2')
  })

  test('(f) plugin hook runs alongside manually added hooks', () => {
    sandbox = createSandbox()

    // Write a manual project hook
    sandbox.writeHook(
      'manual-hook.ts',
      `
export const hook = {
  meta: { name: "manual-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "manual-ran" }
  },
}
`,
    )
    sandbox.writeConfig(`version: "1.0.0"
manual-hook: {}
`)

    // Minimal home config so engine discovers the user-scoped plugin
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    // Set up a user-scoped plugin hook
    setupMockPluginCache(sandbox.home, {
      pluginKey: 'coexist-pack@test-marketplace',
      scope: 'user',
      packName: 'coexist-pack',
      hooks: {
        'auto-hook': {
          path: 'hooks/auto-hook.ts',
          description: 'A plugin hook that coexists with manual hooks',
          code: `
export const hook = {
  meta: { name: "auto-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "auto-ran" }
  },
}
`,
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)

    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput?.additionalContext ?? ''

    // Both hooks ran
    expect(ctx).toContain('manual-ran')
    expect(ctx).toContain('auto-ran')
  })

  test('(g) local-scoped plugin registers in clooks.local.yml', () => {
    sandbox = createSandbox()

    // Minimal project config so engine does not exit early
    sandbox.writeConfig('version: "1.0.0"\n')

    setupMockPluginCache(sandbox.home, {
      pluginKey: 'local-pack@test-marketplace',
      scope: 'local',
      packName: 'local-pack',
      hooks: {
        'local-hook': {
          path: 'hooks/local-hook.ts',
          description: 'A local-scoped plugin hook',
          code: `
export const hook = {
  meta: { name: "local-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "local-plugin-ran" }
  },
}
`,
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)

    // Vendor file in project directory (not home)
    expect(sandbox.fileExists('.clooks/vendor/plugin/local-pack/local-hook.ts')).toBe(true)

    // Registered in clooks.local.yml (not clooks.yml)
    const localConfig = sandbox.readFile('.clooks/clooks.local.yml')
    expect(localConfig).toContain('local-hook:')
    expect(localConfig).toContain('uses: ./.clooks/vendor/plugin/local-pack/local-hook.ts')

    // Project clooks.yml should NOT have the hook entry
    const projectConfig = sandbox.readFile('.clooks/clooks.yml')
    expect(projectConfig).not.toContain('local-hook:')

    // Hook executed
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('local-plugin-ran')
  })

  test('(h) session-banner hook is discovered, vendored, and executes on SessionStart', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    setupMockPluginCache(sandbox.home, {
      pluginKey: 'clooks-example-hooks@clooks-marketplace',
      scope: 'user',
      packName: 'clooks-example-hooks',
      hooks: {
        'session-banner': {
          path: 'hooks/session-banner.ts',
          description: 'Emits a configurable banner message on session start',
          code: `
export const hook = {
  meta: {
    name: "session-banner",
    description: "Emits a configurable banner message on session start",
    config: {
      message: "clooks is active. Hooks are running.",
    },
  },
  SessionStart(_ctx: unknown, config: { message: string }) {
    return {
      result: "skip" as const,
      injectContext: config.message,
    }
  },
}
`,
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(result.exitCode).toBe(0)

    // Vendor file created
    expect(
      sandbox.homeFileExists('.clooks/vendor/plugin/clooks-example-hooks/session-banner.ts'),
    ).toBe(true)

    // Config updated
    const config = sandbox.readHomeFile('.clooks/clooks.yml')
    expect(config).toContain('session-banner:')
    expect(config).toContain('uses: ./.clooks/vendor/plugin/clooks-example-hooks/session-banner.ts')

    // Registration announced
    const output = JSON.parse(result.stdout)
    expect(output.systemMessage).toContain('Registered')
    expect(output.systemMessage).toContain('clooks-example-hooks')

    // Hook executed — banner message in additionalContext
    expect(output.hookSpecificOutput.additionalContext).toContain(
      'clooks is active. Hooks are running.',
    )
  })

  test('(i) session-banner is idempotent — no re-registration on second SessionStart', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    setupMockPluginCache(sandbox.home, {
      pluginKey: 'clooks-example-hooks@clooks-marketplace',
      scope: 'user',
      packName: 'clooks-example-hooks',
      hooks: {
        'session-banner': {
          path: 'hooks/session-banner.ts',
          description: 'Emits a configurable banner message on session start',
          code: `
export const hook = {
  meta: {
    name: "session-banner",
    description: "Emits a configurable banner message on session start",
    config: {
      message: "clooks is active. Hooks are running.",
    },
  },
  SessionStart(_ctx: unknown, config: { message: string }) {
    return {
      result: "skip" as const,
      injectContext: config.message,
    }
  },
}
`,
        },
      },
    })

    const stdin = loadEvent('session-start.json')

    // First run: registers
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.systemMessage).toContain('Registered')

    // Second run: no re-registration, but hook still executes
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    const sysMsg2 = o2.systemMessage ?? ''
    expect(sysMsg2).not.toContain('Registered')

    // Banner still emitted
    expect(o2.hookSpecificOutput.additionalContext).toContain(
      'clooks is active. Hooks are running.',
    )
  })
})
