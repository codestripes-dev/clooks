// tmux-notifications — Visual tmux indicators for Claude Code session state
//
// - Stop: orange tab text, auto-resets when user focuses the window
// - Notification/idle_prompt: red tab text + "⏸ c-{dir}", resets color on focus (⏸ stays)
// - Notification/permission_prompt|elicitation_dialog: red bold + flash on
//   the user's currently-focused window (may differ from Claude's window)
// - UserPromptSubmit, PostToolUse, SessionStart: reset to default
// - SessionEnd: reset + restore automatic-rename
//
// Reset-on-focus uses a @clooks-attention window user option as a flag,
// checked by a global session-window-changed hook installed once per tmux
// server (gated by the `@clooks-tmux-hook-v1` sentinel option). The hook
// lands in a configurable indexed slot (default 81) so it doesn't clobber
// other bindings on the same event.

import { execSync as nodeExecSync } from "child_process"
import type { ClooksHook } from "./types"

export interface TmuxNotificationsConfig extends Record<string, unknown> {
  /** Indexed slot for the global session-window-changed hook. Default: 81. */
  hookSlot: number
  /** Foreground color for the window-status label during `idle_prompt`. */
  idleColor: string
  /** Foreground color for the window-status label after `Stop`. */
  stopColor: string
  /** Full style string applied during permission/elicitation prompts. */
  attentionStyle: string
  /** Whether `Stop` colors the window status. Set false to silence Stop. */
  attentionOnStop: boolean
  /** Whether permission/elicitation prompts trigger the visual flash. */
  flashOnPrompt: boolean
  /** Whether to rename the window to `c-{dir}` and disable automatic-rename. */
  renameWindow: boolean
  /** Whether to prepend "⏸ " on `idle_prompt`. No-op when renameWindow is false. */
  idleIndicator: boolean
}

const DEFAULT_CONFIG: TmuxNotificationsConfig = {
  hookSlot: 81,
  idleColor: "red",
  stopColor: "colour208",
  attentionStyle: "bg=red,fg=white,bold",
  attentionOnStop: true,
  flashOnPrompt: true,
  renameWindow: true,
  idleIndicator: true,
}

const SENTINEL = "@clooks-tmux-hook-v1"

// Indirection so tests can intercept tmux commands without globally mocking
// `child_process` (which would bleed into other test files).
let execSync: typeof nodeExecSync = nodeExecSync

