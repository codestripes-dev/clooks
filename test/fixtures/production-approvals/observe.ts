import { record } from './records'
const input = await Bun.stdin.json()
record(
  process.env.APPROVAL_ROOT!,
  input.hook_event_name === 'PreToolUse' ? 'native-pre' : 'native-post',
  { input },
)
