import { describe, expect, test } from "bun:test"
import { isCompoundCommand, hook } from "./no-compound-commands.js"
import type { PreToolUseContext } from "../../src/types/contexts.js"

// --- isCompoundCommand (pure function) ---

describe("isCompoundCommand", () => {
  // Should allow
  test.each([
    ["simple command", "ls -la"],
    ["git status", "git status"],
    ["piped command", "ps aux | grep node"],
    ["multi-pipe", "cat file | sort | uniq"],
    ["redirect", "echo foo > file.txt"],
    ["subshell", "echo $(date)"],
    ["ALLOW_COMPOUND=true with &&", "ALLOW_COMPOUND=true cd /tmp && ls"],
    ["ALLOW_COMPOUND=true with ;", "ALLOW_COMPOUND=true echo a; echo b"],
    ["ALLOW_COMPOUND=true with ||", "ALLOW_COMPOUND=true cmd1 || cmd2"],
    ["&& inside single quotes", "echo 'foo && bar'"],
    ["&& inside double quotes", 'echo "foo && bar"'],
    ["; inside single quotes", "echo 'a; b'"],
    ["; inside double quotes", 'echo "a; b"'],
    ["|| inside double quotes", 'echo "a || b"'],
    ["&& in comment only", "echo hello # && this is a comment"],
    [";; case terminator", "case $x in foo) echo hi;; esac"],
    ["background process", "sleep 10 &"],
    ["flags", "npm install --save-dev typescript"],
    ["heredoc", "cat <<EOF\nhello world\nEOF"],
  ])("allows: %s", (_label, command) => {
    expect(isCompoundCommand(command)).toBe(false)
  })

  // Should block
  test.each([
    ["&& chained", "cd /tmp && ls"],
    ["&& mkdir", "mkdir -p foo && cd foo"],
    ["|| fallback", "make || echo failed"],
    ["; sequential", "echo a; echo b"],
    ["; cd", "cd /tmp; ls"],
    ["mixed operators", "cmd1 && cmd2 || cmd3"],
    ["triple &&", "a && b && c"],
    ["&& with pipe", "ls | grep foo && echo done"],
    ["; at end", "echo hello;"],
    ["&& outside quotes with && inside", 'echo "a && b" && echo c'],
  ])("blocks: %s", (_label, command) => {
    expect(isCompoundCommand(command)).toBe(true)
  })
})

// --- hook.PreToolUse handler ---

function makeCtx(toolName: string, command: string): PreToolUseContext {
  return {
    event: "PreToolUse",
    toolName,
    toolInput: { command },
    toolUseId: "tu-test",
    sessionId: "test-session",
    cwd: "/tmp",
    permissionMode: "default",
    transcriptPath: "/tmp/transcript.jsonl",
  }
}

describe("hook.PreToolUse", () => {
  test("skips non-Bash tools", () => {
    const result = hook.PreToolUse!(makeCtx("Read", "anything"), {})
    expect(result).toEqual({ result: "skip" })
  })

  test("skips empty command", () => {
    const result = hook.PreToolUse!(makeCtx("Bash", ""), {})
    expect(result).toEqual({ result: "skip" })
  })

  test("allows simple command", () => {
    const result = hook.PreToolUse!(makeCtx("Bash", "ls -la"), {}) as unknown as Record<string, unknown>
    expect(result.result).toBe("allow")
    expect(result.debugMessage).toBe('no-compound-commands: allowed "ls -la"')
  })

  test("blocks compound command", () => {
    const result = hook.PreToolUse!(makeCtx("Bash", "cd /tmp && ls"), {}) as unknown as Record<string, unknown>
    expect(result.result).toBe("block")
    expect(result.reason).toContain("Compound command detected")
    expect(result.debugMessage).toBe('no-compound-commands: blocked "cd /tmp && ls"')
  })

  test("allows ALLOW_COMPOUND=true escape hatch", () => {
    const result = hook.PreToolUse!(makeCtx("Bash", "ALLOW_COMPOUND=true cd /tmp && ls"), {}) as unknown as Record<string, unknown>
    expect(result.result).toBe("allow")
    expect(result.debugMessage).toContain("ALLOW_COMPOUND=true")
  })
})
