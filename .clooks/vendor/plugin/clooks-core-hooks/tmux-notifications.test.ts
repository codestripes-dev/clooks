import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  __setExecSyncForTest,
  ensureHookInstalled,
  flashFocusedWindow,
  getFocusedWindowId,
  hook,
  resetWindow,
  snapshotPanes,
} from './tmux-notifications'

const ORIGINAL_TMUX_PANE = process.env.TMUX_PANE
const ORIGINAL_TMUX = process.env.TMUX

const DEFAULT_CONFIG = {
  hookSlot: 81,
  idleColor: 'red',
  stopColor: 'colour208',
  attentionStyle: 'bg=red,fg=white,bold',
  attentionOnStop: true,
  flashOnPrompt: true,
  renameWindow: true,
  idleIndicator: true,
} as const

const ctx = { skip: (opts = {}) => ({ result: 'skip', ...opts }) } as any

function setupTmuxEnv(windowId = '@7'): void {
  process.env.TMUX = '/tmp/tmux/socket,1234,0'
  process.env.TMUX_PANE = '%4'
  // Default stub answers the beforeHook's display-message; tests override
  // afterwards as needed.
  execSyncImpl = (cmd) => {
    if (cmd.includes(`display-message -t "%4" -p '#{window_id}'`)) return windowId
    return ''
  }
  hook.beforeHook!(ctx, {} as any)
  issuedCommands.length = 0
}

// Per-test execSync stub. `execSyncImpl` decides what the stubbed call returns
// (or throws); `issuedCommands` captures every tmux command issued.
let execSyncImpl: (cmd: string) => string = () => ''
const issuedCommands: string[] = []

function execSyncStub(cmd: string): string | Buffer {
  issuedCommands.push(cmd)
  return execSyncImpl(cmd)
}

beforeEach(() => {
  issuedCommands.length = 0
  execSyncImpl = () => ''
  __setExecSyncForTest(execSyncStub as unknown as typeof import('child_process').execSync)
})

afterEach(() => {
  __setExecSyncForTest(null)
  if (ORIGINAL_TMUX_PANE === undefined) delete process.env.TMUX_PANE
  else process.env.TMUX_PANE = ORIGINAL_TMUX_PANE
  if (ORIGINAL_TMUX === undefined) delete process.env.TMUX
  else process.env.TMUX = ORIGINAL_TMUX
})

describe('meta', () => {
  test('declares full default config', () => {
    expect(hook.meta.config).toEqual({
      hookSlot: 81,
      idleColor: 'red',
      stopColor: 'colour208',
      attentionStyle: 'bg=red,fg=white,bold',
      attentionOnStop: true,
      flashOnPrompt: true,
      renameWindow: true,
      idleIndicator: true,
    })
  })
})

describe('ensureHookInstalled', () => {
  test('installs hook and sentinel when sentinel is unset', () => {
    execSyncImpl = () => ''

    ensureHookInstalled(81)

    const setHook = issuedCommands.find((c) => c.includes('set-hook -g session-window-changed['))
    const setSentinel = issuedCommands.find((c) =>
      c.includes('set-option -g @clooks-tmux-hook-v1 on'),
    )
    expect(setHook).toBeDefined()
    expect(setHook).toContain('session-window-changed[81]')
    expect(setHook).toContain('#{@clooks-attention}')
    expect(setSentinel).toBeDefined()
  })

  test('skips install when sentinel is already "on"', () => {
    execSyncImpl = (cmd) => {
      if (cmd.includes('show-options -gv @clooks-tmux-hook-v1')) return 'on\n'
      return ''
    }

    ensureHookInstalled(81)

    const setHook = issuedCommands.find((c) => c.includes('set-hook'))
    const setSentinel = issuedCommands.find((c) =>
      c.includes('set-option -g @clooks-tmux-hook-v1'),
    )
    expect(setHook).toBeUndefined()
    expect(setSentinel).toBeUndefined()
  })

  test('uses the configured slot in the set-hook command', () => {
    execSyncImpl = () => ''

    ensureHookInstalled(42)

    const setHook = issuedCommands.find((c) => c.includes('set-hook'))
    expect(setHook).toContain('session-window-changed[42]')
    expect(setHook).not.toContain('session-window-changed[81]')
  })

  test('installs when the sentinel read throws (option unset)', () => {
    execSyncImpl = (cmd) => {
      if (cmd.includes('show-options -gv @clooks-tmux-hook-v1')) {
        throw new Error('option not set')
      }
      return ''
    }

    ensureHookInstalled(99)

    const setHook = issuedCommands.find((c) => c.includes('set-hook'))
    expect(setHook).toContain('session-window-changed[99]')
  })

  test('does not install when sentinel returns "on" surrounded by whitespace', () => {
    execSyncImpl = (cmd) => {
      if (cmd.includes('show-options -gv @clooks-tmux-hook-v1')) return '  on  \n'
      return ''
    }

    ensureHookInstalled(81)

    expect(issuedCommands.some((c) => c.includes('set-hook'))).toBe(false)
  })

  test('installed hook clears @clooks-attention and resets styles', () => {
    execSyncImpl = () => ''

    ensureHookInstalled(81)

    const setHook = issuedCommands.find((c) => c.includes('set-hook'))!
    expect(setHook).toContain('window-status-style default')
    expect(setHook).toContain('-u window-status-current-style')
    expect(setHook).toContain('-wu @clooks-attention')
  })
})

