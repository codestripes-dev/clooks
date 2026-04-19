import { describe, test, expect } from 'bun:test'
import type {
  ClaudeCodeInput,
  NotificationInput,
  SessionEndInput,
  StopInput,
  SubagentStopInput,
  StopFailureInput,
  SubagentStartInput,
  InstructionsLoadedInput,
  PostToolUseFailureInput,
  PermissionRequestInput,
  PermissionDeniedInput,
  ConfigChangeInput,
  WorktreeCreateInput,
  WorktreeRemoveInput,
  PreCompactInput,
  PostCompactInput,
  TeammateIdleInput,
  TaskCreatedInput,
  TaskCompletedInput,
} from './claude-code.js'
import type { NotificationContext, SessionEndContext } from './contexts.js'
import type { PermissionUpdateEntry } from './permissions.js'

/**
 * Exhaustively switches on hook_event_name and returns a string built from
 * fields that only exist on the narrowed-to branch. If any *Input type is
 * missing its fields or its discriminant, this helper fails to typecheck.
 */
function describeInput(input: ClaudeCodeInput): string {
  switch (input.hook_event_name) {
    case 'PreToolUse':
      return `PreToolUse:${input.tool_name}:${input.tool_use_id}`
    case 'PostToolUse':
      return `PostToolUse:${input.tool_name}:${input.tool_use_id}`
    case 'UserPromptSubmit':
      return `UserPromptSubmit:${input.prompt}`
    case 'SessionStart':
      return `SessionStart:${input.source}`
    case 'SessionEnd':
      return `SessionEnd:${input.reason}`
    case 'Stop':
      return `Stop:${String(input.stop_hook_active)}:${input.last_assistant_message}`
    case 'StopFailure':
      return `StopFailure:${input.error}:${input.error_details ?? ''}:${input.last_assistant_message ?? ''}`
    case 'SubagentStop':
      return `SubagentStop:${input.agent_transcript_path}:${input.last_assistant_message}:${input.agent_id}:${String(input.stop_hook_active)}`
    case 'SubagentStart':
      return `SubagentStart:${input.agent_id}:${input.agent_type}`
    case 'InstructionsLoaded':
      return `InstructionsLoaded:${input.file_path}:${input.memory_type}:${input.load_reason}`
    case 'PostToolUseFailure':
      return `PostToolUseFailure:${input.tool_name}:${input.error}`
    case 'Notification':
      return `Notification:${input.notification_type}:${input.message}`
    case 'PermissionRequest':
      return `PermissionRequest:${input.tool_name}`
    case 'PermissionDenied':
      return `PermissionDenied:${input.tool_name}`
    case 'ConfigChange':
      return `ConfigChange:${input.source}`
    case 'WorktreeCreate':
      return `WorktreeCreate:${input.name}`
    case 'WorktreeRemove':
      return `WorktreeRemove:${input.worktree_path}`
    case 'PreCompact':
      return `PreCompact:${input.trigger}:${input.custom_instructions}`
    case 'PostCompact':
      return `PostCompact:${input.trigger}:${input.compact_summary}`
    case 'TeammateIdle':
      return `TeammateIdle:${input.teammate_name}:${input.team_name}`
    case 'TaskCreated':
      return `TaskCreated:${input.task_id}:${input.task_subject}`
    case 'TaskCompleted':
      return `TaskCompleted:${input.task_id}:${input.task_subject}`
    default:
      return `Unknown:${input.hook_event_name}`
  }
}

const common = {
  session_id: 'sess-1',
  cwd: '/tmp/proj',
  permission_mode: 'default',
  transcript_path: '/tmp/proj/.claude/transcript.jsonl',
}

