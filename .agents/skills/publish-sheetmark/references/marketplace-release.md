# Marketplace release (VS Code Marketplace + Open VSX)

Publishes `iggyinc.sheetmark` to **both** registries from one GitHub Actions run:
[.github/workflows/publish-marketplace.yml](../../../../.github/workflows/publish-marketplace.yml)
packages the VSIX once, then publishes that exact file to the VS Code Marketplace and to
Open VSX (so both registries ship byte-identical bits from the same commit).

Own the complete release flow end to end: prepare version + changelog, validate, commit and
push, publish, then verify both listings. Don't make the user separately ask for routine
steps.

## 1. Inspect the release state

```bash
git fetch origin main --tags
git status --short --branch
git branch --show-current
node -p "require('./package.json').version"
git log --oneline
npx --yes @vscode/vsce@latest show iggyinc.sheetmark
curl -s "https://open-vsx.org/api/iggyinc/sheetmark" | node -p "JSON.parse(require('fs').readFileSync(0)).version"
```

Both registries reject a version that's already published there. Never publish uncommitted
work, and publish only from pushed `main`.

## 2. Confirm release metadata when preparation is needed

If the local version isn't newer than either published version, or the changelog still has an
`Unreleased` section, derive a recommended SemVer bump from the changes (patch for fixes,
minor for user-facing features, major only for breaking changes). Draft release notes from the
commits and propose the current date (`YYYY-MM-DD`) for the changelog.

Before editing release metadata, ask the user to confirm: exact version, changelog release
date, release-note summary and scope.

Once confirmed, update `package.json` and move the relevant `Unreleased` entries under
`## v<version> — <date>` in `CHANGELOG.md`. Update the lockfile only when its root package
metadata intentionally mirrors `package.json`; don't make unrelated dependency-lock changes.

If this release also follows a **local install** (see
[local-install.md](local-install.md)), the extensions-dir symlink folder is currently named
for the *old* version — rename it to match once the new version is committed, or the local
dev install will vanish from the Extensions view (see that doc's gotcha section).

## 3. Validate the release and VSIX locally

```bash
git diff --check
npm run compile
git diff -- package.json CHANGELOG.md
RELEASE_VSIX_DIR="$(mktemp -d)"
npx --yes @vscode/vsce@latest package --no-dependencies \
  --out "$RELEASE_VSIX_DIR/sheetmark.vsix"
npx --yes @vscode/vsce@latest ls --tree
```

Do not push if packaging fails, secret scanning reports a file, or the VSIX listing includes
development-only directories such as `.agents`, `.codex`, `.claude`, `.github`, `.docs`, `src`,
or `samples`. Fix `.vscodeignore` and repeat the preflight first.

## 4. Commit, push, and tag the exact release source

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

Confirm the tag resolves to the same SHA as `origin/main`. If a release tag already exists,
never move or recreate it; stop and ask the user how to proceed.

## 5. Publish the tag and watch its exact run

Requires two GitHub Actions secrets on the `marketplace` environment — never request or expose
either value:

- `VSCE_PAT` — Azure DevOps PAT, `Marketplace > Manage` scope.
- `OVSX_PAT` — Open VSX personal access token for the `iggyinc` namespace.

Publishing is a public release action. If the user hasn't explicitly asked to publish in this
invocation, ask before triggering it. An explicit "publish," "release," or "trigger it now" is
approval; don't ask a redundant second time.

```bash
gh workflow run "Publish Sheetmark Release" \
  --repo nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor \
  --ref "v<version>"
gh run list \
  --repo nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor \
  --workflow "Publish Sheetmark Release" \
  --event workflow_dispatch --commit "$RELEASE_SHA" --limit 1
gh run watch <run-id> \
  --repo nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor --exit-status
```

The dispatch response may supply a run URL; otherwise poll the exact `workflow_dispatch` +
`$RELEASE_SHA` query above until the run appears. Never select a run only because it's the
most recent one — verify its `headSha` matches `$RELEASE_SHA` before watching it.

Treat the version as published only after the run succeeds. Its log should show a successful
`vsce publish` step and a successful `ovsx publish` step. Then verify both listings:

```bash
npx --yes @vscode/vsce@latest show iggyinc.sheetmark
curl -s "https://open-vsx.org/api/iggyinc/sheetmark" | node -p "JSON.parse(require('fs').readFileSync(0)).version"
```

Give the user both listings:
- `https://marketplace.visualstudio.com/items?itemName=iggyinc.sheetmark`
- `https://open-vsx.org/extension/iggyinc/sheetmark`

## Troubleshooting

- **Workflow cannot authenticate to the VS Code Marketplace:** confirm `VSCE_PAT` exists on
  the `marketplace` environment, hasn't expired, and has the `Marketplace > Manage` scope. Do
  not ask the user to paste it into chat.
- **Workflow cannot authenticate to Open VSX:** confirm `OVSX_PAT` exists on the `marketplace`
  environment. Tokens are created at `https://open-vsx.org/user-settings/tokens`, scoped to the
  `iggyinc` namespace (must already exist as an Open VSX namespace — it does, `iggyinc.sheetmark`
  is already published there).
- **`vsce show` / the Open VSX API reports the old version:** inspect the successful Actions
  log first. Both registries' public caches can take several minutes to refresh.
- **Secret scanner blocks packaging:** run the local VSIX preflight, inspect `vsce ls --tree`,
  then exclude the flagged development-only files in `.vscodeignore`; don't disable the
  scanner.
- **VSCE_PAT setup:** Azure DevOps, not Azure Portal, creates PATs — use
  `https://dev.azure.com/<organization>/_usersSettings/tokens`, Custom scopes,
  `Marketplace > Manage`.
- **Long-term VSCE_PAT authentication:** migrate from the PAT-backed workflow to Microsoft
  Entra workload identity before Azure DevOps retires global PATs on December 1, 2026.
