import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Command } from 'commander'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApprovalStore } from '../agents/codex/approval-store'
import { createApproveCommand } from './approve'

let home: string
let store: ApprovalStore
let stdout: ReturnType<typeof spyOn>
let exit: ReturnType<typeof spyOn>
const binding = {
  baseInvocationHash: 'a'.repeat(64),
  decisionHash: 'b'.repeat(64),
  confirmationHash: 'c'.repeat(64),
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'clooks-approve-unit-'))
  store = new ApprovalStore(home, () => 1000)
  stdout = spyOn(process.stdout, 'write').mockImplementation(() => true)
  exit = spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit')
  }) as () => never)
})
afterEach(() => {
  stdout.mockRestore()
  exit.mockRestore()
  rmSync(home, { recursive: true, force: true })
})

function program(factory = () => store) {
  return new Command().exitOverride().option('--json').addCommand(createApproveCommand(factory))
}
function output() {
  return JSON.parse(
    stdout.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join('')
      .trim(),
  )
}

describe('approve command', () => {
  test('JSON registration returns acknowledgement and original expiry without consuming', async () => {
    const issued = store.issueOrReuse(binding)
    await program().parseAsync(['--json', 'approve', issued.token], { from: 'user' })
    expect(output()).toEqual({
      ok: true,
      command: 'approve',
      data: { token: issued.token, acknowledgedAt: 1000, expiresAt: 301000 },
    })
    expect(store.issueOrReuse(binding).consumedAt).toBeNull()
    expect(exit).not.toHaveBeenCalled()
  })

  test('human output is noninteractive and default factory uses the runtime home root', async () => {
    const real = new ApprovalStore(home)
    const issued = real.issueOrReuse(binding)
    const old = process.env.CLOOKS_HOME_ROOT
    try {
      process.env.CLOOKS_HOME_ROOT = home
      await new Command()
        .addCommand(createApproveCommand())
        .parseAsync(['approve', issued.token], { from: 'user' })
      expect(real.issueOrReuse(binding).acknowledgedAt).not.toBeNull()
      expect(exit).not.toHaveBeenCalled()
    } finally {
      if (old === undefined) delete process.env.CLOOKS_HOME_ROOT
      else process.env.CLOOKS_HOME_ROOT = old
    }
  })

  test('malformed token reports one JSON error and exits nonzero', async () => {
    await expect(
      program().parseAsync(['--json', 'approve', 'invalid'], { from: 'user' }),
    ).rejects.toThrow('exit')
    expect(output()).toEqual({ ok: false, command: 'approve', error: 'Malformed approval token' })
    expect(exit).toHaveBeenCalledWith(1)
  })

  test('storage factory failures use the existing error envelope', async () => {
    await expect(
      program(() => {
        throw 'storage failure'
      }).parseAsync(['--json', 'approve', 'token'], { from: 'user' }),
    ).rejects.toThrow('exit')
    expect(output()).toEqual({ ok: false, command: 'approve', error: 'storage failure' })
  })

  test('Commander rejects a missing token', async () => {
    const command = program().configureOutput({ writeErr: () => {} })
    await expect(command.parseAsync(['approve'], { from: 'user' })).rejects.toThrow()
    expect(store.exists()).toBe(false)
  })
})
