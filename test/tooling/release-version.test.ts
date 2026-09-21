import { afterEach, describe, expect, test } from 'bun:test'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  formatPageVersion,
  ReleaseVersionDriftError,
  syncReleaseVersion,
} from '../../scripts/sync-release-version'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function put(root: string, path: string, contents: string): void {
  const destination = join(root, path)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, contents)
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

function fixture(version = '0.2.0') {
  const root = mkdtempSync(join(tmpdir(), 'clooks-release-version-'))
  roots.push(root)
  const repo = join(root, 'repo')
  const marketplace = join(root, 'marketplace')

  put(repo, 'package.json', json({ name: 'fixture', version, private: true, custom: { keep: 1 } }))
  put(repo, 'page/version.js', formatPageVersion(version))
  put(
    marketplace,
    'clooks/.claude-plugin/plugin.json',
    json({ name: 'clooks', version, description: 'keep claude' }),
  )
  put(
    marketplace,
    'clooks/.codex-plugin/plugin.json',
    json({ name: 'clooks', version, description: 'keep codex', interface: { keep: true } }),
  )
  put(
    marketplace,
    '.claude-plugin/marketplace.json',
    json({
      name: 'fixture-marketplace',
      owner: { keep: true },
      plugins: [
        { name: 'clooks', version, source: './clooks', extra: 'keep listing' },
        { name: 'clooks-example-hooks', version: '9.8.7', source: './example' },
        { name: 'clooks-core-hooks', version: '8.7.6', source: './core' },
      ],
    }),
  )
  return { root, repo, marketplace }
}

const selectedPaths = [
  'package.json',
  'page/version.js',
  '../marketplace/clooks/.claude-plugin/plugin.json',
  '../marketplace/clooks/.codex-plugin/plugin.json',
  '../marketplace/.claude-plugin/marketplace.json',
]

function selectedBytes(repo: string): Map<string, string> {
  return new Map(selectedPaths.map((path) => [path, readFileSync(resolve(repo, path), 'utf8')]))
}

