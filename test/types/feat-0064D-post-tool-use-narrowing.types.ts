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
//       a Write-only field is rejected; `toolResponse: unknown` reachable
//       at the prefix; `originalToolInput` is NOT present (Plan D regression
//       gate).
//   (b) PostToolUse Write arm — `ctx.toolInput.filePath` typed `string`;
//       a Bash-only field is rejected.
//   (c) PostToolUse — `ctx.skip()` and `ctx.block({ reason })` available
//       post-narrowing on each arm; `skip` accepts `injectContext` and
//       `updatedMCPToolOutput`.
//   (d) PostToolUseFailure Bash arm — `ctx.toolInput.command` typed
//       `string`; `ctx.error` typed `string` at the prefix; foreign field
//       rejected; `block` is NOT a method (only `skip` is defined);
//       `originalToolInput` is NOT present (Plan D regression gate).
//   (e) PostToolUseFailure Write arm — foreign Bash field rejected.
//   (f) PostToolUseFailure — `ctx.skip()` available post-narrowing.
//   (g) UnknownPostToolUseContext — type-level shape assertions; methods
//       present.
//   (h) UnknownPostToolUseFailureContext — type-level shape assertions;
//       `ctx.error` accessible at the prefix; `skip` present; `block` is
//       NOT a method.

import type { PostToolUseContext, PostToolUseFailureContext } from '../../src/types/contexts.js'
import type {
  UnknownPostToolUseContext,
  UnknownPostToolUseFailureContext,
} from '../../src/types/index.js'

declare const ctx: PostToolUseContext
declare const failCtx: PostToolUseFailureContext
declare const unknownCtx: UnknownPostToolUseContext
declare const unknownFailCtx: UnknownPostToolUseFailureContext

// (a) PostToolUse: Bash arm — `command` typed string; foreign Write field rejected;
//     `toolResponse: unknown` is reachable on every narrowed arm; `originalToolInput`
//     is NOT present (Plan D dropped it — upstream Claude Code does not send this
//     field on Post* events; only Pre* via ToolVariantWithOriginal). Regression gate.
if (ctx.toolName === 'Bash') {
  const _cmd: string = ctx.toolInput.command
  void _cmd
  // @ts-expect-error — filePath does not exist on BashToolInput
  const _bad: string = ctx.toolInput.filePath
  void _bad

  // toolResponse is at the prefix — present on every arm post-narrowing.
  const _resp: unknown = ctx.toolResponse
  void _resp

  // @ts-expect-error — originalToolInput is not on PostToolUseContext (ToolVariant, not ToolVariantWithOriginal)
  void ctx.originalToolInput
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
//     `skip` accepts `InjectContext & UpdatedMcpToolOutput` (in addition to
//     `debugMessage` from the method-shape primitive opts).
if (ctx.toolName === 'Bash') {
  void ctx.skip()
  void ctx.skip({ debugMessage: 'd' })
  void ctx.skip({ injectContext: 'ctx-text' })
  void ctx.skip({
    debugMessage: 'd',
    injectContext: 'ctx-text',
    updatedMCPToolOutput: { ok: true },
  })
  void ctx.block({ reason: 'x' })
}
if (ctx.toolName === 'Write') {
  void ctx.skip()
  void ctx.block({ reason: 'x' })
}

// (d) PostToolUseFailure: Bash arm — typed input + `error: string` prefix;
//     `block` is NOT a method on PostToolUseFailureDecisionMethods (only `skip`
//     is declared); `originalToolInput` is NOT present (Plan D regression gate).
if (failCtx.toolName === 'Bash') {
  const _cmd: string = failCtx.toolInput.command
  const _err: string = failCtx.error
  void _cmd
  void _err
  // @ts-expect-error — filePath does not exist on BashToolInput
  const _bad: string = failCtx.toolInput.filePath
  void _bad

  // @ts-expect-error — block is not a method on PostToolUseFailureContext
  void failCtx.block({ reason: 'x' })

  // @ts-expect-error — originalToolInput is not on PostToolUseFailureContext
  void failCtx.originalToolInput
}

// (e) PostToolUseFailure: Write arm — foreign Bash field rejected.
if (failCtx.toolName === 'Write') {
  const _path: string = failCtx.toolInput.filePath
  void _path
  // @ts-expect-error — command does not exist on WriteToolInput
  const _bad: string = failCtx.toolInput.command
  void _bad
}

// (f) PostToolUseFailure: skip method available post-narrowing.
if (failCtx.toolName === 'Bash') {
  void failCtx.skip()
  void failCtx.skip({ debugMessage: 'd', injectContext: 'i' })
}

// (g) UnknownPostToolUseContext: shape assertions + methods present.
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

// (h) UnknownPostToolUseFailureContext: shape assertions + method present;
//     `block` is NOT a method (mirror of (d) — only `skip` is declared on
//     PostToolUseFailureDecisionMethods).
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

  // @ts-expect-error — block is not a method on UnknownPostToolUseFailureContext
  void unknownFailCtx.block({ reason: 'x' })
}
