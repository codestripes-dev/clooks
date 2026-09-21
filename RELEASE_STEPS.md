# Release Steps

Run commands from the Clooks checkout unless noted otherwise. Have the sibling
`../clooks-marketplace` checkout available. This playbook prepares a release;
it does not authorize publishing, replacing an existing release, or installing over
the developer's local binary.

## 1. Prepare Versions

Edit `src/version.ts` to the intended release version. For local-only preparation:

```bash
bun run release:sync
bun run release:check
```

For a coordinated plugin release, extend the same operation to the explicit sibling:

```bash
bun run release:sync --marketplace ../clooks-marketplace
bun run release:check --marketplace ../clooks-marketplace
```

`src/version.ts` is the release-identity source of truth. Sync updates:

| Repository | Derived files |
| --- | --- |
| Clooks | `package.json`, `page/version.js` |
| Marketplace | `clooks/.claude-plugin/plugin.json`, `clooks/.codex-plugin/plugin.json`, the `clooks` entry in `.claude-plugin/marketplace.json` |

Deliberately review `MIN_RUNTIME_VERSION` and `LAUNCHER_REVISION` in
`src/installation-metadata.ts` before release. The minimum is a maintained compatibility
floor: it must be canonical full SemVer no newer than `VERSION`, and release sync validates
but never derives or changes it. Raise it only when the generated integration actually
requires a newer runtime. `LAUNCHER_REVISION` covers the coupled generated launcher and
runtime-advisory behavior; change it for that compatibility contract, not for each release
or as a registration stamp. Registration ownership and presence are inspected separately.

The website displays the generated `page/version.js` value, not a live GitHub version.
Download links and the explicit installer can resolve the latest public release.

Hook packs have independent versions. When releasing changed packs, update their
Claude/Codex manifests and their Claude marketplace listing together; sync deliberately
does not bump them. The Codex marketplace catalog has no version field.

## 2. Validate and Review Both Repositories

```bash
bun run typecheck
bun run lint:all
bun run test:validation
bun test ../clooks-marketplace/clooks/hooks/
bun test ../clooks-marketplace/clooks-core-hooks/hooks/ ../clooks-marketplace/clooks-project-hooks/hooks/ ../clooks-marketplace/clooks-example-hooks/hooks/
bash ../clooks-marketplace/clooks/skills/setup/scripts/install.test.sh
bun run test:page
bun run typecheck:page
bun run build:page
git diff --check
git -C ../clooks-marketplace diff --check
```

Docker must be running for `test:validation`. It includes tooling tests, runtime
coverage and compiled-binary E2E tests. For changes to registration, approvals or
plugin onboarding, also run the relevant native smoke suites with the explicit
agent distributions described in [testing](docs/domain/testing.md),
[approval testing](docs/domain/testing/interactive-approvals.md) and
[Codex coverage](docs/domain/testing/codex-e2e-coverage.md).

Review README, website, setup skills and changed hook documentation for the actual
release behavior. Avoid adding version numbers to prose when a command or link suffices.
Review and commit both repositories separately. Keep internal ignored plans ignored.
Publish and verify the runtime before publishing a marketplace plugin that depends on it.
Do not use a plugin release to imply that an unavailable runtime is installable.
If the website auto-deploys the branch you will push, stage or pause its production
deployment so it does not advertise the new version before the binary is public.

## 3. Build the Release Candidate

Push the reviewed Clooks commit. Confirm the exact release commit and that the
cross-repository `release:check` passes before tagging it. For a new version:

```bash
VERSION=$(bun -e 'import { VERSION } from "./src/version.ts"; console.log(VERSION)')
git tag -a "v$VERSION" -m "Clooks $VERSION" <reviewed-release-commit>
git push origin "v$VERSION"
gh run list --workflow release.yml
gh run watch <release-run-id> --exit-status
```

Replace the angle-bracket placeholders with the reviewed commit and corresponding
run ID. Do not move an existing tag as part of a normal release.

The tag workflow validates tag/source/package versions, runs Docker validation,
builds five binaries, signs and notarizes both macOS binaries, regenerates checksums
after signing, and creates a **draft** GitHub release. Review all jobs, not just build.
`workflow_dispatch` produces unsigned test artifacts; it does not publish a release.

## 4. Verify and Publish

```bash
gh release view "v$VERSION"
gh release download "v$VERSION" --dir "tmp/release-$VERSION"
```

In the downloaded directory, verify `checksums.txt` using `sha256sum --check
checksums.txt` on Linux or `shasum -a 256 -c checksums.txt` on macOS. Expect these assets:

- `clooks-darwin-arm64`
- `clooks-darwin-x64`
- `clooks-linux-x64`
- `clooks-linux-x64-baseline`
- `clooks-linux-arm64`
- `checksums.txt`

Make the selected download executable with `chmod +x <asset>`. Run that binary
with `--version`, then smoke-test
initialization and hook execution in a disposable HOME, CODEX_HOME and project.
Do not use `deploy:local` or your real agent configuration for release verification.
Confirm the macOS signing/notarization jobs succeeded and check the draft release notes.

After approval to publish a stable release:

```bash
gh release edit "v$VERSION" --draft=false --latest
```

For a prerelease, retain the prerelease flag and use `--latest=false` instead.
Keep its matching plugin changes off the stable marketplace branch: setup defaults
to the latest stable binary, not a prerelease. Test from a prerelease plugin checkout
and pin the installer with `CLOOKS_VERSION="$VERSION"`.

Verify the public stable release and asset downloads. Only then push a dependent reviewed
marketplace commit and confirm both agents can load the updated setup plugin. Existing plugin
caches do not automatically change just because source was pushed; refresh them
through the agent's plugin update mechanism when dogfooding.

## 5. Verify the Website

Deploy the reviewed website build through the configured hosting pipeline. This
repository has no website-deploy GitHub workflow; check the hosting project's branch
and build settings rather than assuming the release job deploys it. A branch push
may trigger hosting independently of the tag workflow.

Check `https://clooks.cc`: displayed version, both agent setup commands, and download
links must match the now-public release. `bun run build:page` generates the version
asset locally but does not itself publish the site.

## Replacing an Existing Release

Only do this with explicit approval. Record the old and new commit IDs and coordinate
tag, signed assets, checksums and release notes as one replacement. Do not mix old
assets with new checksums or use unsigned dispatch artifacts as release assets.

Same-version replacements cannot be detected by a version comparison: an older
binary reporting the same version will still pass the startup check. Tell affected
users to explicitly update, and refresh plugin caches when plugin files changed.
Use a new version for subsequent fixes unless there is a deliberate exception.
