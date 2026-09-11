# Releasing Clooks

Clooks releases are cut by pushing a git tag of the form `vMAJOR.MINOR.PATCH`. A GitHub Actions workflow (`.github/workflows/release.yml`) handles the rest: cross-compiling binaries for 5 platforms, signing + notarizing the darwin binaries with an Apple Developer ID, smoke-testing the darwin-arm64 binary on a macOS runner, generating SHA-256 checksums, and publishing a draft release on GitHub.

## Cutting a release

1. Ensure you are on `master` with a clean working tree:

       git checkout master && git pull && git status

2. Bump the version in both source files to the new release number. Both must match the tag exactly (without the leading `v`).

   - `package.json` — the `"version"` field
   - `src/version.ts` — the `VERSION` constant

   Regenerate the website version indicator from `src/version.ts` and include it
   in the release changes; never edit the generated file manually:

       bun run scripts/sync-page-version.ts

   Confirm `package.json`, `src/version.ts`, and `page/version.js` agree. Refresh
   README and website capability/setup copy against the shipped source. The tag
   workflow checks the two source versions, not website or marketplace parity.

   Coordinate the sibling `clooks-marketplace` repository separately. Update each
   changed pack's `.claude-plugin/plugin.json` version and the matching entry in
   `.claude-plugin/marketplace.json` together, including the `clooks` bootstrap
   plugin when included in the release. Each listing must match its plugin manifest.

   For the dual-agent onboarding package, also check
   `clooks/.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`.
   Coordinate Claude and Codex package versions with the runtime release wherever
   versions are declared; do not invent version fields in catalogs without them.
   Validate the actual cached package, explicit setup, native hook trust and
   runtime dispatch separately: catalog/add/list success alone is insufficient.
   Document verified CLI versions as tested versions, not unproven minimums.

   Keep every `clooks-pack.json` numeric `version: 1` unchanged: it identifies the
   manifest schema, not the plugin release. Do not rewrite historical fixtures or
   vendored provenance to imply a published release. Marketplace changes are not
   published by the Clooks tag workflow; release them separately after validation
   and runtime availability. Publish runtime assets before onboarding metadata
   offers them. A plugin version bump must not implicitly install or update a
   user's runtime; install/update/check remain explicit setup actions.
   Existing installed hook copies need an explicit
   refresh; see README's vendoring and updates section.

3. Commit the bump:

       git add package.json src/version.ts page/ README.md RELEASING.md
       git commit -m "chore(release): bump to vX.Y.Z"
       git push origin master

4. Tag and push:

       git tag vX.Y.Z
       git push origin vX.Y.Z

5. Watch the workflow run (`gh run watch` or via the Actions tab). Expect roughly 3–5 minutes to completion (notarization usually accounts for 1–2 minutes of that). All three jobs (`build`, `sign-and-smoke-darwin`, `publish`) must go green.

6. A draft release appears on the Releases page with 6 assets:

   - `clooks-darwin-arm64`
   - `clooks-darwin-x64`
   - `clooks-linux-x64`
   - `clooks-linux-x64-baseline`
   - `clooks-linux-arm64`
   - `checksums.txt`

7. Download one binary for your platform and smoke-test:

       gh release download vX.Y.Z -p 'clooks-linux-x64'
       chmod +x clooks-linux-x64
       ./clooks-linux-x64 --version
       # Expected: clooks X.Y.Z (matching the tag)

8. If everything looks right, publish the draft via the GitHub UI (Edit → Publish release) or:

       gh release edit vX.Y.Z --draft=false

## Pre-releases

Tag with a hyphen suffix (for example `v0.2.0-rc.1`). The workflow auto-flags these as pre-release on GitHub.

## If something goes wrong

- **Workflow failed partway through:** re-run from the Actions tab. The action replaces existing assets in the draft release safely.
- **Wrong version number:** delete the tag (`git push origin :refs/tags/vX.Y.Z`) and the draft release (`gh release delete vX.Y.Z`), fix the bump commit, tag again. You can reuse the version number because the draft was not published.
- **Already-published release has a bug:** publish a new patch release (`v0.1.2`). Do not retroactively edit a published release — users may already have downloaded it.

## Apple Developer ID signing

Darwin binaries are signed + notarized on tag pushes. The `sign-and-smoke-darwin` job requires six repo secrets: `APPLE_DEVELOPER_ID_P12_BASE64`, `APPLE_DEVELOPER_ID_P12_PASSWORD`, `APPLE_DEVELOPER_ID_CERT_NAME`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_NOTARY_PASSWORD`. `workflow_dispatch` runs skip signing.

## Scope of this workflow

Intentionally minimal. This release workflow does NOT provide:

- SLSA / build provenance attestations
- `.tar.gz` archives
- Homebrew tap / Scoop / `curl | sh` installer (planned)
- E2E tests as a release gate (the workflow only runs unit tests + lint + typecheck)

Each of these will be added when there is a concrete reason (user report, distribution push, security requirement).