/** Test-only: swap execSync. Pass null/no args to restore the real one. */
export function __setExecSyncForTest(fn?: typeof nodeExecSync | null): void {
  execSync = fn ?? nodeExecSync
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function tmux(cmd: string): void {
  try {
    execSync(`tmux ${cmd}`, { stdio: "ignore" })
  } catch {}
}

function getWindowId(): string | null {
  const pane = process.env.TMUX_PANE
  if (!pane) return null
  try {
    return execSync(`tmux display-message -t "${pane}" -p '#{window_id}'`, {
      encoding: "utf8",
    }).trim()
  } catch {
    return null
  }
}

// The session's currently-active window — the one the user is most likely
// looking at. May differ from Claude's own window if Claude runs in a
// background window. Returns null if we can't resolve it.
export function getFocusedWindowId(): string | null {
  const pane = process.env.TMUX_PANE
  if (!pane) return null
  try {
    const sessionId = execSync(`tmux display-message -t "${pane}" -p '#{session_id}'`, {
      encoding: "utf8",
    }).trim()
    if (!sessionId) return null
    const windowId = execSync(`tmux display-message -t "${sessionId}" -p '#{window_id}'`, {
      encoding: "utf8",
    }).trim()
    return windowId || null
  } catch {
    return null
  }
}

// Run multiple tmux commands in a single subprocess. `\;` survives shell
// escaping and is passed to tmux as its command separator.
function tmuxBatch(cmds: string[]): void {
  if (cmds.length === 0) return
  try {
    execSync(`tmux ${cmds.join(" \\; ")}`, { stdio: "ignore" })
  } catch {}
}

function dirName(): string {
  return process.cwd().split("/").pop() || "unknown"
}

export function resetWindow(w: string, renameWindow = true): void {
  tmux(`set-window-option -t ${w} window-status-style default`)
  tmux(`set-window-option -t ${w} -u window-status-current-style`)
  tmux(`set-option -wu -t ${w} @clooks-attention`)
  if (renameWindow) {
    tmux(`set-window-option -t ${w} automatic-rename off`)
    tmux(`rename-window -t ${w} "c-${dirName()}"`)
  } else {
    // Restore tmux's auto-rename in case a previous (renameWindow=true) run
    // disabled it before the user flipped the toggle off.
    tmux(`set-window-option -t ${w} automatic-rename on`)
  }
}

function setAttentionStyle(w: string, style: string): void {
  tmux(`set-window-option -t ${w} window-status-style '${style}'`)
  tmux(`set-window-option -t ${w} window-status-current-style '${style}'`)
}

export function ensureHookInstalled(slot: number): void {
  let installed = ""
  try {
    installed = execSync(`tmux show-options -gv ${SENTINEL}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {}
  if (installed === "on") return

  tmux(`set-hook -g session-window-changed[${slot}] 'if-shell -F "#{@clooks-attention}" "set-window-option window-status-style default ; set-window-option -u window-status-current-style ; set-option -wu @clooks-attention"'`)
  tmux(`set-option -g ${SENTINEL} on`)
}

function markAttention(w: string, slot: number): void {
  tmux(`set-option -w -t ${w} @clooks-attention on`)
  ensureHookInstalled(slot)
}

interface PaneSnapshot {
  id: string
  style: string | null
  activeStyle: string | null
}

export function snapshotPanes(window: string): PaneSnapshot[] {
  let raw: string
  try {
    raw = execSync(
      `tmux list-panes -t ${window} -F '#{pane_id}\t#{window-style}\t#{window-active-style}'`,
      { encoding: "utf8" },
    ).trim()
  } catch {
    return []
  }
  return raw.split("\n").filter(Boolean).map((line) => {
    const [id, style, activeStyle] = line.split("\t")
    return {
      id,
      style: style === "default" ? null : style || null,
      activeStyle: activeStyle === "default" ? null : activeStyle || null,
    }
  })
}

function restoreCommands(snap: PaneSnapshot): string[] {
  return [
    snap.style
      ? `set -p -t ${snap.id} window-style '${snap.style}'`
      : `set -pu -t ${snap.id} window-style`,
    snap.activeStyle
      ? `set -p -t ${snap.id} window-active-style '${snap.activeStyle}'`
      : `set -pu -t ${snap.id} window-active-style`,
  ]
}

export async function flashFocusedWindow(): Promise<void> {
  if (!process.env.TMUX_PANE) return
  const window = getFocusedWindowId()
  if (!window) return

  const snapshots = snapshotPanes(window)
  if (snapshots.length === 0) return

  // `show-option -gv status-style` returns the built-in default when unset,
  // and an empty string ONLY if a user explicitly ran `set -g status-style ''`.
  // Writing '' back is accepted by tmux but stores a literal empty style, so
  // we use `-gu` on empty to restore tmux's default behavior instead.
  let origStatus = ""
  try {
    origStatus = execSync(`tmux show-option -gv status-style`, { encoding: "utf8" }).trim()
  } catch {}

  const dimCmds: string[] = [
    ...snapshots.map((s) => `set -p -t ${s.id} window-style 'bg=colour240'`),
    ...snapshots.map((s) => `set -p -t ${s.id} window-active-style 'bg=colour240'`),
    `set -g status-style 'bg=red,fg=white,bold'`,
  ]
  const restoreCmds: string[] = [
    ...snapshots.flatMap(restoreCommands),
    origStatus ? `set -g status-style '${origStatus}'` : `set -gu status-style`,
  ]

  for (let i = 0; i < 2; i++) {
    tmuxBatch(dimCmds)
    await sleep(150)
    tmuxBatch(restoreCmds)
    await sleep(100)
  }
}

let w: string
// w is module-level but safe: getWindowId() reads TMUX_PANE which is
// constant for the process lifetime. Any concurrent events resolve the
// same window ID.

export const hook: ClooksHook<TmuxNotificationsConfig> = {
  meta: {
    name: "tmux-notifications",
    description:
      "Visual tmux indicators: red for attention, flash for prompts, reset on activity",
    config: DEFAULT_CONFIG,
  },

  beforeHook(event) {
    if (!process.env.TMUX) {
      return event.skip()
    }
    const id = getWindowId()
    if (!id) {
      return event.skip()
    }
    w = id
  },

  async Notification(ctx, config) {
    if (ctx.notificationType === "idle_prompt") {
      tmux(`set-window-option -t ${w} window-status-style 'fg=${config.idleColor}'`)
      if (config.renameWindow) {
        tmux(`set-window-option -t ${w} automatic-rename off`)
        const prefix = config.idleIndicator ? "⏸ " : ""
        tmux(`rename-window -t ${w} "${prefix}c-${dirName()}"`)
      }
      markAttention(w, config.hookSlot)
    } else if (
      ctx.notificationType === "permission_prompt" ||
      ctx.notificationType === "elicitation_dialog"
    ) {
      setAttentionStyle(w, config.attentionStyle)
      if (config.flashOnPrompt) {
        await flashFocusedWindow()
      }
    }
    return ctx.skip()
  },

  UserPromptSubmit(ctx, config) {
    resetWindow(w, config.renameWindow)
    return ctx.skip()
  },

  PostToolUse(ctx, config) {
    resetWindow(w, config.renameWindow)
    return ctx.skip()
  },

  PostToolUseFailure(ctx, config) {
    resetWindow(w, config.renameWindow)
    return ctx.skip()
  },

  Stop(ctx, config) {
    if (!config.attentionOnStop) return ctx.skip()
    tmux(`set-window-option -t ${w} window-status-style 'fg=${config.stopColor}'`)
    tmux(`set-window-option -t ${w} window-status-current-style 'fg=${config.stopColor}'`)
    markAttention(w, config.hookSlot)
    return ctx.skip()
  },

  SessionStart(ctx, config) {
    resetWindow(w, config.renameWindow)
    return ctx.skip()
  },

  SessionEnd(ctx) {
    tmux(`set-window-option -t ${w} window-status-style default`)
    tmux(`set-window-option -t ${w} -u window-status-current-style`)
    tmux(`set-window-option -t ${w} automatic-rename on`)
    return ctx.skip()
  },
}