describe('syncReleaseVersion', () => {
  test('writes local and explicitly selected marketplace outputs while preserving other fields', () => {
    const { repo, marketplace } = fixture()

    const result = syncReleaseVersion({ repo, marketplace, version: '0.3.0' })

    expect(result.changed).toEqual([
      'package.json',
      'page/version.js',
      'clooks/.claude-plugin/plugin.json',
      'clooks/.codex-plugin/plugin.json',
      '.claude-plugin/marketplace.json',
    ])
    expect(JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))).toEqual({
      name: 'fixture',
      version: '0.3.0',
      private: true,
      custom: { keep: 1 },
    })
    expect(readFileSync(join(repo, 'page/version.js'), 'utf8')).toBe(formatPageVersion('0.3.0'))
    expect(
      JSON.parse(readFileSync(join(marketplace, 'clooks/.claude-plugin/plugin.json'), 'utf8')),
    ).toEqual({ name: 'clooks', version: '0.3.0', description: 'keep claude' })
    expect(
      JSON.parse(readFileSync(join(marketplace, 'clooks/.codex-plugin/plugin.json'), 'utf8')),
    ).toEqual({
      name: 'clooks',
      version: '0.3.0',
      description: 'keep codex',
      interface: { keep: true },
    })

    const listing = JSON.parse(
      readFileSync(join(marketplace, '.claude-plugin/marketplace.json'), 'utf8'),
    )
    expect(listing.owner).toEqual({ keep: true })
    expect(listing.plugins).toEqual([
      { name: 'clooks', version: '0.3.0', source: './clooks', extra: 'keep listing' },
      { name: 'clooks-example-hooks', version: '9.8.7', source: './example' },
      { name: 'clooks-core-hooks', version: '8.7.6', source: './core' },
    ])
  })

  test('defaults to local outputs and leaves a sibling marketplace untouched', () => {
    const { repo, marketplace } = fixture()
    const before = selectedBytes(repo)

    expect(syncReleaseVersion({ repo, version: '0.3.0' }).changed).toEqual([
      'package.json',
      'page/version.js',
    ])

    for (const path of selectedPaths.slice(2)) {
      expect(readFileSync(resolve(repo, path), 'utf8')).toBe(before.get(path)!)
    }
  })

  test('check mode reports semantic drift without writing', () => {
    const { repo, marketplace } = fixture()
    const before = selectedBytes(repo)

    expect(() => syncReleaseVersion({ repo, marketplace, version: '0.3.0', check: true })).toThrow(
      ReleaseVersionDriftError,
    )
    expect(selectedBytes(repo)).toEqual(before)
  })

  test('is idempotent and leaves all bytes unchanged once synced', () => {
    const { repo, marketplace } = fixture()
    syncReleaseVersion({ repo, marketplace, version: '0.3.0' })
    const before = selectedBytes(repo)

    expect(syncReleaseVersion({ repo, marketplace, version: '0.3.0' }).changed).toEqual([])
    expect(selectedBytes(repo)).toEqual(before)
  })

  test('ignores cosmetic JSON formatting when versions are already in sync', () => {
    const { repo, marketplace } = fixture('0.3.0')
    put(repo, 'package.json', '{"name":"fixture","version":"0.3.0","private":true}\n')
    put(
      marketplace,
      'clooks/.claude-plugin/plugin.json',
      '{"name":"clooks","version":"0.3.0","custom":true}\n',
    )
    const before = selectedBytes(repo)

    expect(syncReleaseVersion({ repo, marketplace, version: '0.3.0' }).changed).toEqual([])
    expect(selectedBytes(repo)).toEqual(before)
  })

  test.each(['1.2.3-rc.4', '0.3.0+build.9', '1.2.3-rc.4+build.9'])(
    'accepts and synchronizes full SemVer %s',
    (version) => {
      const { repo, marketplace } = fixture()

      syncReleaseVersion({ repo, marketplace, version })

      expect(JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version).toBe(version)
      expect(readFileSync(join(repo, 'page/version.js'), 'utf8')).toBe(formatPageVersion(version))
    },
  )

  test('formats prerelease and build metadata literally for the page', () => {
    expect(formatPageVersion('1.2.3-rc.4+build.9')).toContain(
      'window.CLOOKS_VERSION = "1.2.3-rc.4+build.9";\n',
    )
  })

  test.each(['1.2', '01.2.3', '1.2.3-', 'v1.2.3', 'not-a-version'])(
    'rejects invalid SemVer %s before writing',
    (version) => {
      const { repo, marketplace } = fixture()
      const before = selectedBytes(repo)

      expect(() => syncReleaseVersion({ repo, marketplace, version })).toThrow(
        'release version must be full SemVer',
      )
      expect(selectedBytes(repo)).toEqual(before)
    },
  )

  test.each([
    ['missing package', 'package.json', undefined],
    ['malformed package JSON', 'package.json', '{'],
    ['missing marketplace manifest', '../marketplace/clooks/.codex-plugin/plugin.json', undefined],
    ['malformed marketplace manifest', '../marketplace/clooks/.codex-plugin/plugin.json', '[]\n'],
  ])('preflights %s without partial edits', (_name, path, replacement) => {
    const { repo, marketplace } = fixture()
    if (replacement === undefined) rmSync(resolve(repo, path))
    else writeFileSync(resolve(repo, path), replacement)
    const existing = selectedPaths.filter((candidate) => candidate !== path)
    const before = new Map(
      existing.map((candidate) => [candidate, readFileSync(resolve(repo, candidate), 'utf8')]),
    )

    expect(() => syncReleaseVersion({ repo, marketplace, version: '0.3.0' })).toThrow()
    for (const candidate of existing) {
      expect(readFileSync(resolve(repo, candidate), 'utf8')).toBe(before.get(candidate)!)
    }
  })

  test.each(['missing', 'blank'])(
    '%s generated page output is check-only drift and is regenerated',
    (state) => {
      const { repo, marketplace } = fixture('0.3.0')
      const generated = join(repo, 'page/version.js')
      if (state === 'missing') rmSync(generated)
      else writeFileSync(generated, '')

      expect(() =>
        syncReleaseVersion({ repo, marketplace, version: '0.3.0', check: true }),
      ).toThrow(ReleaseVersionDriftError)
      if (state === 'missing') expect(existsSync(generated)).toBe(false)
      else expect(readFileSync(generated, 'utf8')).toBe('')

      expect(syncReleaseVersion({ repo, marketplace, version: '0.3.0' }).changed).toEqual([
        'page/version.js',
      ])
      expect(readFileSync(generated, 'utf8')).toBe(formatPageVersion('0.3.0'))
    },
  )

  test('an unreadable generated output fails preflight instead of being treated as missing', () => {
    const { repo, marketplace } = fixture()
    const page = join(repo, 'page/version.js')
    rmSync(page)
    mkdirSync(page)
    const packageBefore = readFileSync(join(repo, 'package.json'), 'utf8')

    expect(() => syncReleaseVersion({ repo, marketplace, version: '0.3.0' })).toThrow(
      `cannot read ${page}`,
    )
    expect(readFileSync(join(repo, 'package.json'), 'utf8')).toBe(packageBefore)
  })

  test.each([
    ['no clooks listing', [{ name: 'other', version: '0.2.0' }]],
    [
      'duplicate clooks listings',
      [
        { name: 'clooks', version: '0.2.0' },
        { name: 'clooks', version: '0.2.0' },
      ],
    ],
  ])('rejects a marketplace with %s before writing', (_name, plugins) => {
    const { repo, marketplace } = fixture()
    put(marketplace, '.claude-plugin/marketplace.json', json({ name: 'fixture', plugins }))
    const before = selectedBytes(repo)

    expect(() => syncReleaseVersion({ repo, marketplace, version: '0.3.0' })).toThrow(
      'expected exactly one plugin named "clooks"',
    )
    expect(selectedBytes(repo)).toEqual(before)
  })
})

