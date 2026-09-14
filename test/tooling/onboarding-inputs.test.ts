import { afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freezeOnboardingInputs, verifyOnboardingInputs } from './onboarding-inputs'

if (process.env.CLOOKS_E2E_DOCKER !== 'true') {
  throw new Error('Tooling tests must run inside the test Docker container')
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'onboarding inputs-'))
  roots.push(root)
  const source = join(root, 'source')
  const target = join(root, 'snapshot')
  const put = (path: string, data: string) => {
    mkdirSync(join(source, path, '..'), { recursive: true })
    writeFileSync(join(source, path), data)
  }
  put('clooks/skills/setup/scripts/install.sh', '#!/bin/bash\nprintf fixture\n')
  chmodSync(join(source, 'clooks/skills/setup/scripts/install.sh'), 0o751)
  put('.claude-plugin/marketplace.json', '{"name":"claude","plugins":[]}\n')
  put('.agents/plugins/marketplace.json', '{"name":"codex","plugins":[]}\n')
  put('unrelated/ignored', 'not an onboarding input')
  mkdirSync(join(source, 'clooks/empty'))
  chmodSync(join(source, 'clooks/empty'), 0o750)
  return { root, source, target, put }
}

test('snapshot preserves package and both catalogs with byte and mode identity', () => {
  const { source, target } = fixture()
  const manifest = freezeOnboardingInputs(source, target)
  expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(
    manifest.entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path),
  ).toEqual([
    '.agents/plugins/marketplace.json',
    '.claude-plugin/marketplace.json',
    'clooks/skills/setup/scripts/install.sh',
  ])
  for (const entry of manifest.entries) {
    expect(lstatSync(join(target, entry.path)).mode & 0o777).toBe(entry.mode)
    if (entry.kind === 'file')
      expect(readFileSync(join(target, entry.path))).toEqual(readFileSync(join(source, entry.path)))
  }
  expect(() => verifyOnboardingInputs(target, manifest)).not.toThrow()
  expect(freezeOnboardingInputs(source, target + '-second')).toEqual(manifest)
})

test('live source changes do not mutate the frozen package', () => {
  const { source, target, put } = fixture()
  const manifest = freezeOnboardingInputs(source, target)
  put('clooks/skills/setup/scripts/install.sh', 'changed after capture')
  expect(() => verifyOnboardingInputs(source, manifest)).toThrow('bytes or modes changed')
  expect(() => verifyOnboardingInputs(target, manifest)).not.toThrow()
})

function packFixture() {
  const fixtureInput = fixture()
  const { put } = fixtureInput
  put(
    '.agents/plugins/marketplace.json',
    JSON.stringify({
      plugins: [
        { name: 'clooks', source: { source: 'local', path: './clooks' } },
        ...['core', 'project', 'example'].map((name) => ({
          name: `clooks-${name}-hooks`,
          source: { source: 'local', path: `./clooks-${name}-hooks` },
        })),
      ],
    }),
  )
  for (const name of ['core', 'project', 'example']) {
    const root = `clooks-${name}-hooks`
    put(`${root}/.claude-plugin/plugin.json`, JSON.stringify({ name: root, version: '0.3.0' }))
    put(`${root}/clooks-pack.json`, JSON.stringify({ name: root, version: 1, hooks: {} }))
    put(`${root}/hooks/guard.ts`, 'import { helper } from "./companion"\n')
    put(`${root}/hooks/companion.ts`, 'export const helper = true\n')
    put(`${root}/hooks/types.d.ts`, 'export interface ClooksHook {}\n')
    chmodSync(join(fixtureInput.source, root, 'hooks/companion.ts'), 0o640)
    chmodSync(join(fixtureInput.source, root, 'hooks'), 0o750)
  }
  return fixtureInput
}

test('freezes all actual catalog pack directories, companions, types and modes', () => {
  const { source, target } = packFixture()
  const manifest = freezeOnboardingInputs(source, target)
  expect(manifest.entries.filter((entry) => entry.path === 'clooks')).toHaveLength(1)
  const expectedFiles = [
    '.agents/plugins/marketplace.json',
    '.claude-plugin/marketplace.json',
    'clooks/skills/setup/scripts/install.sh',
    ...['core', 'project', 'example'].flatMap((name) =>
      [
        '.claude-plugin/plugin.json',
        'clooks-pack.json',
        'hooks/guard.ts',
        'hooks/companion.ts',
        'hooks/types.d.ts',
      ].map((path) => `clooks-${name}-hooks/${path}`),
    ),
  ].sort()
  expect(
    manifest.entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path),
  ).toEqual(expectedFiles)
  for (const path of expectedFiles) {
    const expectedHash = createHash('sha256')
      .update(readFileSync(join(source, path)))
      .digest('hex')
    expect(
      createHash('sha256')
        .update(readFileSync(join(target, path)))
        .digest('hex'),
    ).toBe(expectedHash)
    expect(manifest.entries.find((entry) => entry.path === path)?.sha256).toBe(expectedHash)
  }
  for (const entry of manifest.entries) {
    expect(lstatSync(join(target, entry.path)).mode & 0o777).toBe(entry.mode)
    if (entry.kind === 'file')
      expect(readFileSync(join(target, entry.path))).toEqual(readFileSync(join(source, entry.path)))
  }
  for (const name of ['core', 'project', 'example']) {
    expect(readFileSync(join(target, `clooks-${name}-hooks/hooks/companion.ts`), 'utf8')).toContain(
      'helper',
    )
  }
  expect(() => verifyOnboardingInputs(target, manifest)).not.toThrow()
})

