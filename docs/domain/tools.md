# Tools

How this project manages development tools and the gotchas encountered along the way.

## Overview

Clooks uses [mise](https://mise.jdx.dev/) for tool version management. All project tools are declared in `mise.toml` at the repository root. This ensures consistent versions across contributors and CI environments.

## Key Files

- `mise.toml` — tool declarations (bun, shellcheck, etc.)

## Patterns

- Declare every tool the project depends on in `mise.toml` so that `mise install` sets up the full environment.
- Use pinned versions (e.g., `shellcheck = "0.11.0"`) for linters and validators. Use `"latest"` only for primary runtimes like Bun where staying current is intentional.

## Gotchas

### `mise install` vs `mise use` — tools not on PATH after install

`mise install <tool>` downloads and installs the tool but does **not** activate it for the current project. The tool will not appear on `$PATH` until it is registered in `mise.toml`.

To both install and activate a tool, use:

```bash
mise use <tool>@<version>
```

This writes the entry to `mise.toml` and makes the tool available immediately. If `mise.toml` already has the entry, `mise install` is sufficient — the issue only arises when adding a new tool for the first time.

**Symptoms:** `command not found` after `mise install` succeeds. The install output shows success but the binary is only placed in mise's internal install directory, not linked into the project's PATH.

### Sourcing mise in new shells

Mise activates tools via shell integration. If you open a new shell (or a tool spawns a subprocess), mise's PATH modifications may not be present. Ensure `mise activate` (or equivalent) runs in your shell profile. In CI, use `mise exec --` to run commands within the mise environment.

## Related

- `docs/domain/bun-runtime.md` — Bun-specific details (compile targets, performance, binary sizes)
