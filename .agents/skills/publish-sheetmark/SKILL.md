---
name: publish-sheetmark
description: Publish or locally install the Sheetmark VS Code extension (iggyinc.sheetmark). Use when asked to release, publish, ship an update, check a Marketplace/Open VSX version, test the extension live in another repo/window, or troubleshoot local dev install or the GitHub Actions publishing workflow.
---

# Publish Sheetmark

Extension ID `iggyinc.sheetmark`, repo `nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor`.

## First: pick a mode

If the request doesn't already make it obvious, ask which of these is wanted:

- **Local install** — symlink this repo into the editor's extensions folder so it's live for
  testing in other repos/windows. No version bump, nothing published, nothing pushed.
  → follow [references/local-install.md](references/local-install.md)
- **Marketplace release** — bump the version, publish to the VS Code Marketplace *and* Open
  VSX via GitHub Actions, verify both listings. Public and effectively permanent (a published
  version can't be unpublished/reused).
  → follow [references/marketplace-release.md](references/marketplace-release.md)
- **Both** — do the local install first (fast loop while iterating on the exact code that's
  about to ship), confirm it behaves, then run the marketplace release flow.
  → local-install.md, then marketplace-release.md

Skip the question when the request already answers it ("let me test this in another repo",
"publish the next version", "release it and let me try it locally too").

## Shared rules across both modes

- `displayName`, and all `xlsxViewer.*` viewTypes / `xlsx-viewer.*` command IDs are protected
  identity — see `AGENTS.md` §3. Never touch them in either flow; only `name`/`publisher` in
  `package.json` (and the two `getExtension(...)` self-lookup call sites) are fork-identity
  fields that can move.
- Never expose `VSCE_PAT` or `OVSX_PAT` values in chat, commands, or logs — reference them
  only by name (env var / secret name), never their value.
