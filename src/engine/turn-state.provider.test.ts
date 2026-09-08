import { describe, expect, test } from 'bun:test'
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hn } from '../test-utils.js'
import {
  applyTurnBoundary,
  createTurnTracker,
  emptyTurnState,
  pruneTurnState,
  readTurnState,
  TURN_STATE_TTL_MS,
  turnStatePath,
} from './turn-state.js'

describe('provider-qualified turn storage', () => {
  for (const boundary of [null, 'advance', 'reset'] as const) {
    test(`Codex captured writer ${boundary ?? 'no boundary'} preserves only its valid generation`, async () => {
      const homeRoot = await mkdtemp(join(tmpdir(), 'clooks-provider-generation-'))
      try {
        const path = turnStatePath(homeRoot, 'shared', 'codex')
        const foreignPath = turnStatePath(homeRoot, 'shared')
        for (const [provider, target] of [
          ['codex', path],
          ['claude-code', foreignPath],
        ] as const) {
          const seed = createTurnTracker({
            path: target,
            homeRoot,
            provider,
            state: emptyTurnState(),
            scopeKey: 'main',
          })
          seed.record(hn('seed'), 'Stop', 'block')
          await seed.commit()
        }
        const foreignBytes = await readFile(foreignPath, 'utf8')
        const snapshot = await readTurnState(path, { homeRoot, provider: 'codex' })
        const stale = createTurnTracker({
          path,
          homeRoot,
          provider: 'codex',
          state: snapshot,
          scopeKey: 'agent:child-a',
        })
        stale.record(hn('late'), 'SubagentStop', 'block')
        if (boundary) await applyTurnBoundary(path, homeRoot, boundary, 'codex')
        const current = await readTurnState(path, { homeRoot, provider: 'codex' })
        const fresh = createTurnTracker({
          path,
          homeRoot,
          provider: 'codex',
          state: current,
          scopeKey: 'main',
        })
        fresh.record(hn('fresh'), 'Stop', 'skip')
        await fresh.commit()
        await stale.commit()
        const stored = await readTurnState(path, { homeRoot, provider: 'codex' })
        expect(stored.scopes.main?.[hn('fresh')]).toHaveLength(1)
        expect(stored.generation).toBe(snapshot.generation + (boundary ? 1 : 0))
        if (boundary) expect(stored.scopes['agent:child-a']).toBeUndefined()
        else expect(stored.scopes['agent:child-a']?.[hn('late')]).toHaveLength(1)
        expect(await readFile(foreignPath, 'utf8')).toBe(foreignBytes)
      } finally {
        await rm(homeRoot, { recursive: true, force: true })
      }
    })
  }

  test('Codex prune and recreation rejects an equal-generation writer from the old epoch', async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), 'clooks-provider-epoch-'))
    try {
      const path = turnStatePath(homeRoot, 'shared', 'codex')
      const initial = createTurnTracker({
        path,
        homeRoot,
        provider: 'codex',
        state: emptyTurnState(),
        scopeKey: 'main',
      })
      initial.record(hn('seed'), 'Stop', 'block')
      await initial.commit()
      const old = await readTurnState(path, { homeRoot, provider: 'codex' })
      const stale = createTurnTracker({
        path,
        homeRoot,
        provider: 'codex',
        state: old,
        scopeKey: 'main',
      })
      stale.record(hn('late'), 'Stop', 'block')
      const expired = new Date(Date.now() - TURN_STATE_TTL_MS - 60_000)
      await utimes(path, expired, expired)
      await pruneTurnState(homeRoot, 'codex')
      await expect(stat(path)).rejects.toThrow()
      const replacement = createTurnTracker({
        path,
        homeRoot,
        provider: 'codex',
        state: emptyTurnState(),
        scopeKey: 'main',
      })
      replacement.record(hn('fresh'), 'Stop', 'skip')
      await replacement.commit()
      const fresh = await readTurnState(path, { homeRoot, provider: 'codex' })
      expect(fresh.generation).toBe(old.generation)
      expect(fresh.epoch).not.toBe(old.epoch)
      expect(fresh.scopes.main?.[hn('fresh')]).toHaveLength(1)
      expect(fresh.scopes.main?.[hn('fresh')]?.[0]?.decision).toBe('skip')
      await stale.commit()
      expect((await readTurnState(path, { homeRoot, provider: 'codex' })).scopes).toEqual(
        fresh.scopes,
      )
    } finally {
      await rm(homeRoot, { recursive: true, force: true })
    }
  })

  test('Codex concurrent commits preserve each scope and repeated commits are idempotent', async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), 'clooks-provider-concurrent-'))
    try {
      const path = turnStatePath(homeRoot, 'shared', 'codex')
      const initial = createTurnTracker({
        path,
        homeRoot,
        provider: 'codex',
        state: emptyTurnState(),
        scopeKey: 'main',
      })
      initial.record(hn('seed'), 'Stop', 'skip')
      await initial.commit()
      const state = await readTurnState(path, { homeRoot, provider: 'codex' })
      const trackers = ['main', 'agent:child-a', 'agent:child-b'].map((scopeKey) => {
        const tracker = createTurnTracker({ path, homeRoot, provider: 'codex', state, scopeKey })
        tracker.record(hn('same-hook'), 'Stop', 'block')
        return tracker
      })
      await Promise.all(trackers.map((tracker) => tracker.commit()))
      const stored = await readTurnState(path, { homeRoot, provider: 'codex' })
      for (const scopeKey of ['main', 'agent:child-a', 'agent:child-b']) {
        expect(stored.scopes[scopeKey]?.[hn('same-hook')]).toHaveLength(1)
      }
      const bytes = await readFile(path, 'utf8')
      await Promise.all(trackers.map((tracker) => tracker.commit()))
      expect(await readFile(path, 'utf8')).toBe(bytes)
    } finally {
      await rm(homeRoot, { recursive: true, force: true })
    }
  })

  for (const provider of ['claude-code', 'codex'] as const) {
    test.skipIf(process.env.CLOOKS_E2E_DOCKER !== 'true')(
      `${provider} history rejects an unread FIFO within a subprocess deadline`,
      async () => {
        const home = await mkdtemp(join(tmpdir(), 'clooks-fifo-turn-'))
        try {
          const regularPath = turnStatePath(home, 'regular', provider)
          const fifoPath = turnStatePath(home, 'fifo', provider)
          const tracker = createTurnTracker({
            path: regularPath,
            homeRoot: home,
            provider,
            state: emptyTurnState(),
            scopeKey: 'main',
          })
          tracker.record(hn('control'), 'PreToolUse', 'allow')
          await tracker.commit()
          const created = Bun.spawnSync(['mkfifo', '--', fifoPath], {
            env: { PATH: '/usr/bin:/bin', HOME: home },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 2000,
            killSignal: 'SIGKILL',
          })
          expect({ code: created.exitCode, stderr: created.stderr.toString() }).toEqual({
            code: 0,
            stderr: '',
          })
          const before = await lstat(fifoPath)
          expect(before.isFIFO()).toBe(true)
          const reader = join(home, 'read-turn.ts')
          const access =
            provider === 'codex' ? `, ${JSON.stringify({ homeRoot: home, provider })}` : ''
          await writeFile(
            reader,
            [
              `import { readTurnState } from ${JSON.stringify(fileURLToPath(new URL('./turn-state.ts', import.meta.url)))}`,
              `const regular = await readTurnState(${JSON.stringify(regularPath)}${access})`,
              `const fifo = await readTurnState(${JSON.stringify(fifoPath)}${access})`,
              'console.log(JSON.stringify({ regular: regular.scopes, fifo: fifo.scopes }))',
            ].join('\n'),
          )
          const child = Bun.spawnSync([process.execPath, reader], {
            env: {
              ...process.env,
              HOME: home,
              CLOOKS_HOME_ROOT: home,
              CODEX_HOME: join(home, '.codex'),
            },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 2000,
            killSignal: 'SIGKILL',
          })
          expect(child.exitCode).toBe(0)
          const observed = JSON.parse(child.stdout.toString())
          expect(observed.regular.main.control).toHaveLength(1)
          expect(observed.fifo).toEqual({})
          expect(child.stderr.toString()).toContain('turn state file is unreadable')
          const after = await lstat(fifoPath)
          expect(after.isFIFO()).toBe(true)
          expect(after.ino).toBe(before.ino)
        } finally {
          await rm(home, { recursive: true, force: true })
        }
      },
    )
  }

  test.each(['provider-directory', 'state-file'] as const)(
    'Codex snapshot refuses a linked %s without reading Claude history',
    async (kind) => {
      const home = await mkdtemp(join(tmpdir(), 'clooks-linked-turn-'))
      try {
        const claudePath = turnStatePath(home, 'shared')
        const codexPath = turnStatePath(home, 'shared', 'codex')
        const tracker = createTurnTracker({
          path: claudePath,
          homeRoot: home,
          state: emptyTurnState(),
          scopeKey: 'main',
        })
        tracker.record(hn('sentinel'), 'PreToolUse', 'block')
        await tracker.commit()
        const before = await readFile(claudePath, 'utf8')
        expect((await readTurnState(claudePath)).scopes).not.toEqual({})
        const stale = new Date(Date.now() - TURN_STATE_TTL_MS - 1000)
        await utimes(claudePath, stale, stale)
        const ownedPath = turnStatePath(home, 'owned-control', 'codex')
        const owned = createTurnTracker({
          path: ownedPath,
          homeRoot: home,
          provider: 'codex',
          state: emptyTurnState(),
          scopeKey: 'main',
        })
        owned.record(hn('owned'), 'PreToolUse', 'allow')
        await owned.commit()
        await utimes(ownedPath, stale, stale)
        await pruneTurnState(home, 'codex')
        expect(await readdir(dirname(ownedPath))).toEqual([])
        expect(await readFile(claudePath, 'utf8')).toBe(before)
        if (kind === 'provider-directory') {
          await rm(dirname(codexPath), { recursive: true })
          await symlink(dirname(claudePath), dirname(codexPath))
        } else {
          await symlink(claudePath, codexPath)
        }
        const snapshot = await readTurnState(codexPath, { homeRoot: home, provider: 'codex' })
        expect(snapshot.scopes).toEqual({})
        expect(await readFile(claudePath, 'utf8')).toBe(before)
        await pruneTurnState(home, 'codex')
        expect(await readFile(claudePath, 'utf8')).toBe(before)
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    },
  )

  test('equal sessions retain independent commits, boundaries and pruning', async () => {
    const home = await mkdtemp(join(tmpdir(), 'clooks-provider-turn-'))
    try {
      const claudePath = turnStatePath(home, 'same-session')
      const codexPath = turnStatePath(home, 'same-session', 'codex')
      expect(turnStatePath(home, 'same-session', 'claude-code')).toBe(claudePath)
      expect(basename(codexPath)).toBe(basename(claudePath))
      expect(dirname(codexPath)).toBe(join(dirname(claudePath), 'codex'))
      for (const provider of ['claude-code', 'codex'] as const) {
        const tracker = createTurnTracker({
          path: turnStatePath(home, 'same-session', provider),
          homeRoot: home,
          provider,
          state: emptyTurnState(),
          scopeKey: 'main',
        })
        tracker.record(hn('shared'), 'PreToolUse', provider === 'codex' ? 'block' : 'allow')
        await tracker.commit()
      }
      const claudeBytes = await readFile(claudePath, 'utf8')
      const codex = await readTurnState(codexPath)
      expect(codex.scopes).not.toEqual((await readTurnState(claudePath)).scopes)
      expect((await stat(dirname(codexPath))).mode & 0o777).toBe(0o700)
      expect(await readdir(dirname(codexPath))).toEqual([basename(codexPath)])
      const boundary = await applyTurnBoundary(codexPath, home, 'advance', 'codex')
      expect(boundary.generation).toBe(codex.generation + 1)
      expect(boundary.scopes).toEqual({})
      expect(await readFile(claudePath, 'utf8')).toBe(claudeBytes)
      const stale = new Date(Date.now() - TURN_STATE_TTL_MS - 1000)
      await utimes(codexPath, stale, stale)
      await utimes(claudePath, stale, stale)
      await pruneTurnState(home)
      expect(await readdir(dirname(claudePath))).not.toContain(basename(claudePath))
      expect(await readdir(dirname(codexPath))).toEqual([basename(codexPath)])
      expect((await readTurnState(codexPath)).generation).toBe(boundary.generation)
      const tracker = createTurnTracker({
        path: claudePath,
        homeRoot: home,
        state: emptyTurnState(),
        scopeKey: 'main',
      })
      tracker.record(hn('shared'), 'PreToolUse', 'allow')
      await tracker.commit()
      const restoredClaudeBytes = await readFile(claudePath, 'utf8')
      await pruneTurnState(home, 'codex')
      expect(await readdir(dirname(codexPath))).toEqual([])
      expect(await readFile(claudePath, 'utf8')).toBe(restoredClaudeBytes)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
