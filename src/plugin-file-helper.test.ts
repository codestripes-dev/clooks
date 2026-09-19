import { afterEach, describe, expect, test } from 'bun:test'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { createContextHelpers, type PluginFileSystem } from './plugin-file-helper.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

function fresh(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `clooks-plugin-helper-${label}-`))
  roots.push(root)
  return root
}

function write(path: string, contents = path): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
  return path
}

function writeClaudeRegistry(home: string, plugins: Record<string, unknown>): void {
  write(
    join(home, '.claude/plugins/installed_plugins.json'),
    JSON.stringify({ version: 2, plugins }),
  )
}

function writeCodexPlugin(
  codexHome: string,
  marketplace: string,
  plugin: string,
  version: string,
  manifest: unknown = { name: plugin, version },
): string {
  const root = join(codexHome, 'plugins/cache', marketplace, plugin, version)
  write(join(root, '.codex-plugin/plugin.json'), JSON.stringify(manifest))
  return root
}

const nodeFileSystem: PluginFileSystem = {
  readText: (path) => readFileSync(path, 'utf8'),
  readDirectory: (path) => readdirSync(path),
  realpath: realpathSync,
  lstat: lstatSync,
}

describe('Claude installed plugin membership', () => {
  test('accepts existing recorded roots regardless of scope or activation', () => {
    const base = fresh('claude-records')
    const home = join(base, 'home')
    const enabled = join(base, 'enabled')
    const disabled = join(base, 'disabled')
    const orphaned = join(base, 'orphaned')
    const enabledFile = write(join(enabled, 'scripts/run.mjs'))
    const disabledFile = write(join(disabled, 'asset.txt'))
    const orphanedFile = write(join(orphaned, 'asset.txt'))
    write(join(orphaned, '.orphaned_at'), 'now')
    writeClaudeRegistry(home, {
      'enabled@market': [{ scope: 'user', installPath: enabled }],
      'disabled@market': [{ scope: 'unknown', installPath: disabled }],
      'orphaned@market': [{ scope: 'project', installPath: orphaned }],
      malformed: [null, {}, { installPath: 'relative' }],
      notArray: { installPath: enabled },
    })
    write(join(home, '.claude/settings.json'), '{"enabledPlugins":{"disabled@market":false}}')
    const helpers = createContextHelpers({
      agent: 'claude-code',
      homeRoot: home,
      cwd: disabled,
    })
    expect(Object.isFrozen(helpers)).toBe(true)

    expect(helpers.belongsToPlugin(enabledFile)).toBe(true)
    expect(helpers.belongsToPlugin(disabledFile)).toBe(true)
    expect(helpers.belongsToPlugin('asset.txt')).toBe(true)
    expect(helpers.belongsToPlugin(orphanedFile)).toBe(false)
  })

  test('uses canonical file containment and checks candidate state on every call', () => {
    const base = fresh('claude-paths')
    const home = join(base, 'home')
    const plugin = join(base, 'plugin')
    const outside = write(join(base, 'outside/file.txt'))
    const inside = write(join(plugin, 'nested/file.txt'))
    const sibling = write(join(`${plugin}-copy`, 'nested/file.txt'))
    const fakeCache = write(join(base, 'project/.claude/plugins/cache/plugin/file.txt'))
    const insideLink = join(plugin, 'inside-link.txt')
    const escapeLink = join(plugin, 'escape-link.txt')
    const outsideAlias = join(base, 'outside-alias.txt')
    symlinkSync(inside, insideLink)
    symlinkSync(outside, escapeLink)
    symlinkSync(inside, outsideAlias)
    writeClaudeRegistry(home, { 'plugin@market': [{ installPath: plugin }] })
    const helpers = createContextHelpers({
      agent: 'claude-code',
      homeRoot: home,
      cwd: join(plugin, 'nested'),
    })

    for (const path of [inside, insideLink, outsideAlias]) {
      expect(helpers.belongsToPlugin(path), path).toBe(true)
    }
    for (const path of [outside, sibling, fakeCache, escapeLink, plugin]) {
      expect(helpers.belongsToPlugin(path), path).toBe(false)
    }

    expect(helpers.belongsToPlugin('file.txt')).toBe(true)
    unlinkSync(outsideAlias)
    symlinkSync(outside, outsideAlias)
    expect(helpers.belongsToPlugin(outsideAlias)).toBe(false)
  })

  test('rejects raw root and combined candidate dotdot components', () => {
    const base = fresh('dotdot')
    const home = join(base, 'home')
    const plugin = join(base, 'plugin')
    const file = write(join(plugin, 'file.txt'))
    const rawRoot = `${plugin}/nested/..`
    mkdirSync(join(plugin, 'nested'))
    writeClaudeRegistry(home, { 'plugin@market': [{ installPath: rawRoot }] })
    const rejectedRoot = createContextHelpers({
      agent: 'claude-code',
      homeRoot: home,
      cwd: plugin,
    })
    expect(rejectedRoot.belongsToPlugin(file)).toBe(false)

    writeClaudeRegistry(home, { 'plugin@market': [{ installPath: plugin }] })
    const helpers = createContextHelpers({
      agent: 'claude-code',
      homeRoot: home,
      cwd: join(plugin, 'nested'),
    })
    expect(helpers.belongsToPlugin('../file.txt')).toBe(false)
    expect(helpers.belongsToPlugin(`${plugin}/nested/../file.txt`)).toBe(false)
    expect(
      createContextHelpers({
        agent: 'claude-code',
        homeRoot: home,
        cwd: 'relative',
      }).belongsToPlugin('file.txt'),
    ).toBe(false)
  })

  test('rejects symlink-directory dotdot when realpath disagrees with open traversal', () => {
    const base = fresh('symlink-dotdot')
    const home = join(base, 'home')
    const plugin = join(base, 'plugin')
    write(join(plugin, 'subdir/marker'))
    write(join(plugin, 'chosen.txt'), 'physical-plugin-file')
    write(join(base, 'chosen.txt'), 'lexical-outside-file')
    symlinkSync(join(plugin, 'subdir'), join(base, 'symlink-dir'))
    const candidate = `${base}/symlink-dir/../chosen.txt`
    writeClaudeRegistry(home, { 'plugin@market': [{ installPath: plugin }] })
    const helpers = createContextHelpers({ agent: 'claude-code', homeRoot: home, cwd: plugin })

    expect(readFileSync(candidate, 'utf8')).toBe('physical-plugin-file')
    if (Bun.version === '1.3.10') expect(realpathSync(candidate)).toBe(join(base, 'chosen.txt'))
    expect(helpers.belongsToPlugin(candidate)).toBe(false)
  })

  test('canonicalizes install-root symlinks and deduplicates physical roots', () => {
    const base = fresh('root-symlink')
    const home = join(base, 'home')
    const physical = join(base, 'physical-plugin')
    const alias = join(base, 'plugin-alias')
    const file = write(join(physical, 'asset.txt'))
    symlinkSync(physical, alias)
    writeClaudeRegistry(home, {
      'physical@market': [{ installPath: physical }],
      'alias@market': [{ installPath: alias }],
    })
    const rootRealpaths: string[] = []
    const fs: PluginFileSystem = {
      ...nodeFileSystem,
      realpath(path) {
        if (path === physical || path === alias) rootRealpaths.push(path)
        return realpathSync(path)
      },
    }
    const helpers = createContextHelpers({ agent: 'claude-code', homeRoot: home, cwd: alias }, fs)

    expect(helpers.belongsToPlugin(file)).toBe(true)
    expect(rootRealpaths).toEqual([physical, alias])
  })

  test('fails closed for missing, malformed, unreadable, and non-file inputs', () => {
    const base = fresh('claude-invalid')
    const home = join(base, 'home')
    const plugin = join(base, 'plugin')
    mkdirSync(plugin, { recursive: true })
    const missing = createContextHelpers({ agent: 'claude-code', homeRoot: home, cwd: plugin })
    expect(missing.belongsToPlugin(join(plugin, 'missing'))).toBe(false)

    write(join(home, '.claude/plugins/installed_plugins.json'), '{')
    expect(
      createContextHelpers({
        agent: 'claude-code',
        homeRoot: home,
        cwd: plugin,
      }).belongsToPlugin(plugin),
    ).toBe(false)

    const unreadable = createContextHelpers(
      { agent: 'claude-code', homeRoot: home, cwd: plugin },
      {
        ...nodeFileSystem,
        readText: () => {
          throw Object.assign(new Error('denied'), { code: 'EACCES' })
        },
      },
    )
    expect(unreadable.belongsToPlugin(join(plugin, 'file.txt'))).toBe(false)
    expect(unreadable.belongsToPlugin('')).toBe(false)
    expect(unreadable.belongsToPlugin('bad\0path')).toBe(false)
    expect(unreadable.belongsToPlugin(plugin)).toBe(false)
  })
})

