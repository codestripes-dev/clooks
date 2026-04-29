// Type-narrowing regression checks for lifecycle wrapper opts (BeforeHookEvent).
//
// The `@ts-expect-error` directives below MUST fire — if they don't, the type
// system has weakened and the per-event narrowing of `LifecycleBlockOptsMap` /
// `LifecycleSkipOptsMap` on `BeforeHookEventVariants` has regressed.
//
// Run via `bun run typecheck` (the project tsconfig.json includes `test/`).
//
// ## Lifecycle-vs-ctx split
//
// BeforeHookEvent.block / .skip now use LifecycleBlockOptsMap /
// LifecycleSkipOptsMap — narrower than the ctx-side EventBlockOptsMap /
// EventSkipOptsMap. The key difference: mutation primitives (UpdatedMcpToolOutput,
// SessionTitle) are stripped from the lifecycle surface. Mutations belong on
// per-event handlers (ctx.block / ctx.skip), not on the lifecycle meta-gate.
// Stanzas (h), (j), (o), (p) were previously accept-stanzas; after the split
// they flip to @ts-expect-error. Stanza (r) is split into (r) + (s).
//
// Note on stanza letters: this file's stanza namespace is local. The ctx-side
// regression file (`decision-method-narrowing.types.ts`) reuses some of the
// same letters (k–p) for its own purposes — the two namespaces are
// independent. Don't cross-reference letters between the files.
//
// Stanzas:
//   (a) Stop is non-injectable; injectContext on event.block is a TS error.
//   (b) Stop is non-injectable; injectContext on event.skip is a TS error.
//   (c) PreToolUse IS injectable; event.block({ injectContext }) compiles.
//   (d) PreToolUse lifecycle.skip rejects injectContext — translator silently drops
//       on PreToolUse.skip; @ts-expect-error (ctx-side also dropped; see (l) in
//       decision-method-narrowing.types.ts).
//   (e) Stop does not allow interrupt; passing it on event.block is a TS error.
//   (f) PermissionRequest allows interrupt; event.block({ interrupt }) compiles.
//   (g) Stop does not allow updatedMCPToolOutput; passing it on event.block is a TS error.
//   (h) PostToolUse does NOT allow updatedMCPToolOutput on lifecycle.block —
//       mutation primitive; @ts-expect-error (use ctx.block on the handler side).
//   (i) Stop does not allow sessionTitle; passing it on event.block is a TS error.
//   (j) UserPromptSubmit does NOT allow sessionTitle on lifecycle.block —
//       mutation primitive; @ts-expect-error (use ctx.block on the handler side).
//   (k) SessionStart skip accepts injectContext (injectable-event coverage).
//   (l) PostToolUseFailure skip accepts injectContext (injectable-event coverage).
//   (m) Notification skip accepts injectContext (injectable-event coverage).
//   (n) SubagentStart skip accepts injectContext (injectable-event coverage).
//   (o) PostToolUse skip does NOT accept updatedMCPToolOutput on lifecycle —
//       mutation primitive; @ts-expect-error.
//   (p) UserPromptSubmit skip does NOT accept sessionTitle on lifecycle —
//       mutation primitive; @ts-expect-error.
//   (q) Stop block({}) is a TS error — `reason` is a required field.
//   (r) UserPromptSubmit lifecycle.block accepts { reason, injectContext } —
//       proves Reason & DebugMessage & InjectContext intersection on the lifecycle side.
//   (s) UserPromptSubmit lifecycle.block({ reason, injectContext, sessionTitle })
//       is a @ts-expect-error — sessionTitle rejected even when paired with valid fields.

import type { BeforeHookEvent } from '../../src/types/lifecycle.js'

declare const evt: BeforeHookEvent

// ── injectContext ─────────────────────────────────────────────────────────────

// (a) Stop is non-injectable. LifecycleBlockOptsMap['Stop'] is `Reason & DebugMessage`
//     only — injectContext is not present.
if (evt.type === 'Stop') {
  // @ts-expect-error — injectContext not in LifecycleBlockOptsMap['Stop']
  evt.block({ reason: 'no', injectContext: 'note' })
}

// (b) Stop is non-injectable. LifecycleSkipOptsMap['Stop'] is `DebugMessage` only.
if (evt.type === 'Stop') {
  // @ts-expect-error — injectContext not in LifecycleSkipOptsMap['Stop']
  evt.skip({ injectContext: 'note' })
}

