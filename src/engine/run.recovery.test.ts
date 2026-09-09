import { expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as handoff from './handoff.js'
import * as turnState from './turn-state.js'
import { runEngineCore } from './run.js'
import { claudeCodeAdapter } from '../agents/claude-code/adapter.js'
import { ms } from '../test-utils.js'

test('SessionStart completes when housekeeping dependencies reject', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clooks-run-recovery-'))
  const originalHome = process.env.CLOOKS_HOME_ROOT
  const originalExitCode = process.exitCode
  const originalDebug = process.env.CLOOKS_DEBUG
  process.env.CLOOKS_HOME_ROOT = root
  delete process.env.CLOOKS_DEBUG
  const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true)
  const pruneHandoff = spyOn(handoff, 'pruneHandoffFiles').mockRejectedValueOnce(
    new Error('handoff prune failed'),
  )
  const pruneTurn = spyOn(turnState, 'pruneTurnState').mockRejectedValueOnce(
    new Error('turn prune failed'),
  )
  const boundary = spyOn(turnState, 'applyTurnBoundary').mockRejectedValueOnce(
    new Error('boundary failed'),
  )
  const translate = spyOn(claudeCodeAdapter, 'translateFinalOutput')
  const exit = spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('test exit')
  })
  let reads = 0
  try {
    await expect(
      runEngineCore(claudeCodeAdapter, {
        discoverProjectRoot: async () => ({
          projectRoot: root,
          signal: 'walk-up',
          from: root,
          checked: [root],
        }),
        readStdin: async () => {
          reads++
          return {
            hook_event_name: 'SessionStart',
            session_id: 'recovery',
            source: 'startup',
            cwd: root,
          }
        },
        loadConfig: async () => ({
          config: {
            version: '1.0.0',
            global: {
              timeout: ms(1000),
              onError: 'block',
              maxFailures: 3,
              maxFailuresMessage: 'degraded',
              handoff: false,
            },
            hooks: {},
            events: {},
          },
          shadows: [],
          hasProjectConfig: true,
        }),
        loadAllHooks: async () => ({ loaded: [], loadErrors: [], dangling: [] }),
      }),
    ).rejects.toThrow('test exit')
    expect(reads).toBe(1)
    expect(pruneHandoff).toHaveBeenCalledWith(root)
    expect(pruneTurn).toHaveBeenCalledWith(root, 'claude-code')
    expect(boundary).toHaveBeenCalledWith(
      turnState.turnStatePath(root, 'recovery'),
      root,
      'reset',
      'claude-code',
    )
    expect(translate).toHaveBeenCalledTimes(1)
    expect(translate).toHaveReturnedWith({ exitCode: 0 })
    expect(exit).toHaveBeenCalledWith(0)
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
  } finally {
    stdout.mockRestore()
    stderr.mockRestore()
    exit.mockRestore()
    translate.mockRestore()
    boundary.mockRestore()
    pruneTurn.mockRestore()
    pruneHandoff.mockRestore()
    if (originalHome === undefined) delete process.env.CLOOKS_HOME_ROOT
    else process.env.CLOOKS_HOME_ROOT = originalHome
    if (originalDebug === undefined) delete process.env.CLOOKS_DEBUG
    else process.env.CLOOKS_DEBUG = originalDebug
    process.exitCode = originalExitCode
    rmSync(root, { recursive: true, force: true })
  }
})