describe('resetWindow', () => {
  test('clears @clooks-attention scoped to the given window', () => {
    resetWindow('@7')

    const clearAttention = issuedCommands.find((c) =>
      c.includes('set-option -wu -t @7 @clooks-attention'),
    )
    expect(clearAttention).toBeDefined()
  })

  test('also resets window-status-style and current-style on the same window', () => {
    resetWindow('@7')

    expect(
      issuedCommands.some((c) => c.includes('set-window-option -t @7 window-status-style default')),
    ).toBe(true)
    expect(
      issuedCommands.some((c) =>
        c.includes('set-window-option -t @7 -u window-status-current-style'),
      ),
    ).toBe(true)
  })

  test('does not touch flags on other windows', () => {
    resetWindow('@7')

    expect(issuedCommands.some((c) => /@clooks-attention/.test(c) && !c.includes('-t @7'))).toBe(
      false,
    )
  })
})

describe('getFocusedWindowId', () => {
  test('returns the session active window, not the calling pane window', () => {
    process.env.TMUX_PANE = '%4'
    execSyncImpl = (cmd) => {
      if (cmd.includes(`display-message -t "%4" -p '#{session_id}'`)) return '$2\n'
      if (cmd.includes(`display-message -t '$2' -p '#{window_id}'`)) return '@9\n'
      return ''
    }

    expect(getFocusedWindowId()).toBe('@9')
  })

  test('returns null when TMUX_PANE is unset', () => {
    delete process.env.TMUX_PANE
    expect(getFocusedWindowId()).toBeNull()
  })

  test('returns null when display-message throws', () => {
    process.env.TMUX_PANE = '%4'
    execSyncImpl = () => {
      throw new Error('tmux failed')
    }
    expect(getFocusedWindowId()).toBeNull()
  })

  test('returns null when session lookup is empty', () => {
    process.env.TMUX_PANE = '%4'
    execSyncImpl = (cmd) => {
      if (cmd.includes('session_id')) return ''
      return '@9'
    }
    expect(getFocusedWindowId()).toBeNull()
  })
})

describe('snapshotPanes', () => {
  test('scopes to the given window with -t (not session-wide -s)', () => {
    execSyncImpl = (cmd) => {
      if (cmd.includes('list-panes')) {
        expect(cmd).toContain('-t @9')
        expect(cmd).not.toContain('-s ')
        return '%1\tdefault\tdefault\n'
      }
      return ''
    }

    const snaps = snapshotPanes('@9')
    expect(snaps).toHaveLength(1)
    expect(snaps[0]).toEqual({ id: '%1', style: null, activeStyle: null })
  })

  test('captures non-default per-pane styles', () => {
    execSyncImpl = (cmd) => {
      if (cmd.includes('list-panes')) return "%1\tbg=#111\tbg=#222\n%2\tdefault\tdefault"
      return ''
    }

    const snaps = snapshotPanes('@9')
    expect(snaps).toEqual([
      { id: '%1', style: 'bg=#111', activeStyle: 'bg=#222' },
      { id: '%2', style: null, activeStyle: null },
    ])
  })

  test('returns empty array on list-panes failure', () => {
    execSyncImpl = () => {
      throw new Error('tmux failed')
    }
    expect(snapshotPanes('@9')).toEqual([])
  })
})