// (c) PreToolUse IS injectable. LifecycleBlockOptsMap['PreToolUse'] includes InjectContext.
if (evt.type === 'PreToolUse') {
  const _r = evt.block({ reason: 'no', injectContext: 'note' })
  void _r
}

// (d) PreToolUse lifecycle.skip does NOT accept injectContext — the translator
//     silently drops injectContext on PreToolUse.skip (src/engine/translate.ts:50-51).
//     LifecycleSkipOptsMap['PreToolUse'] is DebugMessage only.
//     Note: the ctx-side EventSkipOptsMap also drops InjectContext for the same reason
//     (see decision-method-narrowing.types.ts stanza (l)).
if (evt.type === 'PreToolUse') {
  // @ts-expect-error — injectContext silently dropped by translator on PreToolUse.skip; not in LifecycleSkipOptsMap['PreToolUse']
  evt.skip({ injectContext: 'note' })
}

// ── interrupt ─────────────────────────────────────────────────────────────────

// (e) Stop does not allow interrupt. LifecycleBlockOptsMap['Stop'] has no Interrupt.
if (evt.type === 'Stop') {
  // @ts-expect-error — interrupt not in LifecycleBlockOptsMap['Stop']
  evt.block({ reason: 'no', interrupt: true })
}

// (f) PermissionRequest allows interrupt. LifecycleBlockOptsMap['PermissionRequest']
//     includes Interrupt — control-flow modifier kept; not a content mutation.
if (evt.type === 'PermissionRequest') {
  const _r = evt.block({ reason: 'no', interrupt: true })
  void _r
}

// ── updatedMCPToolOutput ──────────────────────────────────────────────────────

// (g) Stop does not allow updatedMCPToolOutput. Not present in
//     LifecycleBlockOptsMap['Stop'].
if (evt.type === 'Stop') {
  // @ts-expect-error — updatedMCPToolOutput not in LifecycleBlockOptsMap['Stop']
  evt.block({ reason: 'no', updatedMCPToolOutput: { foo: 'bar' } })
}

// (h) PostToolUse does NOT allow updatedMCPToolOutput on the lifecycle surface.
//     LifecycleBlockOptsMap['PostToolUse'] is Reason & DebugMessage & InjectContext —
//     updatedMCPToolOutput is a mutation primitive; use ctx.block on the handler side.
if (evt.type === 'PostToolUse') {
  // @ts-expect-error — updatedMCPToolOutput is a mutation; not in LifecycleBlockOptsMap['PostToolUse']
  evt.block({ reason: 'no', updatedMCPToolOutput: { foo: 'bar' } })
}

// (h-bis) PostToolUse lifecycle.block still accepts { reason, injectContext } —
//     proves InjectContext was preserved on the lifecycle map after mutation-primitive
//     stripping. Without this, a typo dropping `& InjectContext` from
//     LifecycleBlockOptsMap['PostToolUse'] would go undetected.
if (evt.type === 'PostToolUse') {
  const _r = evt.block({ reason: 'x', injectContext: 'y' })
  void _r
}

// ── sessionTitle ──────────────────────────────────────────────────────────────

// (i) Stop does not allow sessionTitle. Not present in LifecycleBlockOptsMap['Stop'].
if (evt.type === 'Stop') {
  // @ts-expect-error — sessionTitle not in LifecycleBlockOptsMap['Stop']
  evt.block({ reason: 'no', sessionTitle: 'My Session' })
}

// (j) UserPromptSubmit does NOT allow sessionTitle on the lifecycle surface.
//     LifecycleBlockOptsMap['UserPromptSubmit'] is Reason & DebugMessage & InjectContext —
//     sessionTitle is a mutation primitive; use ctx.block on the handler side.
if (evt.type === 'UserPromptSubmit') {
  // @ts-expect-error — sessionTitle is a mutation; not in LifecycleBlockOptsMap['UserPromptSubmit']
  evt.block({ reason: 'no', sessionTitle: 'My Session' })
}

