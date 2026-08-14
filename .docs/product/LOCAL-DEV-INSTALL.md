# Local dev install (symlink) — setup & reversal

How this repo got installed as a live local extension in the user's editor (Cursor) for
fast iteration across *other* repos, without publishing to a marketplace. Also how to
undo it and go back to the published `muhammad-ahmad.xlsx-viewer` identity.

---

## Current state (as of this doc)

- Editor in use: **Cursor** (`~/.cursor/extensions/`), not vanilla VS Code (`~/.vscode/extensions/`).
  Check which one applies before touching paths — `which cursor` / `which code`, and look for
  `~/.cursor/extensions` vs `~/.vscode/extensions`.
- `package.json` identity was renamed away from the upstream fork's published identity:
  | field | upstream (published) | current (local dev) |
  |---|---|---|
  | `name` | `xlsx-viewer` | `sheetmark` |
  | `publisher` | `muhammad-ahmad` | `iggyinc` |

  This changes the extension ID from `muhammad-ahmad.xlsx-viewer` to
  `iggyinc.sheetmark`. **`displayName`, and all `xlsxViewer.*` viewTypes /
  `xlsx-viewer.*` command IDs were left untouched** — those are protected per [CLAUDE.md](../../CLAUDE.md)
  §3 and are unrelated to the publisher/name identity fields.
- The marketplace version `muhammad-ahmad.xlsx-viewer` was **uninstalled** from Cursor
  (`cursor --uninstall-extension muhammad-ahmad.xlsx-viewer`) — required because two extensions
  registering the same `viewType` (e.g. `xlsxViewer.xlsx`) conflict.
- This repo folder is **symlinked** into Cursor's extensions dir:
  ```
  ~/.cursor/extensions/iggyinc.sheetmark-1.0.0 -> <this repo path>
  ```
- `npm run watch` runs continuously in this repo, rebuilding `dist/**` on save. Cursor does **not**
  hot-reload extension code — after a rebuild, run **"Developer: Reload Window"** in the target
  window to pick up changes.

## Why this over other options

- **F5 / Extension Development Host**: fastest live-reload loop, but only reflects the extension
  inside the single Development Host window tied to this repo. Doesn't let you casually work in
  *other* repos in your normal editor windows with the extension active.
- **`vsce package` + `--install-extension` .vsix**: works in any window, but is a snapshot —
  every code change requires re-packaging and re-installing (or bumping version / `--force`).
- **Symlink into `extensions/` + `npm run watch` + reload window** (chosen): any window can use it,
  and the update loop is just "reload window" — no packaging step. Downside: only works on this
  machine, and only for the identity (`publisher.name`) the symlink folder was created under.

Two self-lookups in the source read the extension by ID to report its own version
(`getSystemDetails` handler, used for a diagnostics panel):
- [src/mdEditorProvider.ts](../../src/mdEditorProvider.ts) — `vscode.extensions.getExtension(...)`
- [src/spreadsheetEditorProvider.ts](../../src/spreadsheetEditorProvider.ts) — same

These **must match `publisher.name` from `package.json` exactly**, or they silently return
`undefined` and the diagnostics panel shows `extensionVersion: 'unknown'` (no crash, no error —
same silent-breakage class as the message-protocol rule in CLAUDE.md §2). Any future rename of
`name`/`publisher` must update both call sites in the same commit.

---

## Redo this setup (e.g. on a new machine, or after `~/.cursor/extensions` gets cleared)

1. Confirm editor + extensions dir: `ls ~/.cursor/extensions` (Cursor) or `~/.vscode/extensions`
   (VS Code). Use the matching CLI (`cursor` or `code`) for install/uninstall commands below.
2. Confirm `package.json` has `name: "sheetmark"`, `publisher: "iggyinc"`,
   and that both `getExtension('iggyinc.sheetmark')` call sites match.
3. Uninstall any conflicting marketplace install of the original fork, if present:
   ```bash
   cursor --uninstall-extension muhammad-ahmad.xlsx-viewer
   ```
4. Symlink this repo in:
   ```bash
   ln -s "$(pwd)" ~/.cursor/extensions/iggyinc.sheetmark-<version>
   ```
   (`<version>` is cosmetic — matches `package.json` `version` by convention, not enforced.)
5. `npm run compile` once to confirm a clean `dist/`, then `npm run watch` and leave it running.
6. In any target window: Cmd+Shift+P → **Developer: Reload Window** to activate, and again after
   every future change you want reflected.

---

## Reverse this (go back to the published upstream extension)

1. Stop the `npm run watch` process (if running).
2. Remove the symlink (this does **not** touch the repo — it only removes the extensions-dir entry):
   ```bash
   rm ~/.cursor/extensions/iggyinc.sheetmark-1.0.0
   ```
3. Revert the identity fields in `package.json`:
   | field | set back to |
   |---|---|
   | `name` | `xlsx-viewer` |
   | `publisher` | `muhammad-ahmad` |
4. Revert the two self-lookup call sites back to `'muhammad-ahmad.xlsx-viewer'`:
   - [src/mdEditorProvider.ts](../../src/mdEditorProvider.ts) (`getSystemDetails` handler)
   - [src/spreadsheetEditorProvider.ts](../../src/spreadsheetEditorProvider.ts) (`getSystemDetails` handler)
5. `npm run compile` to confirm clean.
6. Reinstall the marketplace version if you still want it active day-to-day:
   ```bash
   cursor --install-extension muhammad-ahmad.xlsx-viewer
   ```
   (from the Marketplace — search "Sheetmark" — or a `.vsix` if offline.)
7. Reload window in any open editor to drop the local dev extension and pick up the marketplace one.

**Quick check both states aren't active at once:** `ls ~/.cursor/extensions | grep -i xlsx` /
`grep -i sheetmark` — exactly one of the two extension IDs should be present, never both,
since they'd fight over the same `xlsxViewer.*` viewTypes.
