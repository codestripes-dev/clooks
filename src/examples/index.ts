// Example payloads for `clooks test example <Event>`. Each per-event JSON file
// is text-imported (the same machinery `src/generated/clooks-types.d.ts.txt`
// uses) so the corpus survives `bun build --compile` and the renderer never
// touches the filesystem at runtime.
//
// Per-event required-fields metadata is colocated as `<Event>.meta.ts` and
// re-exported here. Tool-keyed events (PreToolUse, PostToolUse,
// PostToolUseFailure, PermissionRequest) additionally consume the shared
// `tool-inputs.meta.ts`.

import type { EventName } from '../types/branded.js'

// Note: TypeScript infers JSON imports as parsed objects, but at runtime Bun's
// `with { type: 'text' }` returns the file contents as a string. Cast through
// `unknown` to align the static type with the runtime value — same pattern as
// `EMBEDDED_SCHEMA` in `src/commands/init.ts`.
import _EXAMPLE_PRE_TOOL_USE from './contexts/PreToolUse.json' with { type: 'text' }
import _EXAMPLE_POST_TOOL_USE from './contexts/PostToolUse.json' with { type: 'text' }
import _EXAMPLE_POST_TOOL_USE_FAILURE from './contexts/PostToolUseFailure.json' with { type: 'text' }
import _EXAMPLE_PERMISSION_REQUEST from './contexts/PermissionRequest.json' with { type: 'text' }
import _EXAMPLE_USER_PROMPT_SUBMIT from './contexts/UserPromptSubmit.json' with { type: 'text' }
import _EXAMPLE_STOP from './contexts/Stop.json' with { type: 'text' }
import _EXAMPLE_SUBAGENT_STOP from './contexts/SubagentStop.json' with { type: 'text' }
import _EXAMPLE_CONFIG_CHANGE from './contexts/ConfigChange.json' with { type: 'text' }
import _EXAMPLE_STOP_FAILURE from './contexts/StopFailure.json' with { type: 'text' }
import _EXAMPLE_SESSION_START from './contexts/SessionStart.json' with { type: 'text' }
import _EXAMPLE_SESSION_END from './contexts/SessionEnd.json' with { type: 'text' }
import _EXAMPLE_INSTRUCTIONS_LOADED from './contexts/InstructionsLoaded.json' with { type: 'text' }
import _EXAMPLE_NOTIFICATION from './contexts/Notification.json' with { type: 'text' }
import _EXAMPLE_SUBAGENT_START from './contexts/SubagentStart.json' with { type: 'text' }
import _EXAMPLE_WORKTREE_REMOVE from './contexts/WorktreeRemove.json' with { type: 'text' }
import _EXAMPLE_PRE_COMPACT from './contexts/PreCompact.json' with { type: 'text' }
import _EXAMPLE_POST_COMPACT from './contexts/PostCompact.json' with { type: 'text' }
import _EXAMPLE_PERMISSION_DENIED from './contexts/PermissionDenied.json' with { type: 'text' }
import _EXAMPLE_WORKTREE_CREATE from './contexts/WorktreeCreate.json' with { type: 'text' }
import _EXAMPLE_TEAMMATE_IDLE from './contexts/TeammateIdle.json' with { type: 'text' }
import _EXAMPLE_TASK_CREATED from './contexts/TaskCreated.json' with { type: 'text' }
import _EXAMPLE_TASK_COMPLETED from './contexts/TaskCompleted.json' with { type: 'text' }

const EXAMPLE_PRE_TOOL_USE = _EXAMPLE_PRE_TOOL_USE as unknown as string
const EXAMPLE_POST_TOOL_USE = _EXAMPLE_POST_TOOL_USE as unknown as string
const EXAMPLE_POST_TOOL_USE_FAILURE = _EXAMPLE_POST_TOOL_USE_FAILURE as unknown as string
const EXAMPLE_PERMISSION_REQUEST = _EXAMPLE_PERMISSION_REQUEST as unknown as string
const EXAMPLE_USER_PROMPT_SUBMIT = _EXAMPLE_USER_PROMPT_SUBMIT as unknown as string
const EXAMPLE_STOP = _EXAMPLE_STOP as unknown as string
const EXAMPLE_SUBAGENT_STOP = _EXAMPLE_SUBAGENT_STOP as unknown as string
const EXAMPLE_CONFIG_CHANGE = _EXAMPLE_CONFIG_CHANGE as unknown as string
const EXAMPLE_STOP_FAILURE = _EXAMPLE_STOP_FAILURE as unknown as string
const EXAMPLE_SESSION_START = _EXAMPLE_SESSION_START as unknown as string
const EXAMPLE_SESSION_END = _EXAMPLE_SESSION_END as unknown as string
const EXAMPLE_INSTRUCTIONS_LOADED = _EXAMPLE_INSTRUCTIONS_LOADED as unknown as string
const EXAMPLE_NOTIFICATION = _EXAMPLE_NOTIFICATION as unknown as string
const EXAMPLE_SUBAGENT_START = _EXAMPLE_SUBAGENT_START as unknown as string
const EXAMPLE_WORKTREE_REMOVE = _EXAMPLE_WORKTREE_REMOVE as unknown as string
const EXAMPLE_PRE_COMPACT = _EXAMPLE_PRE_COMPACT as unknown as string
const EXAMPLE_POST_COMPACT = _EXAMPLE_POST_COMPACT as unknown as string
const EXAMPLE_PERMISSION_DENIED = _EXAMPLE_PERMISSION_DENIED as unknown as string
const EXAMPLE_WORKTREE_CREATE = _EXAMPLE_WORKTREE_CREATE as unknown as string
const EXAMPLE_TEAMMATE_IDLE = _EXAMPLE_TEAMMATE_IDLE as unknown as string
const EXAMPLE_TASK_CREATED = _EXAMPLE_TASK_CREATED as unknown as string
const EXAMPLE_TASK_COMPLETED = _EXAMPLE_TASK_COMPLETED as unknown as string

