export const hook = {
  meta: { name: "worktree-success" },
  WorktreeCreate() {
    return { result: "success" as const, path: "/tmp/worktree-123" }
  },
}