describe('Codex materialized plugin membership', () => {
  test('rejects invalid raw home before default CODEX_HOME joining, including empty override', () => {
    const base = fresh('codex-invalid-home')
    const rawHome = `${base}/nested/..`
    mkdirSync(join(base, 'nested'))
    const root = writeCodexPlugin(join(base, '.codex'), 'market', 'tool', '1.0.0')
    const file = write(join(root, 'asset.txt'))

    for (const codexHome of [undefined, '']) {
      expect(
        createContextHelpers({
          agent: 'codex',
          homeRoot: rawHome,
          codexHome,
          cwd: root,
        }).belongsToPlugin(file),
      ).toBe(false)
    }
    expect(
      createContextHelpers({
        agent: 'codex',
        homeRoot: rawHome,
        codexHome: join(base, '.codex'),
        cwd: root,
      }).belongsToPlugin(file),
    ).toBe(true)
  })

  test('accepts disabled, unconfigured, and older valid cache versions under custom CODEX_HOME', () => {
    const base = fresh('codex-cache')
    const home = join(base, 'home')
    const codexHome = join(base, 'custom-codex')
    const oldRoot = writeCodexPlugin(codexHome, 'market', 'tool', '1.0.0')
    const newRoot = writeCodexPlugin(codexHome, 'market', 'tool', '2.0.0')
    const disabledRoot = writeCodexPlugin(codexHome, 'market', 'disabled', '1.0.0')
    const unconfiguredRoot = writeCodexPlugin(codexHome, 'other', 'unconfigured', 'local')
    const files = [
      write(join(oldRoot, 'old.txt')),
      write(join(newRoot, 'new.txt')),
      write(join(disabledRoot, 'disabled.txt')),
      write(join(unconfiguredRoot, 'unconfigured.txt')),
    ]
    write(join(codexHome, 'config.toml'), 'this is deliberately malformed and ignored')
    const helpers = createContextHelpers({
      agent: 'codex',
      homeRoot: home,
      codexHome,
      cwd: oldRoot,
    })

    for (const file of files) expect(helpers.belongsToPlugin(file), file).toBe(true)
  })

  test('requires a valid native manifest whose name matches the plugin directory', () => {
    const base = fresh('codex-manifests')
    const home = join(base, 'home')
    const codexHome = join(home, '.codex')
    const valid = writeCodexPlugin(codexHome, 'market', 'valid', '1.0.0')
    const malformed = writeCodexPlugin(codexHome, 'market', 'malformed', '1.0.0', 'bad')
    const mismatch = writeCodexPlugin(codexHome, 'market', 'mismatch', '1.0.0', { name: 'other' })
    const noManifest = join(codexHome, 'plugins/cache/market/missing/1.0.0')
    const validFile = write(join(valid, 'asset.txt'))
    const malformedFile = write(join(malformed, 'asset.txt'))
    const mismatchFile = write(join(mismatch, 'asset.txt'))
    const missingFile = write(join(noManifest, 'asset.txt'))
    write(join(malformed, '.codex-plugin/plugin.json'), '{')
    const helpers = createContextHelpers({ agent: 'codex', homeRoot: home, cwd: valid })

    expect(helpers.belongsToPlugin(validFile)).toBe(true)
    for (const file of [malformedFile, mismatchFile, missingFile]) {
      expect(helpers.belongsToPlugin(file), file).toBe(false)
    }
  })

  test('ignores unreadable activation config and fails closed on unreadable manifests', () => {
    const base = fresh('codex-unreadable')
    const home = join(base, 'home')
    const codexHome = join(base, 'codex')
    const root = writeCodexPlugin(codexHome, 'market', 'tool', '1.0.0')
    const file = write(join(root, 'asset.txt'))
    const configUnreadable: PluginFileSystem = {
      ...nodeFileSystem,
      readText(path) {
        if (path.endsWith('/config.toml'))
          throw Object.assign(new Error('config denied'), { code: 'EACCES' })
        return readFileSync(path, 'utf8')
      },
    }
    expect(
      createContextHelpers(
        { agent: 'codex', homeRoot: home, codexHome, cwd: root },
        configUnreadable,
      ).belongsToPlugin(file),
    ).toBe(true)

    const reads: string[] = []
    const manifestUnreadable: PluginFileSystem = {
      ...nodeFileSystem,
      readText(path) {
        reads.push(path)
        if (path.endsWith('/plugin.json'))
          throw Object.assign(new Error('manifest denied'), { code: 'EACCES' })
        return readFileSync(path, 'utf8')
      },
    }
    const helpers = createContextHelpers(
      { agent: 'codex', homeRoot: home, codexHome, cwd: root },
      manifestUnreadable,
    )

    expect(helpers.belongsToPlugin(file)).toBe(false)
    expect(reads.every((path) => !path.endsWith('/config.toml'))).toBe(true)
  })

  test('fails closed when fixed-depth directory enumeration or stat is unreadable', () => {
    const base = fresh('codex-io-errors')
    const home = join(base, 'home')
    const codexHome = join(base, 'codex')
    const cache = join(codexHome, 'plugins/cache')
    mkdirSync(cache, { recursive: true })

    const unreadableDirectory = createContextHelpers(
      { agent: 'codex', homeRoot: home, codexHome, cwd: base },
      {
        ...nodeFileSystem,
        readDirectory() {
          throw Object.assign(new Error('denied'), { code: 'EACCES' })
        },
      },
    )
    expect(unreadableDirectory.belongsToPlugin(write(join(base, 'outside.txt')))).toBe(false)

    const unreadableEntry = createContextHelpers(
      { agent: 'codex', homeRoot: home, codexHome, cwd: base },
      {
        ...nodeFileSystem,
        readDirectory(path) {
          return path === cache ? ['market'] : []
        },
        lstat(path) {
          if (path === join(cache, 'market'))
            throw Object.assign(new Error('denied'), { code: 'EACCES' })
          return lstatSync(path)
        },
      },
    )
    expect(unreadableEntry.belongsToPlugin(join(base, 'outside.txt'))).toBe(false)
  })
})

