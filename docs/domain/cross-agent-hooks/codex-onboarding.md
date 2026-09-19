# Cross-Agent Hooks — Codex Plugin Onboarding

The `$clooks:setup` flow, installer selection, and native onboarding evidence. Part of [Cross-Agent Hooks](../cross-agent-hooks.md); see also [Codex — Event Mapping](./codex.md) and [Codex Runtime Capabilities](./codex-capabilities.md).

## Explicit Plugin Onboarding

The sibling marketplace's existing `clooks/` package serves both agents with
separate skill trees: Claude uses `skills/setup/`, Codex uses `codex-skills/setup/`.
Both use the canonical `skills/setup/scripts/install.sh`. Codex's manifest points
to `./codex-skills/` and `./codex-hooks/hooks.json`; its catalog is
`.agents/plugins/marketplace.json` in the marketplace repository.

```bash
codex plugin marketplace add codestripes-dev/clooks-marketplace
codex plugin add clooks@clooks-marketplace
```

Users explicitly invoke `$clooks:setup` in Codex or `/clooks:setup` in Claude.
Plugin installation/startup never installs, updates or initializes the runtime.
The only plugin hook is a read-only SessionStart reminder; `clooks init` remains
the owner of runtime registrations. Codex setup defaults to project
`init --agent codex`; global or both-agent setup requires an explicit request.
Claude retains its project init flow and optional global offer.

Installer selection is executable PATH first, managed home binary second. Reuse
validates `--version` without download/profile writes; broken or mismatched
binaries fail. Explicit update cannot overwrite or shadow an external selection.
Absolute-path init does not establish agent PATH readiness or native trust. See
[installer behavior](../cli-architecture/commands-setup.md#plugin-installer) and
[pack-discovery boundaries](../vendoring/plugin-vendoring.md#onboarding-is-not-pack-discovery).

Native onboarding is tested with Codex CLI `0.154.0` across three scenarios and
nine real Codex sessions; this is a tested version, not an established minimum.
Coverage includes actual TUI hook trust, first-message reminders, ordinary versus
explicit skill inclusion, installer download/init/runtime dispatch, declined
trust, PATH reuse without downloads, and plugin removal preserving the runtime.
The network-disabled Docker tests use synthetic repository trust, a disabled
sandbox and a scripted local provider, not live-model obedience. See
[native onboarding evidence](../testing/codex-native/onboarding.md#native-plugin-onboarding).

## Related

- [Cross-Agent Hooks](../cross-agent-hooks.md) — parent overview and agent comparison
- [Cross-Agent Hooks — Codex](./codex.md) — event mapping and pinned source corrections
- [Cross-Agent Hooks — Codex Runtime Capabilities](./codex-capabilities.md)
