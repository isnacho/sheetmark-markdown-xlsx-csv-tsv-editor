---
name: publish-vscode-marketplace
description: Publish and verify updates for the Sheetmark VS Code extension on the Visual Studio Marketplace. Use when asked to release, publish, push an update, check a Marketplace version, or troubleshoot the GitHub Actions publishing workflow for iggyinc.sheetmark.
---

# Publish Sheetmark to the VS Code Marketplace

Publish the extension ID `iggyinc.sheetmark` from
`nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor`.

## Preconditions

- Confirm `package.json` has a new SemVer `version`; the Marketplace rejects a
  version that is already published.
- Ensure the intended source is committed and pushed to `main`. Do not publish
  uncommitted local work.
- Require the GitHub Actions secret `VSCE_PAT`: an Azure DevOps PAT with the
  `Marketplace > Manage` scope. Never request or expose its value.
- Use `.github/workflows/publish-marketplace.yml`, which runs on a published
  GitHub Release and supports manual dispatch.

## Publish an update

1. Inspect the working tree, branch, local version, and published version:

   ```bash
   git status --short
   git branch --show-current
   node -p "require('./package.json').version"
   npx --yes @vscode/vsce@latest show iggyinc.sheetmark
   ```

2. If the local version is newer and `main` is clean and pushed, trigger the
   workflow. This is a public release action: get explicit user approval when
   it has not already been given.

   ```bash
   gh workflow run "Publish to VS Code Marketplace" \
     --repo nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor
   gh run list \
     --repo nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor \
     --workflow "Publish to VS Code Marketplace" --limit 1
   ```

   Alternatively, publish a GitHub Release from the update commit; the same
   workflow runs automatically.

3. Watch the resulting run. Treat the version as published only after the job
   succeeds and its log contains `Published iggyinc.sheetmark v<version>`.

   ```bash
   gh run watch <run-id> \
     --repo nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor \
     --exit-status
   ```

4. Verify with `vsce`, then provide the Marketplace listing:

   ```bash
   npx --yes @vscode/vsce@latest show iggyinc.sheetmark
   ```

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