test('canonical root validation skips non-directories and filesystem errors', () => {
  const base = fresh('canonical-errors')
  const home = join(base, 'home')
  const fileRoot = write(join(base, 'file-root'))
  const errorRoot = join(base, 'error-root')
  mkdirSync(errorRoot)
  writeClaudeRegistry(home, {
    'file@market': [{ installPath: fileRoot }],
    'error@market': [{ installPath: errorRoot }],
  })
  const fs: PluginFileSystem = {
    ...nodeFileSystem,
    lstat(path) {
      if (path === errorRoot) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return lstatSync(path)
    },
  }
  const helpers = createContextHelpers({ agent: 'claude-code', homeRoot: home, cwd: base }, fs)

  expect(helpers.belongsToPlugin(fileRoot)).toBe(false)
})

test('discovery is lazy and roots are snapshotted once while candidates are not cached', () => {
  const base = fresh('lazy')
  const home = join(base, 'home')
  const plugin = join(base, 'plugin')
  const first = write(join(plugin, 'first.txt'))
  writeClaudeRegistry(home, { 'plugin@market': [{ installPath: plugin }] })
  let directoryReads = 0
  let registryReads = 0
  const fs: PluginFileSystem = {
    ...nodeFileSystem,
    readText(path) {
      if (path.endsWith('/installed_plugins.json')) registryReads++
      return readFileSync(path, 'utf8')
    },
    readDirectory(path) {
      directoryReads++
      return readdirSync(path)
    },
  }
  const helpers = createContextHelpers({ agent: 'claude-code', homeRoot: home, cwd: plugin }, fs)
  expect(registryReads).toBe(0)
  expect(directoryReads).toBe(0)
  expect(helpers.belongsToPlugin(first)).toBe(true)
  expect(helpers.belongsToPlugin(first)).toBe(true)
  expect(registryReads).toBe(1)
  expect(directoryReads).toBe(0)

  const secondRoot = join(base, 'second-plugin')
  const second = write(join(secondRoot, 'second.txt'))
  writeClaudeRegistry(home, {
    'plugin@market': [{ installPath: plugin }],
    'second@market': [{ installPath: secondRoot }],
  })
  expect(helpers.belongsToPlugin(second)).toBe(false)
  expect(
    createContextHelpers({ agent: 'claude-code', homeRoot: home, cwd: plugin }).belongsToPlugin(
      second,
    ),
  ).toBe(true)

  const replacement = write(join(base, 'replacement.txt'))
  renameSync(first, join(plugin, 'moved.txt'))
  symlinkSync(replacement, first)
  expect(helpers.belongsToPlugin(first)).toBe(false)
})