// ── Injectable-event coverage (k–n) ───────────────────────────────────────────
// INJECTABLE_EVENTS in src/config/constants.ts: PreToolUse, UserPromptSubmit,
// SessionStart, PostToolUse, PostToolUseFailure, Notification, SubagentStart.
// (c) covers PreToolUse block; PreToolUse skip is @ts-expect-error (see (d)).
// PostToolUse block is @ts-expect-error (see (h) — mutation stripped from lifecycle).
// UserPromptSubmit injectability is covered in (r). The four below close the
// remaining gaps on skip so a typo dropping `& InjectContext` from any lifecycle
// map entry trips. (PreToolUse and PostToolUse are excluded here — their skip-side
// InjectContext behavior is tested via the @ts-expect-error stanzas above.)

// (k) SessionStart skip accepts injectContext.
if (evt.type === 'SessionStart') {
  const _r = evt.skip({ injectContext: 'note' })
  void _r
}

// (l) PostToolUseFailure skip accepts injectContext.
if (evt.type === 'PostToolUseFailure') {
  const _r = evt.skip({ injectContext: 'note' })
  void _r
}

// (m) Notification skip accepts injectContext.
if (evt.type === 'Notification') {
  const _r = evt.skip({ injectContext: 'note' })
  void _r
}

// (n) SubagentStart skip accepts injectContext.
if (evt.type === 'SubagentStart') {
  const _r = evt.skip({ injectContext: 'note' })
  void _r
}

// ── Skip-side asymmetric-primitive coverage (o–p) ─────────────────────────────
// (h) and (j) proved that lifecycle.block rejects mutation primitives.
// The lifecycle skip-side maps also strip them; (o) and (p) lock in the
// rejection on the skip arm as well.

// (o) PostToolUse skip does NOT accept updatedMCPToolOutput on the lifecycle surface.
//     LifecycleSkipOptsMap['PostToolUse'] is DebugMessage & InjectContext —
//     updatedMCPToolOutput is a mutation primitive; use ctx.skip on the handler side.
if (evt.type === 'PostToolUse') {
  // @ts-expect-error — updatedMCPToolOutput is a mutation; not in LifecycleSkipOptsMap['PostToolUse']
  evt.skip({ updatedMCPToolOutput: { ok: true } })
}

// (p) UserPromptSubmit skip does NOT accept sessionTitle on the lifecycle surface.
//     LifecycleSkipOptsMap['UserPromptSubmit'] is DebugMessage & InjectContext —
//     sessionTitle is a mutation primitive; use ctx.skip on the handler side.
if (evt.type === 'UserPromptSubmit') {
  // @ts-expect-error — sessionTitle is a mutation; not in LifecycleSkipOptsMap['UserPromptSubmit']
  evt.skip({ sessionTitle: 'My Title' })
}

// ── reason required gate (q) ──────────────────────────────────────────────────

// (q) Stop block({}) is a TS error — Reason (`reason: string`) is a required
//     field on every LifecycleBlockOptsMap entry. Empty-object form proves the
//     requirement directly without overlapping with optional-key checks.
if (evt.type === 'Stop') {
  // @ts-expect-error — `reason` is required on LifecycleBlockOptsMap['Stop']
  evt.block({})
}

// ── Multi-primitive combo on the lifecycle surface (r–s) ──────────────────────
// After the lifecycle-vs-ctx split, UserPromptSubmit's lifecycle.block accepts
// Reason & DebugMessage & InjectContext — but NOT SessionTitle (mutation).
// Two stanzas: (r) proves the valid intersection compiles; (s) proves sessionTitle
// is still rejected even when paired with valid primitives.

// (r) UserPromptSubmit lifecycle.block accepts { reason, injectContext } —
//     proves Reason & DebugMessage & InjectContext intersection on lifecycle side.
if (evt.type === 'UserPromptSubmit') {
  const _r = evt.block({ reason: 'x', injectContext: 'y' })
  void _r
}

// (s) UserPromptSubmit lifecycle.block({ reason, injectContext, sessionTitle })
//     is a TS error — sessionTitle is a mutation primitive stripped from the
//     lifecycle surface (LifecycleBlockOptsMap), even when paired with valid fields.
//     Use ctx.block({ sessionTitle }) on the per-event handler instead.
if (evt.type === 'UserPromptSubmit') {
  // @ts-expect-error — sessionTitle is a mutation; not in LifecycleBlockOptsMap['UserPromptSubmit']
  evt.block({ reason: 'x', injectContext: 'y', sessionTitle: 'z' })
}
