import { expect, test } from 'bun:test'
import { globalCodexConfigArgs } from './native'

test('global Codex overrides quote scalar values and contain only model configuration', () => {
  const args = globalCodexConfigArgs(
    '/tmp/native approvals/project',
    '/tmp/native approvals/models.json',
    'http://127.0.0.1:43123/v1',
  )
  const assignments = args.filter((_, index) => index % 2 === 1)
  const keys = assignments.map((assignment) => assignment.slice(0, assignment.indexOf('=')))

  expect(args).toEqual([
    '-c',
    'model="gpt-5.1-codex"',
    '-c',
    'model_catalog_json="/tmp/native approvals/models.json"',
    '-c',
    'model_provider="native_fixture"',
    '-c',
    'approval_policy="on-request"',
    '-c',
    'projects."/tmp/native approvals/project".trust_level="trusted"',
    '-c',
    'features.enable_request_compression=false',
    '-c',
    'features.remote_plugin=false',
    '-c',
    'model_providers.native_fixture.name="Local fixture"',
    '-c',
    'model_providers.native_fixture.base_url="http://127.0.0.1:43123/v1"',
    '-c',
    'model_providers.native_fixture.wire_api="responses"',
    '-c',
    'model_providers.native_fixture.requires_openai_auth=false',
    '-c',
    'model_providers.native_fixture.supports_websockets=false',
    '-c',
    'model_providers.native_fixture.request_max_retries=0',
    '-c',
    'model_providers.native_fixture.stream_max_retries=0',
    '-c',
    'model_providers.native_fixture.stream_idle_timeout_ms=15000',
  ])
  expect(keys.some((key) => /^(hooks|mcp_servers|server)(?:\.|$)/.test(key))).toBe(false)
})