describe('sync-release-version CLI', () => {
  function cliFixture(version = '0.3.0', minimumRuntimeVersion = '0.3.0') {
    const result = fixture(version)
    const projectRoot = resolve(import.meta.dir, '../..')
    cpSync(
      join(projectRoot, 'scripts/sync-release-version.ts'),
      join(result.repo, 'scripts/sync-release-version.ts'),
    )
    cpSync(
      join(projectRoot, 'scripts/sync-page-version.ts'),
      join(result.repo, 'scripts/sync-page-version.ts'),
    )
    put(result.repo, 'src/version.ts', `export const VERSION = '${version}'\n`)
    put(
      result.repo,
      'src/installation-metadata.ts',
      `export const LAUNCHER_REVISION = 1\nexport const MIN_RUNTIME_VERSION = '${minimumRuntimeVersion}'\n`,
    )
    symlinkSync(join(projectRoot, 'node_modules'), join(result.repo, 'node_modules'), 'dir')
    return result
  }

  test.each([
    ['stable', '1.2.3', '0.3.0'],
    ['prerelease', '1.2.3', '1.2.3-rc.1'],
    ['build metadata', '1.2.3+release.2', '1.2.3+floor.1'],
  ])('accepts a canonical %s maintained runtime floor without writes', (_name, version, floor) => {
    const { repo } = cliFixture(version, floor)
    const before = selectedBytes(repo)
    const result = Bun.spawnSync(
      [process.execPath, join(repo, 'scripts/sync-release-version.ts'), '--check'],
      { cwd: repo },
    )

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(selectedBytes(repo)).toEqual(before)
  })

  test.each(['1.2', '01.2.3', 'v1.2.3'])(
    'rejects noncanonical maintained runtime floor %s without writes',
    (floor) => {
      const { repo } = cliFixture('1.2.3', floor)
      const before = selectedBytes(repo)
      const result = Bun.spawnSync(
        [process.execPath, join(repo, 'scripts/sync-release-version.ts'), '--check'],
        { cwd: repo },
      )

      expect(result.exitCode).toBe(1)
      expect(result.stderr.toString()).toContain('minimum runtime version must be full SemVer')
      expect(selectedBytes(repo)).toEqual(before)
    },
  )

  test.each([
    ['newer stable floor', '0.3.0', '0.3.1'],
    ['stable floor above prerelease', '1.2.3-rc.1', '1.2.3'],
  ])('rejects %s without writes', (_name, version, floor) => {
    const { repo } = cliFixture(version, floor)
    const before = selectedBytes(repo)
    const result = Bun.spawnSync(
      [process.execPath, join(repo, 'scripts/sync-release-version.ts'), '--check'],
      { cwd: repo },
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain(
      `minimum runtime version ${floor} exceeds release version ${version}`,
    )
    expect(selectedBytes(repo)).toEqual(before)
  })

  test('--check exits nonzero on drift and does not write', () => {
    const { repo } = cliFixture()
    put(
      repo,
      'package.json',
      json({ name: 'fixture', version: '0.2.0', private: true, custom: { keep: 1 } }),
    )
    const before = selectedBytes(repo)
    const result = Bun.spawnSync(
      [process.execPath, join(repo, 'scripts/sync-release-version.ts'), '--check'],
      { cwd: repo },
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('release version drift')
    expect(selectedBytes(repo)).toEqual(before)
  })

  test('write mode succeeds and invalid CLI arguments fail clearly', () => {
    const { repo } = cliFixture()
    put(
      repo,
      'package.json',
      json({ name: 'fixture', version: '0.2.0', private: true, custom: { keep: 1 } }),
    )
    put(repo, 'page/version.js', formatPageVersion('0.2.0'))

    const write = Bun.spawnSync([process.execPath, join(repo, 'scripts/sync-release-version.ts')], {
      cwd: repo,
    })
    expect(write.exitCode, write.stderr.toString()).toBe(0)
    expect(JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))).toEqual({
      name: 'fixture',
      version: '0.3.0',
      private: true,
      custom: { keep: 1 },
    })
    expect(readFileSync(join(repo, 'page/version.js'), 'utf8')).toBe(formatPageVersion('0.3.0'))

    const invalid = Bun.spawnSync(
      [process.execPath, join(repo, 'scripts/sync-release-version.ts'), '--unknown'],
      { cwd: repo },
    )
    expect(invalid.exitCode).toBe(1)
    expect(invalid.stderr.toString()).toContain('unknown argument: --unknown')
  })

  test('standalone page sync recreates its missing generated output', () => {
    const { repo } = cliFixture()
    const page = join(repo, 'page/version.js')
    rmSync(page)

    const result = Bun.spawnSync([process.execPath, join(repo, 'scripts/sync-page-version.ts')], {
      cwd: repo,
    })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(readFileSync(page, 'utf8')).toBe(formatPageVersion('0.3.0'))
  })

  test('--marketplace syncs both repositories and passes a subsequent check', () => {
    const { repo, marketplace } = cliFixture()
    const script = join(repo, 'scripts/sync-release-version.ts')
    put(
      repo,
      'package.json',
      json({ name: 'fixture', version: '0.2.0', private: true, custom: { keep: 1 } }),
    )
    put(repo, 'page/version.js', formatPageVersion('0.2.0'))
    put(
      marketplace,
      'clooks/.claude-plugin/plugin.json',
      json({ name: 'clooks', version: '0.2.0', description: 'keep claude' }),
    )
    put(
      marketplace,
      'clooks/.codex-plugin/plugin.json',
      json({
        name: 'clooks',
        version: '0.2.0',
        description: 'keep codex',
        interface: { keep: true },
      }),
    )
    put(
      marketplace,
      '.claude-plugin/marketplace.json',
      json({
        name: 'fixture-marketplace',
        owner: { keep: true },
        plugins: [
          { name: 'clooks', version: '0.2.0', source: './clooks', extra: 'keep listing' },
          { name: 'clooks-example-hooks', version: '9.8.7', source: './example' },
          { name: 'clooks-core-hooks', version: '8.7.6', source: './core' },
        ],
      }),
    )

    const write = Bun.spawnSync([process.execPath, script, '--marketplace', marketplace], {
      cwd: repo,
    })

    expect(write.exitCode, write.stderr.toString()).toBe(0)
    expect(JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version).toBe('0.3.0')
    expect(readFileSync(join(repo, 'page/version.js'), 'utf8')).toBe(formatPageVersion('0.3.0'))
    expect(
      JSON.parse(readFileSync(join(marketplace, 'clooks/.claude-plugin/plugin.json'), 'utf8'))
        .version,
    ).toBe('0.3.0')
    expect(
      JSON.parse(readFileSync(join(marketplace, 'clooks/.codex-plugin/plugin.json'), 'utf8'))
        .version,
    ).toBe('0.3.0')
    expect(
      JSON.parse(readFileSync(join(marketplace, '.claude-plugin/marketplace.json'), 'utf8'))
        .plugins,
    ).toEqual([
      { name: 'clooks', version: '0.3.0', source: './clooks', extra: 'keep listing' },
      { name: 'clooks-example-hooks', version: '9.8.7', source: './example' },
      { name: 'clooks-core-hooks', version: '8.7.6', source: './core' },
    ])

    const check = Bun.spawnSync(
      [process.execPath, script, '--check', '--marketplace', marketplace],
      { cwd: repo },
    )
    expect(check.exitCode, check.stderr.toString()).toBe(0)
  })
})