describe('ClaudeCodeInput discriminated union narrowing', () => {
  test('Notification narrows to typed fields', () => {
    const input: NotificationInput = {
      ...common,
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'hello',
    }
    expect(describeInput(input)).toBe('Notification:permission_prompt:hello')
  })

  test('SessionEnd narrows to reason', () => {
    const input: SessionEndInput = {
      ...common,
      hook_event_name: 'SessionEnd',
      reason: 'logout',
    }
    expect(describeInput(input)).toBe('SessionEnd:logout')
  })

  test('Stop narrows to stop_hook_active and last_assistant_message', () => {
    const input: StopInput = {
      ...common,
      hook_event_name: 'Stop',
      stop_hook_active: true,
      last_assistant_message: 'done',
    }
    expect(describeInput(input)).toBe('Stop:true:done')
  })

  test('StopFailure narrows to error, error_details, last_assistant_message (API error string, not Claude text)', () => {
    // Semantic trap: unlike Stop / SubagentStop where last_assistant_message carries
    // Claude's conversational text, for StopFailure it carries the rendered API error
    // string (e.g., "API Error: Rate limit reached"). A Stop handler copy-pasted onto
    // StopFailure that parses this field as natural language will misbehave.
    const input: StopFailureInput = {
      ...common,
      hook_event_name: 'StopFailure',
      error: 'rate_limit',
      error_details: '429 Too Many Requests',
      last_assistant_message: 'API Error: Rate limit reached',
    }
    expect(describeInput(input)).toBe(
      'StopFailure:rate_limit:429 Too Many Requests:API Error: Rate limit reached',
    )
  })

  test('StopFailure accepts forward-compat error via (string & {}) tail', () => {
    const input: StopFailureInput = {
      ...common,
      hook_event_name: 'StopFailure',
      error: 'future_error_type_not_yet_known',
    }
    expect(describeInput(input)).toBe('StopFailure:future_error_type_not_yet_known::')
    // Optional fields default to undefined.
    expect(input.error_details).toBeUndefined()
    expect(input.last_assistant_message).toBeUndefined()
  })

  test('StopFailure with empty-string error_details is distinct from undefined', () => {
    // Pin the type-level distinction between optional-absent and optional-present-empty.
    // Mirrors the PreCompact empty custom_instructions test earlier in this file.
    const input: StopFailureInput = {
      ...common,
      hook_event_name: 'StopFailure',
      error: 'unknown',
      error_details: '',
    }
    expect(input.error_details).toBe('')
    expect(input.error_details).not.toBeUndefined()
    expect(describeInput(input)).toBe('StopFailure:unknown::')
  })

  test('StopFailure error accepts all seven documented literals', () => {
    // Living catalogue: surfaces immediately if any upstream-documented error
    // literal is removed from StopFailureErrorType. No TypeScript-safety benefit
    // (the tail makes every string assignable) — purely a documentation guard.
    const make = (error: StopFailureInput['error']): StopFailureInput => ({
      ...common,
      hook_event_name: 'StopFailure',
      error,
    })
    const errors: Array<StopFailureInput['error']> = [
      'rate_limit',
      'authentication_failed',
      'billing_error',
      'invalid_request',
      'server_error',
      'max_output_tokens',
      'unknown',
    ]
    for (const e of errors) {
      expect(make(e).error).toBe(e)
    }
  })

  test('SubagentStop narrows to agent_transcript_path', () => {
    const input: SubagentStopInput = {
      ...common,
      hook_event_name: 'SubagentStop',
      stop_hook_active: false,
      last_assistant_message: 'analysis done',
      agent_transcript_path: '/tmp/agent.jsonl',
      agent_id: 'agent-1',
      agent_type: 'Explore',
    }
    expect(describeInput(input)).toBe('SubagentStop:/tmp/agent.jsonl:analysis done:agent-1:false')
  })

  test('SubagentStart narrows to agent_id and agent_type', () => {
    const input: SubagentStartInput = {
      ...common,
      hook_event_name: 'SubagentStart',
      agent_id: 'agent-1',
      agent_type: 'Explore',
    }
    expect(describeInput(input)).toBe('SubagentStart:agent-1:Explore')
  })

  test('InstructionsLoaded narrows to file_path, memory_type, load_reason', () => {
    const input: InstructionsLoadedInput = {
      ...common,
      hook_event_name: 'InstructionsLoaded',
      file_path: '/proj/CLAUDE.md',
      memory_type: 'Project',
      load_reason: 'session_start',
    }
    expect(describeInput(input)).toBe('InstructionsLoaded:/proj/CLAUDE.md:Project:session_start')
  })

  test('PostToolUseFailure narrows to error', () => {
    const input: PostToolUseFailureInput = {
      ...common,
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_use_id: 'tool-1',
      error: 'exit 1',
    }
    expect(describeInput(input)).toBe('PostToolUseFailure:Bash:exit 1')
  })

  test('PermissionRequest narrows to tool_name', () => {
    const input: PermissionRequestInput = {
      ...common,
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf node_modules' },
    }
    expect(describeInput(input)).toBe('PermissionRequest:Bash')
  })

  test('PermissionDenied narrows to tool_name (verifies exact branch, not default fallthrough)', () => {
    // The describeInput switch has a default: branch that absorbs unhandled cases as
    // "Unknown:...". A missing case would silently fall through to "Unknown:PermissionDenied".
    // This test explicitly asserts the narrowed string to prove the branch is reached.
    const input: PermissionDeniedInput = {
      ...common,
      hook_event_name: 'PermissionDenied',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/build' },
      tool_use_id: 'toolu_01TEST',
      reason: 'Auto mode denied: command targets a path outside the project',
    }
    expect(describeInput(input)).toBe('PermissionDenied:Bash')
  })

  test('ConfigChange narrows to source', () => {
    const input: ConfigChangeInput = {
      ...common,
      hook_event_name: 'ConfigChange',
      source: 'project_settings',
      file_path: '/proj/.claude/settings.json',
    }
    expect(describeInput(input)).toBe('ConfigChange:project_settings')
  })

  test('WorktreeCreate narrows to name', () => {
    const input: WorktreeCreateInput = {
      ...common,
      hook_event_name: 'WorktreeCreate',
      name: 'feature-auth',
    }
    expect(describeInput(input)).toBe('WorktreeCreate:feature-auth')
  })

  test('WorktreeRemove narrows to worktree_path', () => {
    const input: WorktreeRemoveInput = {
      ...common,
      hook_event_name: 'WorktreeRemove',
      worktree_path: '/proj/.claude/worktrees/feature-auth',
    }
    expect(describeInput(input)).toBe('WorktreeRemove:/proj/.claude/worktrees/feature-auth')
  })

  test('PreCompact narrows to trigger and custom_instructions', () => {
    const input: PreCompactInput = {
      ...common,
      hook_event_name: 'PreCompact',
      trigger: 'manual',
      custom_instructions: 'summarize design',
    }
    expect(describeInput(input)).toBe('PreCompact:manual:summarize design')
  })

  test('PreCompact narrows to trigger and custom_instructions (auto, empty string)', () => {
    const input: PreCompactInput = {
      ...common,
      hook_event_name: 'PreCompact',
      trigger: 'auto',
      custom_instructions: '',
    }
    expect(describeInput(input)).toBe('PreCompact:auto:')
  })

  test('PostCompact narrows to trigger and compact_summary', () => {
    const input: PostCompactInput = {
      ...common,
      hook_event_name: 'PostCompact',
      trigger: 'auto',
      compact_summary: 'conversation summary text',
    }
    expect(describeInput(input)).toBe('PostCompact:auto:conversation summary text')
  })

  test('TeammateIdle narrows to teammate_name and team_name', () => {
    const input: TeammateIdleInput = {
      ...common,
      hook_event_name: 'TeammateIdle',
      teammate_name: 'researcher',
      team_name: 'my-project',
    }
    expect(describeInput(input)).toBe('TeammateIdle:researcher:my-project')
  })

  test('TaskCreated narrows to task_id and task_subject', () => {
    const input: TaskCreatedInput = {
      ...common,
      hook_event_name: 'TaskCreated',
      task_id: 'task-001',
      task_subject: 'Implement user authentication',
    }
    expect(describeInput(input)).toBe('TaskCreated:task-001:Implement user authentication')
  })

  test('TaskCreated accepts all optional fields (task_description, teammate_name, team_name)', () => {
    const input: TaskCreatedInput = {
      ...common,
      hook_event_name: 'TaskCreated',
      task_id: 'task-042',
      task_subject: 'Ship M2',
      task_description: 'Register TaskCreated as continuation event sibling',
      teammate_name: 'builder',
      team_name: 'clooks',
    }
    expect(input.task_description).toBe('Register TaskCreated as continuation event sibling')
    expect(input.teammate_name).toBe('builder')
    expect(input.team_name).toBe('clooks')
  })

  test('TaskCompleted narrows to task_id and task_subject', () => {
    const input: TaskCompletedInput = {
      ...common,
      hook_event_name: 'TaskCompleted',
      task_id: 'task-001',
      task_subject: 'Implement user authentication',
    }
    expect(describeInput(input)).toBe('TaskCompleted:task-001:Implement user authentication')
  })

  test('Unknown hook_event_name falls through to the catch-all arm', () => {
    const input = {
      ...common,
      hook_event_name: 'FutureEvent',
    } as ClaudeCodeInput
    expect(describeInput(input)).toBe('Unknown:FutureEvent')
  })

  test('Notification notification_type accepts novel values via the (string & {}) tail', () => {
    const input: NotificationInput = {
      ...common,
      hook_event_name: 'Notification',
      notification_type: 'future_type_not_yet_known',
      message: 'forward compat',
    }
    expect(describeInput(input)).toBe('Notification:future_type_not_yet_known:forward compat')
  })

  test('InstructionsLoaded accepts all optional fields (globs, trigger_file_path, parent_file_path)', () => {
    const input: InstructionsLoadedInput = {
      ...common,
      hook_event_name: 'InstructionsLoaded',
      file_path: '/proj/.claude/rules/testing.md',
      memory_type: 'Project',
      load_reason: 'path_glob_match',
      globs: ['**/*.test.ts', '**/*.spec.ts'],
      trigger_file_path: '/proj/src/foo.test.ts',
      parent_file_path: '/proj/CLAUDE.md',
    }
    expect(input.globs).toEqual(['**/*.test.ts', '**/*.spec.ts'])
    expect(input.trigger_file_path).toBe('/proj/src/foo.test.ts')
    expect(input.parent_file_path).toBe('/proj/CLAUDE.md')
  })

  test('TaskCompleted accepts all optional fields (task_description, teammate_name, team_name)', () => {
    const input: TaskCompletedInput = {
      ...common,
      hook_event_name: 'TaskCompleted',
      task_id: 'task-042',
      task_subject: 'Ship M1',
      task_description: 'Wire up the discriminated union and narrow fields',
      teammate_name: 'builder',
      team_name: 'clooks',
    }
    expect(input.task_description).toBe('Wire up the discriminated union and narrow fields')
    expect(input.teammate_name).toBe('builder')
    expect(input.team_name).toBe('clooks')
  })

  test('NotificationInput.notification_type is optional (omitted payload typechecks)', () => {
    // Regression target: prior to M2 this required notification_type.
    // Upstream omits it when matcher is not specified, so the field must be optional.
    const input: NotificationInput = {
      ...common,
      hook_event_name: 'Notification',
      message: 'hello without type',
    }
    // Runtime shape: notification_type is absent (undefined) but still narrows cleanly.
    expect(input.notification_type).toBeUndefined()
    // Pin the runtime serialization when the field is absent.
    expect(describeInput(input)).toBe('Notification:undefined:hello without type')
    // Regression: still accepts a typed value when present (pre-M2 behavior unchanged).
    const typed: NotificationInput = {
      ...common,
      hook_event_name: 'Notification',
      message: 'hello with type',
      notification_type: 'idle_prompt',
    }
    expect(typed.notification_type).toBe('idle_prompt')
  })

  test('SessionEndInput.reason accepts "resume"', () => {
    // M2: upstream added "resume" to the documented reason value set.
    const input: SessionEndInput = {
      ...common,
      hook_event_name: 'SessionEnd',
      reason: 'resume',
    }
    expect(describeInput(input)).toBe('SessionEnd:resume')
    // Regression: existing values still narrow correctly.
    const logout: SessionEndInput = {
      ...common,
      hook_event_name: 'SessionEnd',
      reason: 'logout',
    }
    expect(describeInput(logout)).toBe('SessionEnd:logout')
  })
})

