// Fixture migrated to ctx.<verb>(...) form per FEAT-0063 M4. TeammateIdle's
// `continue` method is `ctx.continue` (the runtime constant exported from
// `src/engine/context-methods.ts` keys it that way). The TS reserved-word
// concern is sidestepped here because the call uses bracket-property syntax
// at the type level via the structural type's named member.
type ContinueCtx = {
  continue: (opts: { feedback: string }) => { result: 'continue'; feedback: string }
}

export const hook = {
  meta: { name: 'continue-teammate' },
  TeammateIdle(ctx: ContinueCtx) {
    return ctx.continue({ feedback: 'keep going' })
  },
}
