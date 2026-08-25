# Local dev install (symlink)

Symlink this repo into the editor's extensions folder for live testing in *other* repos/
windows, without publishing anywhere. This is a per-machine, per-editor setup.

## Why this over other options

- **F5 / Extension Development Host**: fastest live-reload loop, but only reflects the
  extension inside the single Development Host window tied to this repo. Doesn't let you
  casually work in *other* repos in your normal editor windows with the extension active.
- **`vsce package` + `--install-extension` .vsix**: works in any window, but is a snapshot —
  every code change requires re-packaging and re-installing.
- **Symlink into `extensions/` + `npm run watch` + reload window** (this flow): any window can
  use it, and the update loop is just "reload window" — no packaging step. Downside: only
  works on this machine, and only for the identity (`publisher.name`) the symlink folder was
  created under.

## Identity

`package.json` is renamed away from the upstream fork's published identity:

| field | upstream (published) | current (local dev) |
|---|---|---|
| `name` | `xlsx-viewer` | `sheetmark` |
| `publisher` | `muhammad-ahmad` | `iggyinc` |

This makes the extension ID `iggyinc.sheetmark`. `displayName` and all `xlsxViewer.*` /
`xlsx-viewer.*` IDs are untouched — protected per `AGENTS.md` §3, unrelated to this identity
rename.

Two self-lookups read the extension by ID to report its own version (`getSystemDetails`
handler, used for a diagnostics panel) and **must match `publisher.name` from `package.json`
exactly**, or they silently return `undefined` (no crash, no error):

- [src/mdEditorProvider.ts](../../../../src/mdEditorProvider.ts)
- [src/spreadsheetEditorProvider.ts](../../../../src/spreadsheetEditorProvider.ts)

Any future rename of `name`/`publisher` must update both call sites in the same commit.

## Critical gotcha: the folder name is NOT cosmetic

The extensions-dir folder must be named exactly `<publisher>.<name>-<version>` — e.g.
`iggyinc.sheetmark-1.2.0`. This is **not** just a convention; the editor's extension scanner
enforces it. On startup it derives the expected folder name from `<id>-<version>` in its
`extensions.json` manifest; if that doesn't match the actual folder on disk, it writes the
expected name into `.obsolete` and the extension silently vanishes from the Extensions view —
in **every** window, not just this repo, because `~/.cursor/extensions` (or
`~/.vscode/extensions`) is a single global folder shared across all windows.

This bites every time `package.json`'s `version` is bumped without also renaming the symlink
folder to match. Symptom: "the extension disappeared from Extensions, in this repo and every
other repo too."

Fix — rename the folder to match the current version, every time the version changes:

```bash
EDITOR_EXT_DIR=~/.cursor/extensions   # or ~/.vscode/extensions for vanilla VS Code
OLD_VERSION="<previous folder version suffix>"
NEW_VERSION="$(node -p "require('./package.json').version")"
mv "$EDITOR_EXT_DIR/iggyinc.sheetmark-$OLD_VERSION" "$EDITOR_EXT_DIR/iggyinc.sheetmark-$NEW_VERSION"
```

Then **fully quit** the editor (Cmd+Q / Quit, not just close-the-window) and relaunch —
`extensions.json` and `.obsolete` are only read at process startup. Closing the last window
often leaves the app process alive in the background; reopening a window reuses that live
process and never re-reads the manifest, so the extension stays missing even after "reopening."

If the manifest still shows a stale version/path after a rename (check
`$EDITOR_EXT_DIR/extensions.json` for the `iggyinc.sheetmark` entry, and
`$EDITOR_EXT_DIR/.obsolete` for a stale `iggyinc.sheetmark-<version>: true` line), the editor
usually self-heals this on its next full relaunch by rescanning the actual folder. If it
doesn't, quit the editor first, then hand-edit `extensions.json`'s `location.path` /
`relativeLocation` for that entry to the new folder name, and drop any matching line from
`.obsolete`.

## Redo this setup (new machine, or after the extensions dir gets cleared)

1. Confirm editor + extensions dir: `ls ~/.cursor/extensions` (Cursor) or
   `ls ~/.vscode/extensions` (VS Code). Use the matching CLI (`cursor` or `code`) below.
2. Confirm `package.json` has `name: "sheetmark"`, `publisher: "iggyinc"`, and that both
   `getExtension('iggyinc.sheetmark')` call sites above match.
3. Uninstall any conflicting marketplace install of the original fork, if present — two
   extensions registering the same `viewType` (e.g. `xlsxViewer.xlsx`) conflict:
   ```bash
   cursor --uninstall-extension muhammad-ahmad.xlsx-viewer
   ```
4. Symlink this repo in, named for the **current** `package.json` version:
   ```bash
   VERSION="$(node -p "require('./package.json').version")"
   ln -s "$(pwd)" ~/.cursor/extensions/iggyinc.sheetmark-$VERSION
   ```
5. `npm run compile` once to confirm a clean `dist/`, then `npm run watch` and leave it
   running — it rebuilds `dist/**` on save. The editor does **not** hot-reload extension code;
   after a rebuild, run **"Developer: Reload Window"** in the target window.
6. In any target window: Cmd+Shift+P → **Developer: Reload Window** to activate.

## Reverse this (go back to the published upstream extension)

1. Stop the `npm run watch` process, if running.
2. Remove the symlink (does **not** touch the repo — only the extensions-dir entry):
   ```bash
   VERSION="$(node -p "require('./package.json').version")"
   rm ~/.cursor/extensions/iggyinc.sheetmark-$VERSION
   ```
3. Revert the identity fields in `package.json`: `name` → `xlsx-viewer`,
   `publisher` → `muhammad-ahmad`.
4. Revert the two self-lookup call sites (`getSystemDetails` handler) back to
   `'muhammad-ahmad.xlsx-viewer'` in `mdEditorProvider.ts` and `spreadsheetEditorProvider.ts`.
5. `npm run compile` to confirm clean.
6. Reinstall the marketplace version if wanted day-to-day:
   ```bash
   cursor --install-extension muhammad-ahmad.xlsx-viewer
   ```
7. Fully quit and relaunch the editor.

**Quick check both states aren't active at once:**
`ls ~/.cursor/extensions | grep -iE "xlsx|sheetmark"` — exactly one of the two extension IDs
should be present, never both, since they'd fight over the same `xlsxViewer.*` viewTypes.
