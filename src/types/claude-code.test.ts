import { describe, test, expect } from 'bun:test'
import type {
  ClaudeCodeInput,
  NotificationInput,
  SessionEndInput,
  StopInput,
  SubagentStopInput,
  SubagentStartInput,
  InstructionsLoadedInput,
  PostToolUseFailureInput,
  PermissionRequestInput,
  ConfigChangeInput,
  WorktreeCreateInput,
  WorktreeRemoveInput,
  PreCompactInput,
  PostCompactInput,
  TeammateIdleInput,
  TaskCreatedInput,
  TaskCompletedInput,
} from './claude-code.js'

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
})
