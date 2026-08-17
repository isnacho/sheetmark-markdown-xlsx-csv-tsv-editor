---
name: publish-vscode-marketplace
description: Publish and verify Sheetmark updates on the Visual Studio Marketplace and Open VSX. Use when asked to release, publish, push an update, check a marketplace version, or troubleshoot the GitHub Actions publishing workflow for iggyinc.sheetmark.
---

# Publish Sheetmark to VS Code Marketplace and Open VSX

Publish the extension ID `iggyinc.sheetmark` from
`nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor`.

## Standard release flow

When this skill is invoked to publish or release, own the complete release flow:
prepare the version and changelog, validate it, commit and push it, publish the
same VSIX to both registries, then verify it. Do not make the user separately
ask for routine steps.

### 1. Inspect the release state

Inspect the working tree, branch, local version, published version, and commits
since the last release:

```bash
git fetch origin main --tags
git status --short --branch
git branch --show-current
node -p "require('./package.json').version"
git log --oneline
npx --yes @vscode/vsce@latest show iggyinc.sheetmark
curl --fail-with-body --location https://open-vsx.org/api/iggyinc/sheetmark/latest
```

Either registry can reject a version that is already published. Never publish
uncommitted work, and publish only from pushed `main`.

### 2. Confirm release metadata when preparation is needed

If the local version is not newer than the Marketplace version, or the
changelog still has an `Unreleased` section, derive a recommended SemVer bump
from the changes (patch for fixes, minor for user-facing features, major only
for breaking changes). Draft the release notes from the commits and propose the
current date (`YYYY-MM-DD`) as the changelog release date.

Before editing release metadata, ask the user to confirm all of the following:

- exact version;
- changelog release date;
- release-note summary and scope.

Once confirmed, update `package.json` and move the relevant `Unreleased`
entries under `## v<version> — <date>` in `CHANGELOG.md`. Update the lockfile
only when its root package metadata intentionally mirrors `package.json`; do
not make unrelated dependency-lock changes.

### 3. Validate the release and VSIX locally

Run the repository validation, review the release diff, and package the exact
VSIX locally before pushing anything:

```bash
git diff --check
npm run compile
git diff -- package.json CHANGELOG.md
RELEASE_VSIX_DIR="$(mktemp -d)"
npx --yes @vscode/vsce@latest package --no-dependencies \
  --out "$RELEASE_VSIX_DIR/sheetmark.vsix"
npx --yes @vscode/vsce@latest ls --tree
```

Do not push if packaging fails, secret scanning reports a file, or the VSIX
listing includes development-only directories such as `.agents`, `.codex`,
`.claude`, `.github`, `.docs`, `src`, or `samples`. Fix `.vscodeignore` and
repeat the preflight first.

### 4. Commit, push, and tag the exact release source

Commit the release metadata, push it to `main`, then create an annotated tag at
that same commit. The tag is the permanent record of exactly what shipped:

```bash
git add package.json CHANGELOG.md .vscodeignore
git commit -m "chore: release v<version>"
git push origin main
RELEASE_TAG="v<version>"
git tag -a "$RELEASE_TAG" -m "Release $RELEASE_TAG"
git push origin "$RELEASE_TAG"
RELEASE_SHA="$(git rev-parse "$RELEASE_TAG^{}")"
test "$RELEASE_SHA" = "$(git rev-parse origin/main)"
git status --short --branch
```

Confirm the tag resolves to the same SHA as `origin/main`. If a release tag
already exists, never move or recreate it; stop and ask the user how to
proceed.

### 5. Publish the tag and watch its exact run

Require the GitHub Actions secret `VSCE_PAT` (an Azure DevOps PAT with
`Marketplace > Manage` scope) and the Open VSX token `OVSX_PAT`; never request
or expose either value. `OVSX_PAT` requires the `iggyinc` Open VSX namespace to
have been created first. Use `.github/workflows/publish-marketplace.yml`, which
packages one VSIX, attaches it to the GitHub Release, and publishes that exact
file to both registries.

Publishing is a public release action. If the user has not explicitly asked to
publish in this invocation, ask immediately before triggering it. An explicit
request such as “publish,” “release,” or “trigger it now” is approval; do not
ask a redundant second time.

```bash
gh workflow run "Publish to VS Code Marketplace" \
  --repo nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor \
  --ref "v<version>" \
  -f release_tag="v<version>"
gh run list \
  --repo nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor \
  --workflow "Publish to VS Code Marketplace" \
  --event workflow_dispatch --commit "$RELEASE_SHA" --limit 1
gh run watch <run-id> \
  --repo nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor --exit-status
```

The dispatch response may supply a run URL; otherwise poll the exact
`workflow_dispatch` + `$RELEASE_SHA` query above until the run appears. Never
select a run only because it is the most recent one. Verify its `headSha`
matches `$RELEASE_SHA` before watching it.

Treat the version as published only after the run succeeds, its **Publish to VS
Code Marketplace** and **Publish to Open VSX** jobs both succeed, and the GitHub
Release contains the versioned `.vsix` asset. Then verify with:

```bash
npx --yes @vscode/vsce@latest show iggyinc.sheetmark
curl --fail-with-body --location https://open-vsx.org/api/iggyinc/sheetmark/latest
gh release view "v<version>" \
  --repo nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor \
  --json assets
```

Give the user both listings:

- `https://marketplace.visualstudio.com/items?itemName=iggyinc.sheetmark`
- `https://open-vsx.org/extension/iggyinc/sheetmark`

## Troubleshooting

- **Workflow cannot authenticate:** confirm that `VSCE_PAT` exists, has not
  expired, and has the `Marketplace > Manage` scope; or confirm that `OVSX_PAT`
  exists in the same protected environment and the `iggyinc` namespace was
  created. Do not ask the user to paste either token into chat.
- **`vsce show` reports the old version:** inspect the successful Actions log
  first. The public Marketplace cache can take several minutes to refresh.
- **Open VSX or Cursor reports the old version:** inspect the successful Open
  VSX job and listing first. Cursor can take additional time to index Open VSX;
  the release `.vsix` is the user fallback while it catches up.
- **Secret scanner blocks packaging:** run the local VSIX preflight, inspect
  `vsce ls --tree`, then exclude the flagged development-only files in
  `.vscodeignore`; do not disable the scanner.
- **Token setup:** Azure DevOps, not Azure Portal, creates PATs. Use
  `https://dev.azure.com/<organization>/_usersSettings/tokens`, then choose
  Custom scopes and `Marketplace > Manage`.
- **Long-term authentication:** migrate from the PAT-backed workflow to
  Microsoft Entra workload identity before Azure DevOps retires global PATs on
  December 1, 2026.
