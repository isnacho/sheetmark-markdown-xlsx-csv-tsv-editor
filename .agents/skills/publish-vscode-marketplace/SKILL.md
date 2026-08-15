---
name: publish-vscode-marketplace
description: Publish and verify updates for the Sheetmark VS Code extension on the Visual Studio Marketplace. Use when asked to release, publish, push an update, check a Marketplace version, or troubleshoot the GitHub Actions publishing workflow for iggyinc.sheetmark.
---

# Publish Sheetmark to the VS Code Marketplace

Publish the extension ID `iggyinc.sheetmark` from
`nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor`.

## Standard release flow

When this skill is invoked to publish or release, own the complete release flow:
prepare the version and changelog, validate it, commit and push it, publish it,
then verify it. Do not make the user separately ask for routine steps.

### 1. Inspect the release state

Inspect the working tree, branch, local version, published version, and commits
since the last release:

```bash
git status --short --branch
git branch --show-current
node -p "require('./package.json').version"
git log --oneline
npx --yes @vscode/vsce@latest show iggyinc.sheetmark
```

The Marketplace rejects a version that is already published. Never publish
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

### 3. Validate, commit, and push

Run the repository validation and review the release diff:

```bash
git diff --check
npm run compile
git diff -- package.json CHANGELOG.md
```

Commit the release metadata and push it to `main`:

```bash
git add package.json CHANGELOG.md
git commit -m "chore: release v<version>"
git push origin main
git status --short --branch
```

### 4. Publish and watch

Require the GitHub Actions secret `VSCE_PAT` (an Azure DevOps PAT with
`Marketplace > Manage` scope); never request or expose its value. Use
`.github/workflows/publish-marketplace.yml`, which supports manual dispatch.

Publishing is a public release action. If the user has not explicitly asked to
publish in this invocation, ask immediately before triggering it. An explicit
request such as “publish,” “release,” or “trigger it now” is approval; do not
ask a redundant second time.

```bash
gh workflow run "Publish to VS Code Marketplace" \
  --repo nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor --ref main
gh run list \
  --repo nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor \
  --workflow "Publish to VS Code Marketplace" --branch main --limit 1
gh run watch <run-id> \
  --repo nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor --exit-status
```

Treat the version as published only after the run succeeds and its log contains
`Published iggyinc.sheetmark v<version>`. Then verify with:

```bash
npx --yes @vscode/vsce@latest show iggyinc.sheetmark
```

Give the user the Marketplace listing:
`https://marketplace.visualstudio.com/items?itemName=iggyinc.sheetmark`

## Troubleshooting

- **Workflow cannot authenticate:** confirm that `VSCE_PAT` exists, has not
  expired, and has the `Marketplace > Manage` scope. Do not ask the user to
  paste it into chat.
- **`vsce show` reports the old version:** inspect the successful Actions log
  first. The public Marketplace cache can take several minutes to refresh.
- **Token setup:** Azure DevOps, not Azure Portal, creates PATs. Use
  `https://dev.azure.com/<organization>/_usersSettings/tokens`, then choose
  Custom scopes and `Marketplace > Manage`.
- **Long-term authentication:** migrate from the PAT-backed workflow to
  Microsoft Entra workload identity before Azure DevOps retires global PATs on
  December 1, 2026.