describe('flashFocusedWindow', () => {
  test('does nothing when TMUX_PANE is unset', async () => {
    delete process.env.TMUX_PANE
    await flashFocusedWindow()
    expect(issuedCommands).toEqual([])
  })

  test('does nothing when the focused window cannot be resolved', async () => {
    process.env.TMUX_PANE = '%4'
    execSyncImpl = (cmd) => {
      if (cmd.includes('session_id')) return ''
      return ''
    }
    await flashFocusedWindow()
    expect(issuedCommands.some((c) => c.includes('list-panes'))).toBe(false)
  })

  test('batches per-pane and status commands into single tmux invocations', async () => {
    process.env.TMUX_PANE = '%4'
    execSyncImpl = (cmd) => {
      if (cmd.includes(`display-message -t "%4" -p '#{session_id}'`)) return '$2'
      if (cmd.includes(`display-message -t '$2' -p '#{window_id}'`)) return '@9'
      if (cmd.includes('list-panes')) return '%1\tdefault\tdefault\n%2\tbg=#111\tdefault'
      if (cmd.includes('show-option -gv status-style')) return 'bg=black'
      return ''
    }

    await flashFocusedWindow()

    // The batched dim/restore calls go through a single tmux invocation each,
    // identifiable by the literal `\;` separator in the command string.
    const batches = issuedCommands.filter((c) => c.includes('\\;'))
    // 2 cycles × (dim batch + restore batch) = 4 batched calls.
    expect(batches).toHaveLength(4)

    const dimBatches = batches.filter((c) => c.includes("bg=colour240"))
    expect(dimBatches).toHaveLength(2)
    expect(dimBatches[0]).toContain('set -p -t %1 window-style')
    expect(dimBatches[0]).toContain('set -p -t %2 window-style')
    expect(dimBatches[0]).toContain('set -p -t %1 window-active-style')
    expect(dimBatches[0]).toContain("set -g status-style 'bg=red,fg=white,bold'")
  })

  test('restores per-pane styles correctly: -pu when unset, -p with value when set', async () => {
    process.env.TMUX_PANE = '%4'
    execSyncImpl = (cmd) => {
      if (cmd.includes(`display-message -t "%4" -p '#{session_id}'`)) return '$2'
      if (cmd.includes(`display-message -t '$2' -p '#{window_id}'`)) return '@9'
      if (cmd.includes('list-panes')) return '%1\tdefault\tdefault\n%2\tbg=#111\tbg=#222'
      if (cmd.includes('show-option -gv status-style')) return 'bg=black'
      return ''
    }

    await flashFocusedWindow()

    const restoreBatch = issuedCommands
      .filter((c) => c.includes('\\;'))
      .find((c) => c.includes('set -pu') || c.includes('bg=#111'))!
    expect(restoreBatch).toContain('set -pu -t %1 window-style')
    expect(restoreBatch).toContain('set -pu -t %1 window-active-style')
    expect(restoreBatch).toContain("set -p -t %2 window-style 'bg=#111'")
    expect(restoreBatch).toContain("set -p -t %2 window-active-style 'bg=#222'")
    expect(restoreBatch).toContain("set -g status-style 'bg=black'")
  })

  test('restores status-style with -gu when captured value is empty', async () => {
    process.env.TMUX_PANE = '%4'
    execSyncImpl = (cmd) => {
      if (cmd.includes(`display-message -t "%4" -p '#{session_id}'`)) return '$2'
      if (cmd.includes(`display-message -t '$2' -p '#{window_id}'`)) return '@9'
      if (cmd.includes('list-panes')) return '%1\tdefault\tdefault'
      if (cmd.includes('show-option -gv status-style')) return ''
      return ''
    }

    await flashFocusedWindow()

    const restoreBatch = issuedCommands
      .filter((c) => c.includes('\\;'))
      .find((c) => c.includes('set -pu') || c.includes('-gu status-style'))!
    expect(restoreBatch).toContain('set -gu status-style')
    expect(restoreBatch).not.toMatch(/set -g status-style ''/)
  })

  test('does nothing when snapshot returns no panes', async () => {
    process.env.TMUX_PANE = '%4'
    execSyncImpl = (cmd) => {
      if (cmd.includes('session_id')) return '$2'
      if (cmd.includes('window_id')) return '@9'
      if (cmd.includes('list-panes')) return ''
      return ''
    }

    await flashFocusedWindow()
    expect(issuedCommands.some((c) => c.includes('\\;'))).toBe(false)
  })
})

