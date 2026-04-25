// Fixture migrated to ctx.<verb>(...) form per FEAT-0063 M4.
type SuccessCtx = {
  success: (opts: { path: string }) => { result: 'success'; path: string }
}

export const hook = {
  meta: { name: 'worktree-success' },
  WorktreeCreate(ctx: SuccessCtx) {
    return ctx.success({ path: '/tmp/worktree-123' })
  },
}
