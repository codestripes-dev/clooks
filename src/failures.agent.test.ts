import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, lstat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getFailureLocation,
  getFailurePath,
  readFailures,
  recordFailure,
  writeFailures,
} from './failures.js'
import { hn } from './test-utils.js'

describe('Codex managed failure state', () => {
  for (const hasProjectConfig of [true, false]) {
    test(`real directories support isolated read, write and recovery clearing; project=${hasProjectConfig}`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'clooks-managed-failure-'))
      try {
        const home = join(root, 'home')
        const project = join(root, 'project')
        await mkdir(home)
        await mkdir(project)
        const location = getFailureLocation(project, home, hasProjectConfig, 'codex')
        const path = getFailurePath(project, home, hasProjectConfig, 'codex')
        expect(await readFailures(location)).toEqual({})
        const state = recordFailure({}, hn('shared'), 'PreToolUse', 'failure')
        await writeFailures(location, state)
        expect(await readFailures(location)).toEqual(state)
        expect((await lstat(path)).mode & 0o777).toBe(0o600)
        expect(await readdir(dirname(path))).toEqual([basename(path)])
        expect(
          await readFailures(getFailureLocation(project, home, hasProjectConfig, 'claude-code')),
        ).toEqual({})
        await writeFailures(location, {})
        expect(await readFailures(location)).toEqual({})
        expect(await readdir(dirname(path))).toEqual([])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

    for (const linkKind of ['agent-directory', 'state-file'] as const) {
      test(`${linkKind} cannot alias another agent during read, write or clear; project=${hasProjectConfig}`, async () => {
        const root = await mkdtemp(join(tmpdir(), 'clooks-linked-failure-'))
        try {
          const home = join(root, 'home')
          const project = join(root, 'project')
          await mkdir(home)
          await mkdir(project)
          const foreign = getFailurePath(project, home, hasProjectConfig, 'claude-code')
          const state = recordFailure({}, hn('sentinel'), 'PreToolUse', 'foreign bytes')
          await writeFailures(foreign, state)
          const before = await readFile(foreign, 'utf8')
          const location = getFailureLocation(project, home, hasProjectConfig, 'codex')
          const path = getFailurePath(project, home, hasProjectConfig, 'codex')
          let sentinel = foreign
          if (linkKind === 'state-file') {
            await mkdir(dirname(path), { recursive: true })
            await symlink(foreign, path)
          } else {
            await mkdir(dirname(dirname(path)), { recursive: true })
            const aliased = join(root, 'foreign-directory')
            await mkdir(aliased)
            sentinel = join(aliased, basename(path))
            await writeFailures(sentinel, state)
            await symlink(aliased, dirname(path))
          }
          expect(await readFailures(sentinel)).toEqual(state)
          await expect(readFailures(location)).rejects.toThrow()
          await expect(
            writeFailures(location, recordFailure({}, hn('writer'), 'PreToolUse', 'new')),
          ).rejects.toThrow()
          await expect(writeFailures(location, {})).rejects.toThrow()
          expect(await readFile(foreign, 'utf8')).toBe(before)
          expect(await readFile(sentinel, 'utf8')).toBe(before)
          expect(await readFailures(foreign)).toEqual(state)
          expect(
            (await lstat(linkKind === 'state-file' ? path : dirname(path))).isSymbolicLink(),
          ).toBe(true)
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      })
    }
  }
})
