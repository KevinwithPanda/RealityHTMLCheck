# Maintainer release procedure

RealityCheck release publication is deliberately manual. A normal workflow dispatch is verification-only and cannot create a GitHub Release or publish to npm.

## Verify the current ref

Open **Actions → Verify or publish release → Run workflow**, select the branch you want to inspect, keep `mode` set to `verify`, and leave both `release-tag` and `confirmation` empty.

The workflow checks out the selected workflow-dispatch ref, runs the complete tests and isolated package smoke test, creates a tarball plus `SHA256SUMS`, and uploads them only as a 14-day workflow artifact. The publication jobs are skipped.

## Prepare a version tag

Before selecting a publishing mode:

1. Make sure `package.json`, `package-lock.json`, `VERSION`, the changelog, and user-facing pinned examples agree on the version.
2. Run the normal validation workflow and confirm the release commit is on `origin/main`.
3. Create and push an exact `vX.Y.Z` tag. Do not reuse or move a published version tag.
4. Wait for the validation workflow on that tag to pass.
5. Protect `v*` tags and enable GitHub immutable releases. Only after that control is active, set repository variable `RELEASE_TAGS_IMMUTABLE=true`; publishing modes refuse to run without it.

The release workflow itself is started from the default branch. For a publishing mode, it fetches the named remote tag, peels annotated or lightweight tags to a full commit ID, requires that commit to be reachable from `origin/main`, and checks out the detached commit before installing dependencies, testing, or packing. It then requires all of the following to agree:

- the `release-tag` input;
- `v` plus the version in the checked-out `package.json`;
- the peeled tag commit and checked-out `HEAD`;
- the exact typed confirmation `realityhtmlcheck@X.Y.Z`.

The GitHub Release and npm jobs re-read the remote tag before doing anything and refuse a tag that changed after verification. Each mutation step checks it again immediately before `gh release create` or `npm publish`. Protected immutable tags close the residual move-tag race that a workflow check alone cannot make atomic. Both jobs download the tarball produced by the same `verify` job; neither rebuilds it.

## Create the GitHub Release first

Run the workflow from the default branch with:

- `mode`: `github-release`
- `release-tag`: the existing exact tag, for example `v0.13.0`
- `confirmation`: the exact package identity, for example `realityhtmlcheck@0.13.0`

The separately permissioned `github-release` job verifies `SHA256SUMS` and creates the Release from the existing tag with the exact tested `.tgz`, checksum, and package-contents manifest. It has `contents: write`; the verification job remains `contents: read`.

Configure the GitHub `release` environment and its desired reviewer protection before using this mode. Publishing the Action in GitHub Marketplace remains an authenticated maintainer action in the GitHub UI and is not performed by this workflow.

## Bootstrap npm once

The first npm publication cannot be completed anonymously. An unscoped package must first be created by an npm account using npm's current account security and two-factor authentication requirements. A trusted publisher is configured from an existing package's npm settings, so the package must exist before this repository's OIDC-only `npm-publish` job can be used.

For the one-time bootstrap:

1. Sign in to the intended npm maintainer account and enable 2FA.
2. Confirm the unscoped name is actually available; an unauthenticated registry 404 is not a reservation.
3. Download the exact `.tgz` and `SHA256SUMS` from the published GitHub Release and verify the checksum before the authenticated initial publish.
4. Never commit an npm token or paste one into a workflow input.

After the package exists, configure its npm **Trusted Publisher** as:

- provider: GitHub Actions
- organization or user: `KevinwithPanda`
- repository: `RealityHTMLCheck`
- workflow filename: `release.yml`
- environment: `npm`
- allowed action: `npm publish`

Also create and protect the GitHub `npm` environment. The repository field in `package.json` must continue to identify this exact public GitHub repository.

Trusted publishing requires a GitHub-hosted runner, `id-token: write`, Node 22.14.0 or newer, and npm 11.5.1 or newer. The workflow uses Node 24, checks the npm version, requests OIDC only in the npm job, and does not use `NPM_TOKEN` or `NODE_AUTH_TOKEN`.

Official references:

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [Creating an unscoped public package](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)
- [GitHub manual workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

## Publish later versions with npm OIDC

Only after the GitHub Release exists and npm trusted publishing is configured, run the default-branch workflow with:

- `mode`: `npm-publish`
- `release-tag`: the same existing exact tag
- `confirmation`: the same exact `realityhtmlcheck@X.Y.Z` identity

The npm job verifies the downloaded candidate, requires a byte-identical tarball in the existing GitHub Release, and then publishes that tarball with OIDC provenance. npm package versions are immutable; never rerun publication for a version already present in the registry.