import META_PRE_TOOL_USE from './contexts/PreToolUse.meta.js'
import META_POST_TOOL_USE from './contexts/PostToolUse.meta.js'
import META_POST_TOOL_USE_FAILURE from './contexts/PostToolUseFailure.meta.js'
import META_PERMISSION_REQUEST from './contexts/PermissionRequest.meta.js'
import META_USER_PROMPT_SUBMIT from './contexts/UserPromptSubmit.meta.js'
import META_STOP from './contexts/Stop.meta.js'
import META_SUBAGENT_STOP from './contexts/SubagentStop.meta.js'
import META_CONFIG_CHANGE from './contexts/ConfigChange.meta.js'
import META_STOP_FAILURE from './contexts/StopFailure.meta.js'
import META_SESSION_START from './contexts/SessionStart.meta.js'
import META_SESSION_END from './contexts/SessionEnd.meta.js'
import META_INSTRUCTIONS_LOADED from './contexts/InstructionsLoaded.meta.js'
import META_NOTIFICATION from './contexts/Notification.meta.js'
import META_SUBAGENT_START from './contexts/SubagentStart.meta.js'
import META_WORKTREE_REMOVE from './contexts/WorktreeRemove.meta.js'
import META_PRE_COMPACT from './contexts/PreCompact.meta.js'
import META_POST_COMPACT from './contexts/PostCompact.meta.js'
import META_PERMISSION_DENIED from './contexts/PermissionDenied.meta.js'
import META_WORKTREE_CREATE from './contexts/WorktreeCreate.meta.js'
import META_TEAMMATE_IDLE from './contexts/TeammateIdle.meta.js'
import META_TASK_CREATED from './contexts/TaskCreated.meta.js'
import META_TASK_COMPLETED from './contexts/TaskCompleted.meta.js'

export interface RequiredFieldDoc {
  readonly name: string
  readonly type: string
  readonly description: string
}

export interface EventMeta {
  readonly required: ReadonlyArray<RequiredFieldDoc>
}

/** The 4 events whose `toolInput` shape depends on `toolName`. */
export const TOOL_KEYED_EVENTS = new Set<EventName>([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
])

/** In-binary example payloads (text-imported), one per event. */
export const EXAMPLES: Record<EventName, string> = {
  PreToolUse: EXAMPLE_PRE_TOOL_USE,
  PostToolUse: EXAMPLE_POST_TOOL_USE,
  PostToolUseFailure: EXAMPLE_POST_TOOL_USE_FAILURE,
  PermissionRequest: EXAMPLE_PERMISSION_REQUEST,
  UserPromptSubmit: EXAMPLE_USER_PROMPT_SUBMIT,
  Stop: EXAMPLE_STOP,
  SubagentStop: EXAMPLE_SUBAGENT_STOP,
  ConfigChange: EXAMPLE_CONFIG_CHANGE,
  StopFailure: EXAMPLE_STOP_FAILURE,
  SessionStart: EXAMPLE_SESSION_START,
  SessionEnd: EXAMPLE_SESSION_END,
  InstructionsLoaded: EXAMPLE_INSTRUCTIONS_LOADED,
  Notification: EXAMPLE_NOTIFICATION,
  SubagentStart: EXAMPLE_SUBAGENT_START,
  WorktreeRemove: EXAMPLE_WORKTREE_REMOVE,
  PreCompact: EXAMPLE_PRE_COMPACT,
  PostCompact: EXAMPLE_POST_COMPACT,
  PermissionDenied: EXAMPLE_PERMISSION_DENIED,
  WorktreeCreate: EXAMPLE_WORKTREE_CREATE,
  TeammateIdle: EXAMPLE_TEAMMATE_IDLE,
  TaskCreated: EXAMPLE_TASK_CREATED,
  TaskCompleted: EXAMPLE_TASK_COMPLETED,
}

/** Per-event required-fields metadata, used by the example renderer. */
export const META: Record<EventName, EventMeta> = {
  PreToolUse: META_PRE_TOOL_USE,
  PostToolUse: META_POST_TOOL_USE,
  PostToolUseFailure: META_POST_TOOL_USE_FAILURE,
  PermissionRequest: META_PERMISSION_REQUEST,
  UserPromptSubmit: META_USER_PROMPT_SUBMIT,
  Stop: META_STOP,
  SubagentStop: META_SUBAGENT_STOP,
  ConfigChange: META_CONFIG_CHANGE,
  StopFailure: META_STOP_FAILURE,
  SessionStart: META_SESSION_START,
  SessionEnd: META_SESSION_END,
  InstructionsLoaded: META_INSTRUCTIONS_LOADED,
  Notification: META_NOTIFICATION,
  SubagentStart: META_SUBAGENT_START,
  WorktreeRemove: META_WORKTREE_REMOVE,
  PreCompact: META_PRE_COMPACT,
  PostCompact: META_POST_COMPACT,
  PermissionDenied: META_PERMISSION_DENIED,
  WorktreeCreate: META_WORKTREE_CREATE,
  TeammateIdle: META_TEAMMATE_IDLE,
  TaskCreated: META_TASK_CREATED,
  TaskCompleted: META_TASK_COMPLETED,
}

export { TOOL_INPUT_DOCS } from './tool-inputs.meta.js'
export type { ToolInputFieldDoc } from './tool-inputs.meta.js'