describe('resetWindow renameWindow toggle', () => {
  test('with renameWindow=true: disables automatic-rename and renames', () => {
    resetWindow('@7', true)

    expect(
      issuedCommands.some((c) => c === 'tmux set-window-option -t @7 automatic-rename off'),
    ).toBe(true)
    expect(issuedCommands.some((c) => c.includes('rename-window -t @7 "c-'))).toBe(true)
  })

  test('with renameWindow=false: skips rename and restores automatic-rename on', () => {
    resetWindow('@7', false)

    expect(issuedCommands.some((c) => c.includes('rename-window'))).toBe(false)
    expect(issuedCommands.some((c) => c.includes('automatic-rename off'))).toBe(false)
    expect(
      issuedCommands.some((c) => c === 'tmux set-window-option -t @7 automatic-rename on'),
    ).toBe(true)
  })
})

describe('hook.Stop', () => {
  test('with attentionOnStop=true: applies stopColor to both styles', () => {
    setupTmuxEnv('@7')

    hook.Stop!(ctx, { ...DEFAULT_CONFIG, stopColor: 'cyan' })

    expect(
      issuedCommands.some(
        (c) => c === "tmux set-window-option -t @7 window-status-style 'fg=cyan'",
      ),
    ).toBe(true)
    expect(
      issuedCommands.some(
        (c) => c === "tmux set-window-option -t @7 window-status-current-style 'fg=cyan'",
      ),
    ).toBe(true)
  })

  test('with attentionOnStop=false: issues no commands', () => {
    setupTmuxEnv('@7')

    hook.Stop!(ctx, { ...DEFAULT_CONFIG, attentionOnStop: false })

    expect(issuedCommands).toEqual([])
  })
})

describe('hook.PermissionRequest agent attention', () => {
  test.each([undefined, 'claude-code'])('skips %s without duplicate attention', async (agent) => {
    setupTmuxEnv()
    const input = agent === undefined ? ctx : { ...ctx, agent }
    expect(await hook.PermissionRequest!(input, DEFAULT_CONFIG)).toEqual({ result: 'skip' })
    expect(issuedCommands).toEqual([])
  })

  test.each([false, true])('Codex styles attention without flashing when flashOnPrompt=%s', async (flashOnPrompt) => {
    setupTmuxEnv()
    expect(await hook.PermissionRequest!({ ...ctx, agent: 'codex' }, {
      ...DEFAULT_CONFIG, attentionStyle: 'bg=blue,fg=yellow', flashOnPrompt,
    })).toEqual({ result: 'skip' })
    expect(issuedCommands).toEqual([
      "tmux set-window-option -t @7 window-status-style 'bg=blue,fg=yellow'",
      "tmux set-window-option -t @7 window-status-current-style 'bg=blue,fg=yellow'",
    ])
  })

  test('unchanged beforeHook skips outside tmux without subprocesses', () => {
    delete process.env.TMUX
    expect(hook.beforeHook!(ctx, DEFAULT_CONFIG)).toEqual({ result: 'skip' })
    expect(issuedCommands).toEqual([])
  })

  test.each([undefined, 'claude-code', 'codex'])('SessionEnd cleanup remains unchanged for %s', (agent) => {
    setupTmuxEnv()
    expect(hook.SessionEnd!({ ...ctx, agent }, DEFAULT_CONFIG)).toEqual({ result: 'skip' })
    expect(issuedCommands).toEqual([
      'tmux set-window-option -t @7 window-status-style default',
      'tmux set-window-option -t @7 -u window-status-current-style',
      'tmux set-window-option -t @7 automatic-rename on',
    ])
  })

  test('Claude permission notification still applies attention after PermissionRequest skips', async () => {
    setupTmuxEnv()
    await hook.PermissionRequest!({ ...ctx, agent: 'claude-code' }, DEFAULT_CONFIG)
    expect(issuedCommands).toEqual([])
    expect(await hook.Notification!({ ...ctx, agent: 'claude-code', notificationType: 'permission_prompt' }, {
      ...DEFAULT_CONFIG, flashOnPrompt: false,
    })).toEqual({ result: 'skip' })
    expect(issuedCommands).toHaveLength(2)
    expect(issuedCommands[0]).toContain("window-status-style 'bg=red,fg=white,bold'")
  })
})

