export const hook = {
  meta: { name: "continue-teammate" },
  TeammateIdle() {
    return { result: "continue" as const, feedback: "keep going" }
  },
}
