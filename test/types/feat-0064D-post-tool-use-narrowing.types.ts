// PLAN-FEAT-0064D M4 type-narrowing regression checks for the new
// PostToolUse / PostToolUseFailure discriminated unions.
//
// `PostToolUseContext` and `PostToolUseFailureContext` were promoted from
// flat record types to discriminated unions over the 10 known tool names in
// PLAN-FEAT-0064D, mirroring `PreToolUseContext` and
// `PermissionRequestContext`. These tests assert that narrowing on
// `ctx.toolName` produces the typed `ctx.toolInput` shape, and that the
// per-arm decision methods are present post-narrowing.
//
// The `@ts-expect-error` directives below MUST fire — if they don't, the
// type system has weakened and the DU promotion has regressed.
//
// Run via `bun run typecheck` (the project tsconfig.json includes `test/`).
//
// Stanzas:
//   (a) PostToolUse Bash arm — `ctx.toolInput.command` typed `string`;
//       a Write-only field is rejected.
//   (b) PostToolUse Write arm — `ctx.toolInput.filePath` typed `string`;
//       a Bash-only field is rejected.
//   (c) PostToolUse — `ctx.skip()` and `ctx.block({ reason })` available
//       post-narrowing on each arm.
//   (d) PostToolUseFailure Bash arm — `ctx.toolInput.command` typed
//       `string`; `ctx.error` typed `string` at the prefix; foreign field
//       rejected.
//   (e) PostToolUseFailure — `ctx.skip()` available post-narrowing.
//   (f) UnknownPostToolUseContext — type-level shape assertions; methods
//       present.
//   (g) UnknownPostToolUseFailureContext — type-level shape assertions;
//       `ctx.error` accessible at the prefix; method present.

import type { PostToolUseContext, PostToolUseFailureContext } from '../../src/types/contexts.js'
import type {
  UnknownPostToolUseContext,
  UnknownPostToolUseFailureContext,
} from '../../src/types/index.js'

declare const ctx: PostToolUseContext
declare const failCtx: PostToolUseFailureContext
declare const unknownCtx: UnknownPostToolUseContext
declare const unknownFailCtx: UnknownPostToolUseFailureContext

// (a) PostToolUse: Bash arm — `command` typed string; foreign Write field rejected.
if (ctx.toolName === 'Bash') {
  const _cmd: string = ctx.toolInput.command
  void _cmd
  // @ts-expect-error — filePath does not exist on BashToolInput
  const _bad: string = ctx.toolInput.filePath
  void _bad
}

// (b) PostToolUse: Write arm — `filePath` typed string; foreign Bash field rejected.
if (ctx.toolName === 'Write') {
  const _path: string = ctx.toolInput.filePath
  const _content: string = ctx.toolInput.content
  void _path
  void _content
  // @ts-expect-error — command does not exist on WriteToolInput
  const _bad: string = ctx.toolInput.command
  void _bad
}

// (c) PostToolUse: methods present post-narrowing on each arm.
if (ctx.toolName === 'Bash') {
  void ctx.skip()
  void ctx.skip({ debugMessage: 'd' })
  void ctx.block({ reason: 'x' })
}
if (ctx.toolName === 'Write') {
  void ctx.skip()
  void ctx.block({ reason: 'x' })
}

// (d) PostToolUseFailure: Bash arm — typed input + `error: string` prefix.
if (failCtx.toolName === 'Bash') {
  const _cmd: string = failCtx.toolInput.command
  const _err: string = failCtx.error
  void _cmd
  void _err
  // @ts-expect-error — filePath does not exist on BashToolInput
  const _bad: string = failCtx.toolInput.filePath
  void _bad
}

// PostToolUseFailure: Write arm — foreign Bash field rejected.
if (failCtx.toolName === 'Write') {
  const _path: string = failCtx.toolInput.filePath
  void _path
  // @ts-expect-error — command does not exist on WriteToolInput
  const _bad: string = failCtx.toolInput.command
  void _bad
}

// (e) PostToolUseFailure: skip method available post-narrowing.
if (failCtx.toolName === 'Bash') {
  void failCtx.skip()
  void failCtx.skip({ debugMessage: 'd', injectContext: 'i' })
}

// (f) UnknownPostToolUseContext: shape assertions + methods present.
{
  // toolName is a plain string, not a known-tool literal union.
  const _name: string = unknownCtx.toolName
  void _name

  // toolInput is Record<string, unknown> on the unknown variant.
  const _input: Record<string, unknown> = unknownCtx.toolInput
  void _input

  // toolResponse is unknown at the prefix.
  const _resp: unknown = unknownCtx.toolResponse
  void _resp

  // skip and block are present on the unknown variant.
  void unknownCtx.skip()
  void unknownCtx.block({ reason: 'x' })
}

// (g) UnknownPostToolUseFailureContext: shape assertions + method present.
{
  const _name: string = unknownFailCtx.toolName
  void _name

  const _input: Record<string, unknown> = unknownFailCtx.toolInput
  void _input

  // error: string accessible at the prefix.
  const _err: string = unknownFailCtx.error
  void _err

  // skip method available on the unknown variant.
  void unknownFailCtx.skip()
}
