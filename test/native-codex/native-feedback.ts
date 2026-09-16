import type { CapturedRequest } from './fixture-server'
import { requireThat } from './harness'

export function nativeFeedback(request: CapturedRequest, call: string, shell: boolean): string {
  const outputs =
    request.body?.input?.filter(
      (item: any) =>
        item?.call_id === call &&
        item.role === undefined &&
        ['function_call_output', 'custom_tool_call_output'].includes(item.type),
    ) ?? []
  requireThat(
    outputs.length === 1 &&
      outputs[0].type === (shell ? 'function_call_output' : 'custom_tool_call_output') &&
      typeof outputs[0].output === 'string',
    'Missing exact native feedback',
  )
  return outputs[0].output
}
