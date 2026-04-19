# Releasing Clooks

Clooks releases are cut by pushing a git tag of the form `vMAJOR.MINOR.PATCH`. A GitHub Actions workflow (`.github/workflows/release.yml`) handles the rest: cross-compiling binaries for 5 platforms, smoke-testing the darwin-arm64 binary on a macOS runner, generating SHA-256 checksums, and publishing a draft release on GitHub.

## Cutting a release

1. Ensure you are on `master` with a clean working tree:

       git checkout master && git pull && git status

2. Bump the version in both files to the new release number. Both must match the tag exactly (without the leading `v`).

   - `package.json` — the `"version"` field
   - `src/version.ts` — the `VERSION` constant

3. Commit the bump:

       git commit -am "chore(release): bump to vX.Y.Z"
       git push origin master

4. Tag and push:

       git tag vX.Y.Z
       git push origin vX.Y.Z

5. Watch the workflow run (`gh run watch` or via the Actions tab). Expect roughly 2 minutes to completion. All three jobs (`build`, `smoke-darwin`, `publish`) must go green.

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

## Scope of this workflow

Intentionally minimal. This release workflow does NOT provide:

- SLSA / build provenance attestations
- Mac codesigning or notarization (Gatekeeper may quarantine binaries; document `xattr -d com.apple.quarantine clooks-darwin-*` for users if they report issues)
- `.tar.gz` archives
- Homebrew tap / Scoop / `curl | sh` installer (planned as FEAT-0028 follow-up work)
- E2E tests as a release gate (the workflow only runs unit tests + lint + typecheck)

Each of these will be added when there is a concrete reason (user report, distribution push, security requirement).
