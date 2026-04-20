// tmux-notifications — Visual tmux indicators for Claude Code session state
//
// - Notification/idle_prompt: red window status + "⏸ c-{dir}" rename
// - Notification/permission_prompt|elicitation_dialog: red bold + pane flash
// - UserPromptSubmit, PostToolUse, SessionStart: reset to default
// - SessionEnd: reset + restore automatic-rename

import { execSync } from 'child_process'
import type { ClooksHook } from './types'

const SKIP = { result: 'skip' } as const
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function tmux(cmd: string): void {
  try {
    execSync(`tmux ${cmd}`, { stdio: 'ignore' })
  } catch {}
}

function getWindowId(): string | null {
  const pane = process.env.TMUX_PANE
  if (!pane) return null
  try {
    return execSync(`tmux display-message -t "${pane}" -p '#{window_id}'`, {
      encoding: 'utf8',
    }).trim()
  } catch {
    return null
  }
}

function dirName(): string {
  return process.cwd().split('/').pop() || 'unknown'
}

function resetWindow(w: string): void {
  tmux(`set-window-option -t ${w} window-status-style default`)
  tmux(`set-window-option -t ${w} -u window-status-current-style`)
  tmux(`set-window-option -t ${w} automatic-rename off`)
  tmux(`rename-window -t ${w} "c-${dirName()}"`)
}

function setAttentionStyle(w: string): void {
  tmux(`set-window-option -t ${w} window-status-style 'bg=red,fg=white,bold'`)
  tmux(`set-window-option -t ${w} window-status-current-style 'bg=red,fg=white,bold'`)
}

async function flashPane(): Promise<void> {
  const pane = process.env.TMUX_PANE
  if (!pane) return
  for (let i = 0; i < 2; i++) {
    tmux(`select-pane -t "${pane}" -P 'bg=colour240'`)
    await sleep(150)
    tmux(`select-pane -t "${pane}" -P 'bg=default'`)
    await sleep(100)
  }
}

let w: string
// w is module-level but safe: getWindowId() reads TMUX_PANE which is
// constant for the process lifetime. Any concurrent events resolve the
// same window ID.

export const hook: ClooksHook = {
  meta: {
    name: 'tmux-notifications',
    description: 'Visual tmux indicators: red for attention, flash for prompts, reset on activity',
  },

  beforeHook(event) {
    if (!process.env.TMUX) {
      event.respond(SKIP)
      return
    }
    const id = getWindowId()
    if (!id) {
      event.respond(SKIP)
      return
    }
    w = id
  },

  async Notification(ctx) {
    if (ctx.notificationType === 'idle_prompt') {
      tmux(`set-window-option -t ${w} window-status-style 'fg=red'`)
      tmux(`set-window-option -t ${w} automatic-rename off`)
      tmux(`rename-window -t ${w} "⏸ c-${dirName()}"`)
    } else if (
      ctx.notificationType === 'permission_prompt' ||
      ctx.notificationType === 'elicitation_dialog'
    ) {
      setAttentionStyle(w)
      await flashPane()
    }
    return SKIP
  },

  UserPromptSubmit() {
    resetWindow(w)
    return SKIP
  },

  PostToolUse() {
    resetWindow(w)
    return SKIP
  },

  PostToolUseFailure() {
    resetWindow(w)
    return SKIP
  },

  SessionStart() {
    resetWindow(w)
    return SKIP
  },

  SessionEnd() {
    tmux(`set-window-option -t ${w} window-status-style default`)
    tmux(`set-window-option -t ${w} -u window-status-current-style`)
    tmux(`set-window-option -t ${w} automatic-rename on`)
    return SKIP
  },
}