describe('camelCase *Context narrowing (M2 optionality + enum widening)', () => {
  const baseCtx = {
    sessionId: 'sess-1',
    cwd: '/tmp/proj',
    permissionMode: 'default' as const,
    transcriptPath: '/tmp/proj/.claude/transcript.jsonl',
    parallel: false,
    signal: new AbortController().signal,
  }

  test('NotificationContext.notificationType may be undefined', () => {
    // M2: the field was required; upstream treats it as optional. This test
    // pins the optionality at the camelCase layer so a future tightening
    // triggers a typecheck failure.
    const ctx: NotificationContext = {
      ...baseCtx,
      event: 'Notification',
      message: 'no type',
    }
    expect(ctx.notificationType).toBeUndefined()
    // Regression: a present value still types.
    const withType: NotificationContext = {
      ...baseCtx,
      event: 'Notification',
      message: 'typed',
      notificationType: 'permission_prompt',
    }
    expect(withType.notificationType).toBe('permission_prompt')
  })

  test('SessionEndContext.reason narrows "resume"', () => {
    // M2: the branded SessionEndReason gained "resume" to match upstream.
    const ctx: SessionEndContext = {
      ...baseCtx,
      event: 'SessionEnd',
      reason: 'resume',
    }
    expect(ctx.reason).toBe('resume')
    // Regression: pre-existing values still narrow (string literal preserved).
    const logout: SessionEndContext = {
      ...baseCtx,
      event: 'SessionEnd',
      reason: 'logout',
    }
    expect(logout.reason).toBe('logout')
  })
})