test.each(['bytes', 'mode', 'missing', 'symlink-root', 'symlink-child'])(
  'catalog packs retain snapshot guarantees: %s',
  (change) => {
    const { source, target } = packFixture()
    const manifest = freezeOnboardingInputs(source, target)
    const root = join(target, 'clooks-core-hooks')
    const hook = join(root, 'hooks/guard.ts')
    if (change === 'bytes') writeFileSync(hook, 'changed')
    if (change === 'mode') chmodSync(hook, 0o711)
    if (change === 'missing') rmSync(root, { recursive: true })
    if (change.startsWith('symlink')) {
      const path = change === 'symlink-root' ? root : hook
      rmSync(path, { recursive: true })
      symlinkSync(
        change === 'symlink-root'
          ? join(source, 'clooks-core-hooks')
          : join(source, 'clooks-core-hooks/hooks/guard.ts'),
        path,
      )
    }
    expect(() => verifyOnboardingInputs(target, manifest)).toThrow()
    if (change.startsWith('symlink')) {
      expect(() => verifyOnboardingInputs(target, manifest)).toThrow('Unsupported onboarding input')
      expect(() => freezeOnboardingInputs(target, target + '-again')).toThrow(
        'Unsupported onboarding input',
      )
    } else if (change === 'missing') {
      expect(() => freezeOnboardingInputs(target, target + '-again')).toThrow()
    }
  },
)

test.each(['../escape', './nested/pack', '/absolute', './..', './', './pack/../escape'])(
  'rejects unsafe catalog source: %s',
  (path) => {
    const { source, target, put } = fixture()
    put(
      '.agents/plugins/marketplace.json',
      JSON.stringify({ plugins: [{ source: { source: 'local', path } }] }),
    )
    expect(() => freezeOnboardingInputs(source, target)).toThrow('local top-level')
  },
)

test.each(['bytes', 'catalog', 'mode', 'directory-mode', 'added', 'removed'])(
  'verification detects frozen %s drift',
  (change) => {
    const { source, target } = fixture()
    const manifest = freezeOnboardingInputs(source, target)
    const script = join(target, 'clooks/skills/setup/scripts/install.sh')
    if (change === 'bytes') writeFileSync(script, 'changed')
    if (change === 'catalog') writeFileSync(join(target, '.agents/plugins/marketplace.json'), '{}')
    if (change === 'mode') chmodSync(script, 0o711)
    if (change === 'directory-mode') chmodSync(join(target, 'clooks/empty'), 0o710)
    if (change === 'added') writeFileSync(join(target, 'clooks/new'), 'new')
    if (change === 'removed') rmSync(script)
    expect(() => verifyOnboardingInputs(target, manifest)).toThrow()
  },
)

test.each(['clooks', '.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json'])(
  'missing required input fails: %s',
  (path) => {
    const { source, target } = fixture()
    rmSync(join(source, path), { recursive: true })
    expect(() => freezeOnboardingInputs(source, target)).toThrow()
  },
)

test.each([
  'clooks',
  '.agents',
  '.claude-plugin/marketplace.json',
  'clooks/skills/setup/scripts/install.sh',
])('rejects symlinks instead of following them: %s', (path) => {
  const { source, target } = fixture()
  rmSync(join(source, path), { recursive: true })
  symlinkSync('/tmp', join(source, path))
  expect(() => freezeOnboardingInputs(source, target)).toThrow('Unsupported onboarding input')
})

test('requires an explicit regular source and a new destination outside it', () => {
  const { root, source, target } = fixture()
  expect(() => freezeOnboardingInputs('', target)).toThrow('explicit nonempty')
  expect(() => freezeOnboardingInputs(source, join(source, 'snapshot'))).toThrow(
    'outside its source',
  )
  symlinkSync(source, join(root, 'alias'))
  expect(() => freezeOnboardingInputs(join(root, 'alias'), target)).toThrow('regular directory')
  mkdirSync(target)
  expect(() => freezeOnboardingInputs(source, target)).toThrow()
})

test('rejects special files without reading from them', () => {
  const { source, target } = fixture()
  expect(spawnSync('mkfifo', [join(source, 'clooks/pipe')], { timeout: 1000 }).status).toBe(0)
  // A regressed synchronous FIFO read would prevent Bun's in-process timeout from firing.
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    import { freezeOnboardingInputs } from ${JSON.stringify(join(import.meta.dir, 'onboarding-inputs.ts'))};
    try {
      freezeOnboardingInputs(${JSON.stringify(source)}, ${JSON.stringify(target)});
      process.exitCode = 1;
    } catch (error) {
      console.log(String(error));
    }
  `,
    ],
    { timeout: 2000, killSignal: 'SIGKILL', encoding: 'utf8' },
  )
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('Unsupported onboarding input')
})