describe('hook.Notification', () => {
  test('idle_prompt uses configured idleColor', async () => {
    setupTmuxEnv('@7')

    await hook.Notification!(
      { ...ctx, notificationType: 'idle_prompt' } as any,
      { ...DEFAULT_CONFIG, idleColor: 'magenta' },
    )

    expect(
      issuedCommands.some(
        (c) => c === "tmux set-window-option -t @7 window-status-style 'fg=magenta'",
      ),
    ).toBe(true)
  })

  test('idle_prompt with renameWindow=false: only colors, does not rename', async () => {
    setupTmuxEnv('@7')

    await hook.Notification!(
      { ...ctx, notificationType: 'idle_prompt' } as any,
      { ...DEFAULT_CONFIG, renameWindow: false },
    )

    expect(issuedCommands.some((c) => c.includes('window-status-style'))).toBe(true)
    expect(issuedCommands.some((c) => c.includes('rename-window'))).toBe(false)
    expect(issuedCommands.some((c) => c.includes('automatic-rename'))).toBe(false)
  })

  test('idle_prompt with idleIndicator=false: renames without ⏸ prefix', async () => {
    setupTmuxEnv('@7')

    await hook.Notification!(
      { ...ctx, notificationType: 'idle_prompt' } as any,
      { ...DEFAULT_CONFIG, idleIndicator: false },
    )

    const rename = issuedCommands.find((c) => c.includes('rename-window'))!
    expect(rename).toContain('"c-')
    expect(rename).not.toContain('⏸')
  })

  test('idle_prompt with both renameWindow and idleIndicator true: prepends ⏸', async () => {
    setupTmuxEnv('@7')

    await hook.Notification!(
      { ...ctx, notificationType: 'idle_prompt' } as any,
      DEFAULT_CONFIG,
    )

    const rename = issuedCommands.find((c) => c.includes('rename-window'))!
    expect(rename).toContain('"⏸ c-')
  })

  test('permission_prompt uses configured attentionStyle', async () => {
    setupTmuxEnv('@7')
    execSyncImpl = () => ''

    await hook.Notification!(
      { ...ctx, notificationType: 'permission_prompt' } as any,
      { ...DEFAULT_CONFIG, attentionStyle: 'bg=blue,fg=yellow', flashOnPrompt: false },
    )

    expect(
      issuedCommands.some(
        (c) => c === "tmux set-window-option -t @7 window-status-style 'bg=blue,fg=yellow'",
      ),
    ).toBe(true)
    expect(
      issuedCommands.some(
        (c) =>
          c === "tmux set-window-option -t @7 window-status-current-style 'bg=blue,fg=yellow'",
      ),
    ).toBe(true)
  })

  test('permission_prompt with flashOnPrompt=false: applies style but does not flash', async () => {
    setupTmuxEnv('@7')

    await hook.Notification!(
      { ...ctx, notificationType: 'permission_prompt' } as any,
      { ...DEFAULT_CONFIG, flashOnPrompt: false },
    )

    // No flash side effects: no session_id lookup, no list-panes, no batch.
    expect(issuedCommands.some((c) => c.includes("'#{session_id}'"))).toBe(false)
    expect(issuedCommands.some((c) => c.includes('list-panes'))).toBe(false)
    expect(issuedCommands.some((c) => c.includes('\\;'))).toBe(false)
  })

  test('permission_prompt with flashOnPrompt=true: triggers flash query path', async () => {
    setupTmuxEnv('@7')
    execSyncImpl = (cmd) => {
      if (cmd.includes(`display-message -t "%4" -p '#{session_id}'`)) return '$2'
      if (cmd.includes(`display-message -t '$2' -p '#{window_id}'`)) return '@9'
      if (cmd.includes('list-panes')) return ''
      return ''
    }

    await hook.Notification!(
      { ...ctx, notificationType: 'permission_prompt' } as any,
      DEFAULT_CONFIG,
    )

    expect(issuedCommands.some((c) => c.includes("'#{session_id}'"))).toBe(true)
  })
})
