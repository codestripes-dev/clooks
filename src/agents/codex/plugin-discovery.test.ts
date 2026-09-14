import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { discoverCodexPluginPacks } from './plugin-discovery.js'

let root: string
let homeRoot: string
let projectRoot: string
let codexHome: string
let warn: ReturnType<typeof spyOn>
const manifest = {
  version: 1,
  name: 'test-pack',
  hooks: { test: { path: 'hooks/test.ts', description: 'Test' } },
}

function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
function config(text: string, scope = codexHome) {
  write(join(scope, 'config.toml'), text)
}
function pack(version = '1.0.0', key = 'test@market') {
  const [plugin, marketplace] = key.split('@')
  const path = join(codexHome, 'plugins/cache', marketplace!, plugin!, version)
  write(join(path, 'clooks-pack.json'), JSON.stringify(manifest))
  return path
}
function discover() {
  return discoverCodexPluginPacks({ homeRoot, projectRoot, codexHome })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clooks-codex-packs-'))
  homeRoot = join(root, 'home')
  projectRoot = join(root, 'repo')
  codexHome = join(homeRoot, '.codex')
  mkdirSync(projectRoot, { recursive: true })
  warn = spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
  rmSync(root, { recursive: true, force: true })
})

describe('file-backed Codex pack discovery', () => {
  test('missing config/cache and unrelated packs are ordinary absence', () => {
    expect(discover()).toEqual([])
    config('[plugins."test@market"]\nenabled = true')
    expect(discover()).toEqual([])
    const path = pack()
    rmSync(join(path, 'clooks-pack.json'))
    expect(discover()).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  test('default home path, explicit Codex home and no implicit environment', () => {
    config('[plugins."test@market"]')
    const path = pack()
    expect(discoverCodexPluginPacks({ homeRoot, projectRoot })).toEqual([
      { pluginName: 'test@market', scope: 'user', installPath: path, manifest },
    ])
    codexHome = join(root, 'custom home')
    config('[plugins."custom@market"]')
    pack('1.0.0', 'custom@market')
    expect(discover().map((p) => p.pluginName)).toEqual(['custom@market'])
    expect(discoverCodexPluginPacks({ homeRoot, projectRoot })[0]!.pluginName).toBe('test@market')
  })

  test('empty Codex home defaults; conflicting process environment and cwd are ignored', () => {
    config('[plugins."test@market"]')
    const path = pack()
    const expected = discover()
    const oldEnv = process.env.CODEX_HOME
    const oldCwd = process.cwd()
    const explicitHome = codexHome
    codexHome = join(root, 'conflicting-codex')
    config('[plugins."other@market"]')
    pack('1.0.0', 'other@market')
    const conflictingHome = codexHome
    const conflictingCwd = join(root, 'conflicting-cwd')
    config('[plugins."other@market"]', join(conflictingCwd, '.codex'))
    codexHome = explicitHome
    pack('1.0.0', 'other@market')
    expect(
      discoverCodexPluginPacks({ homeRoot, projectRoot, codexHome: conflictingHome })[0]!
        .pluginName,
    ).toBe('other@market')
    expect(
      discoverCodexPluginPacks({ homeRoot, projectRoot: conflictingCwd }).map((p) => p.pluginName),
    ).toEqual(['other@market', 'test@market'])
    try {
      process.env.CODEX_HOME = conflictingHome
      process.chdir(conflictingCwd)
      expect(discover()).toEqual(expected)
      expect(discoverCodexPluginPacks({ homeRoot, projectRoot, codexHome: '' })).toEqual(expected)
      expect(discoverCodexPluginPacks({ homeRoot, projectRoot })).toEqual(expected)
      expect(discover()[0]!.installPath).toBe(path)
    } finally {
      process.chdir(oldCwd)
      if (oldEnv === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = oldEnv
    }
  })

  for (const alias of ['home-directory', 'config-file', 'project-directory']) {
    test(`${alias} alias cannot turn user activation into project activation`, () => {
      config('[plugins."test@market"]\nenabled = true')
      pack()
      if (alias === 'home-directory') {
        symlinkSync(codexHome, join(projectRoot, '.codex'))
      } else if (alias === 'config-file') {
        mkdirSync(join(projectRoot, '.codex'))
        symlinkSync(join(codexHome, 'config.toml'), join(projectRoot, '.codex/config.toml'))
      } else {
        projectRoot = join(root, 'home-alias')
        symlinkSync(homeRoot, projectRoot)
      }
      expect(discover().map((p) => p.scope)).toEqual(['user'])
      const selected = join(root, 'codex-alias')
      symlinkSync(codexHome, selected)
      codexHome = selected
      expect(discover().map((p) => p.scope)).toEqual(['user'])
    })
  }

  test('invalid explicit home warns and suppresses discovery', () => {
    codexHome = 'relative-home'
    expect(discover()).toEqual([])
    expect(warn.mock.calls[0]![0]).toContain('CODEX_HOME must be an absolute path')
  })

  for (const [user, project, scope] of [
    ['enabled = true', 'enabled = false', null],
    ['enabled = false', 'enabled = true', 'project'],
    ['enabled = false', '', null],
    ['enabled = true', 'other = "value"', 'user'],
    ['', 'other = "value"', 'user'],
    ['enabled = true', 'enabled = true', 'project'],
  ] as const) {
    test(`field overlay: user ${user}, project ${project}`, () => {
      config(`[plugins."test@market"]\n${user}`)
      config(`[plugins."test@market"]\n${project}`, join(projectRoot, '.codex'))
      pack()
      expect(discover().map((p) => p.scope)).toEqual(scope ? [scope] : [])
    })
  }
  test('project-only table defaults true and uses project scope', () => {
    config('[plugins."test@market"]', join(projectRoot, '.codex'))
    pack()
    expect(discover()[0]!.scope).toBe('project')
  })
  test('Codex user config is never also a project activation', () => {
    projectRoot = homeRoot
    config('[plugins."test@market"]')
    pack()
    expect(discover().map((p) => p.scope)).toEqual(['user'])
  })

  for (const marker of ['git-file', 'git-directory', 'custom']) {
    test(`nearest ${marker} includes ancestors through anchor, not mutable cwd`, () => {
      const parent = projectRoot
      if (marker === 'git-file') write(join(parent, '.git'), 'gitdir: elsewhere')
      if (marker === 'git-directory') write(join(parent, '.git/HEAD'), 'ref: refs/heads/main')
      if (marker === 'custom') {
        config('project_root_markers = ["workspace"]')
        write(join(parent, 'workspace'), '')
      }
      config('[plugins."test@market"]\nenabled = false', join(parent, '.codex'))
      projectRoot = join(parent, 'nested', 'anchor')
      mkdirSync(projectRoot, { recursive: true })
      pack()
      expect(discover()).toEqual([])
      config('[plugins."test@market"]', join(projectRoot, '.codex'))
      expect(discover()).toEqual([])
      config('[plugins."test@market"]\nenabled = true', join(projectRoot, '.codex'))
      expect(discover()[0]!.scope).toBe('project')
      config('[plugins."test@market"]\nenabled = false', join(projectRoot, 'tool-cwd', '.codex'))
      expect(discover()[0]!.scope).toBe('project')
    })
  }
  for (const mode of ['missing-marker', 'git-without-head', 'empty-markers', 'nearest-marker']) {
    test(`${mode} excludes outer activation`, () => {
      const parent = projectRoot
      config('[plugins."test@market"]', join(parent, '.codex'))
      if (mode === 'git-without-head') mkdirSync(join(parent, '.git'))
      if (mode === 'empty-markers') {
        write(join(parent, '.git'), 'gitdir')
        config('project_root_markers = []')
      }
      if (mode === 'nearest-marker') write(join(parent, '.git'), 'gitdir')
      projectRoot = join(parent, 'nested')
      mkdirSync(projectRoot)
      if (mode === 'nearest-marker') write(join(projectRoot, '.git'), 'gitdir')
      pack()
      expect(discover()).toEqual([])
      expect(warn).not.toHaveBeenCalled()
    })
  }

  test('feature flag overlays and disabled discovery preserve no broader activation', () => {
    config('[plugins."test@market"]\n[features]\nplugins = false')
    pack()
    expect(discover()).toEqual([])
    config('[features]\nplugins = true', join(projectRoot, '.codex'))
    expect(discover()).toHaveLength(1)
    config('[features]\nplugins = false', join(projectRoot, '.codex'))
    expect(discover()).toEqual([])
  })

  for (const invalid of [
    'plugins = {',
    'plugins = false',
    'features = []',
    'project_root_markers = false',
    'project_root_markers = [".git", 1]',
    '[plugins]\n"test@market" = false',
    '[plugins."test@market"]\nenabled = "false"',
    '[features]\nplugins = "false"',
    '[plugins."unrelated@market"]\nenabled = 1',
  ]) {
    for (const scope of ['user', 'project']) {
      test(`batch suppressed for invalid ${scope} field: ${invalid}`, () => {
        config('[plugins."test@market"]')
        pack()
        expect(discover()).toHaveLength(1)
        const path = scope === 'user' ? codexHome : join(projectRoot, '.codex')
        config(invalid, path)
        expect(discover()).toEqual([])
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0]![0]).toContain(join(path, 'config.toml'))
      })
    }
  }
  test('directory config path suppresses batch rather than ignoring an override', () => {
    config('[plugins."test@market"]')
    pack()
    const path = join(projectRoot, '.codex/config.toml')
    mkdirSync(path, { recursive: true })
    expect(discover()).toEqual([])
    expect(warn.mock.calls[0]![0]).toContain(path)
  })
  test('unreadable config and marker suppress discovery with the offending path', () => {
    config('[plugins."test@market"]')
    pack()
    const path = join(projectRoot, '.codex/config.toml')
    config('', dirname(path))
    chmodSync(path, 0)
    try {
      expect(discover()).toEqual([])
      expect(warn.mock.calls[0]![0]).toContain(path)
    } finally {
      chmodSync(path, 0o600)
    }
    const git = join(projectRoot, '.git')
    mkdirSync(git)
    chmodSync(git, 0)
    try {
      expect(discover()).toEqual([])
      expect(warn.mock.calls[1]![0]).toContain(git)
    } finally {
      chmodSync(git, 0o700)
    }
  })
  test('unrelated native keys and hidden profile values are not inferred', () => {
    config(
      'model = "anything"\nprofile = "hidden"\n[profiles.hidden.plugins."test@market"]\nenabled = true',
    )
    pack()
    expect(discover()).toEqual([])
  })

  for (const [versions, expected] of [
    [['0.9.0', '0.10.0', '0.3.0'], '0.10.0'],
    [['1.0.0+2', '1.0.0+10'], '1.0.0+10'],
    [['1.0.0+01', '1.0.0+1'], '1.0.0+01'],
    [['1.0.0+001', '1.0.0+01'], '1.0.0+001'],
    [['1.0.0+001', '1.0.0+2'], '1.0.0+2'],
    [['1.0.0+00', '1.0.0+0'], '1.0.0+00'],
    [['9007199254740992.0.0', '999999999999999.0.0'], '9007199254740992.0.0'],
    [['1.9007199254740993.0', '1.9007199254740992.0'], '1.9007199254740993.0'],
    [['1.0.9007199254740993', '1.0.9007199254740992'], '1.0.9007199254740993'],
    [['18446744073709551615.0.0', '9.0.0'], '18446744073709551615.0.0'],
    [['18446744073709551616.0.0', '9.0.0'], '9.0.0'],
    [['1.0.0-9007199254740992', '1.0.0-9007199254740993'], '1.0.0-9007199254740993'],
    [['1.0.0+9007199254740992', '1.0.0+9007199254740993'], '1.0.0+9007199254740993'],
    [['1.0.0-10', '1.0.0-alpha'], '1.0.0-alpha'],
    [['1.0.0-alpha.a', '1.0.0-alpha.b'], '1.0.0-alpha.b'],
    [['1.0.0-alpha', '1.0.0-alpha.1'], '1.0.0-alpha.1'],
    [['1.0.0+1', '1.0.0+a'], '1.0.0+a'],
    [['1.0.0+1', '1.0.0+1.2'], '1.0.0+1.2'],
    [['1.0.0+01.a', '1.0.0+1.z'], '1.0.0+01.a'],
    [['1.0.0-01', '1.0.0-0'], '1.0.0-01'],
    [['1.0.0-alpha.2', '1.0.0-alpha.10'], '1.0.0-alpha.10'],
    [['1.0.0-alpha', '1.0.0'], '1.0.0'],
    [['release-2', 'release-10'], 'release-2'],
    [['9.0.0', 'release-2'], 'release-2'],
    [['v1.2.3', '9.0.0'], 'v1.2.3'],
    [['v9.0.0', 'v10.0.0'], 'v9.0.0'],
    [['1.2', '1.10.0'], '1.2'],
    [['01.2.3', '0.9.0'], '01.2.3'],
    [['local', '99.0.0', 'z-last'], 'local'],
  ] as Array<[string[], string]>) {
    test(`native selection ${versions.join(', ')} -> ${expected}`, () => {
      config('[plugins."test@market"]')
      for (const version of versions) pack(version)
      expect(discover()[0]!.installPath).toBe(
        join(codexHome, 'plugins/cache/market/test', expected),
      )
    })
  }
  test('non-directory, symlink and unsafe version entries never select', () => {
    config('[plugins."test@market"]')
    const path = pack()
    const base = dirname(path)
    write(join(base, '99.0.0'), 'not a directory')
    symlinkSync(path, join(base, 'local'))
    pack('bad version')
    pack('z:invalid')
    expect(discover()[0]!.installPath).toBe(path)
  })
  test('non-directory plugin parent is ignored', () => {
    config('[plugins."test@market"]')
    const path = pack()
    expect(discover()).toHaveLength(1)
    rmSync(dirname(path), { recursive: true })
    write(dirname(path), 'file')
    expect(discover()).toEqual([])
  })
  for (const parent of ['plugin', 'marketplace']) {
    test(`symlink ${parent} target contains a directly discoverable pack`, () => {
      config('[plugins."test@market"]')
      const path = pack()
      expect(discover()[0]!.installPath).toBe(path)
      const original = parent === 'plugin' ? dirname(path) : dirname(dirname(path))
      const target = join(root, 'link-target')
      renameSync(original, target)
      symlinkSync(target, original)
      expect(discover()).toEqual([])
      rmSync(original)
      renameSync(target, original)
      expect(discover()[0]!.installPath).toBe(path)
    })
  }
  test('unreadable cache warns and skips', () => {
    config('[plugins."test@market"]')
    const base = dirname(pack())
    chmodSync(base, 0)
    try {
      expect(discover()).toEqual([])
      expect(warn.mock.calls[0]![0]).toContain(base)
    } finally {
      chmodSync(base, 0o700)
    }
  })
  test('empty cache returns no pack', () => {
    config('[plugins."test@market"]')
    const path = pack()
    rmSync(path, { recursive: true })
    expect(discover()).toEqual([])
  })
  test('invalid active manifest warns without falling back or importing hooks', () => {
    config('[plugins."test@market"]')
    pack('1.0.0')
    const selected = pack('2.0.0')
    write(join(selected, 'clooks-pack.json'), '{}')
    write(join(selected, 'hooks/test.ts'), 'throw new Error("must not import")')
    expect(discover()).toEqual([])
    expect(warn.mock.calls[0]![0]).toContain(selected)
    rmSync(join(selected, 'clooks-pack.json'))
    expect(discover()).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
  })
  test('only configured safe identities, in deterministic order', () => {
    const keys = [
      'z@market',
      'a@market',
      '../bad@market',
      'bad@../market',
      'bad',
      'bad@@market',
      '.bad@market',
      'bad..name@market',
      'bad@market.name',
    ]
    config(keys.map((key) => `[plugins.${JSON.stringify(key)}]`).join('\n'))
    pack('1.0.0', 'z@market')
    pack('1.0.0', 'a@market')
    pack('1.0.0', 'unconfigured@market')
    for (const key of keys.filter((key) => key.includes('@') && !key.includes('@@'))) {
      pack('1.0.0', key)
    }
    expect(discover().map((p) => p.pluginName)).toEqual(['a@market', 'z@market'])
  })
})