/**
 * Exhaustive narrowing helper over PermissionUpdateEntry. Each branch accesses
 * fields that only exist on the narrowed variant — if the discriminant isn't
 * working, this fails to typecheck.
 */
function describePermissionUpdateEntry(entry: PermissionUpdateEntry): string {
  switch (entry.type) {
    case 'addRules':
      return `addRules:${entry.rules.length}:${entry.behavior}:${entry.destination}`
    case 'replaceRules':
      return `replaceRules:${entry.rules.length}:${entry.behavior}:${entry.destination}`
    case 'removeRules':
      return `removeRules:${entry.rules.length}:${entry.behavior}:${entry.destination}`
    case 'setMode':
      return `setMode:${entry.mode}:${entry.destination}`
    case 'addDirectories':
      return `addDirectories:${entry.directories.length}:${entry.destination}`
    case 'removeDirectories':
      return `removeDirectories:${entry.directories.length}:${entry.destination}`
    default: {
      // Exhaustiveness check: if a new variant is added and not handled here,
      // this line fails to typecheck.
      const _exhaustive: never = entry
      return `unknown:${String(_exhaustive)}`
    }
  }
}

describe('PermissionUpdateEntry discriminated narrowing (M4)', () => {
  test('if (entry.type === "addRules") narrows to addRules variant (entry.rules accessible)', () => {
    const entry: PermissionUpdateEntry = {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'npm test' }],
      behavior: 'allow',
      destination: 'session',
    }
    if (entry.type === 'addRules') {
      // No cast required — `rules` is directly accessible.
      expect(entry.rules[0]!.toolName).toBe('Bash')
      expect(entry.rules[0]!.ruleContent).toBe('npm test')
      expect(entry.behavior).toBe('allow')
    } else {
      throw new Error('narrowing failed')
    }
  })

  test('if (entry.type === "setMode") narrows to setMode variant (entry.mode accessible)', () => {
    const entry: PermissionUpdateEntry = {
      type: 'setMode',
      mode: 'acceptEdits',
      destination: 'session',
    }
    if (entry.type === 'setMode') {
      // No cast required — `mode` is directly accessible.
      expect(entry.mode).toBe('acceptEdits')
    } else {
      throw new Error('narrowing failed')
    }
  })

  test('switch-exhaustive helper handles all six variants', () => {
    const entries: PermissionUpdateEntry[] = [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash' }],
        behavior: 'allow',
        destination: 'session',
      },
      {
        type: 'replaceRules',
        rules: [{ toolName: 'Edit' }, { toolName: 'Write' }],
        behavior: 'deny',
        destination: 'projectSettings',
      },
      {
        type: 'removeRules',
        rules: [{ toolName: 'Bash', ruleContent: 'rm -rf *' }],
        behavior: 'ask',
        destination: 'localSettings',
      },
      {
        type: 'setMode',
        mode: 'plan',
        destination: 'userSettings',
      },
      {
        type: 'addDirectories',
        directories: ['/tmp/a', '/tmp/b'],
        destination: 'session',
      },
      {
        type: 'removeDirectories',
        directories: ['/tmp/c'],
        destination: 'localSettings',
      },
    ]
    const described = entries.map(describePermissionUpdateEntry)
    expect(described).toEqual([
      'addRules:1:allow:session',
      'replaceRules:2:deny:projectSettings',
      'removeRules:1:ask:localSettings',
      'setMode:plan:userSettings',
      'addDirectories:2:session',
      'removeDirectories:1:localSettings',
    ])
  })
})
