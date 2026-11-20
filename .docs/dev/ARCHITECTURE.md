# Architecture

The "why" behind the layout. For hard rules and the change-map see [AGENTS.md](../../AGENTS.md);
for the message inventory see [MESSAGE-PROTOCOL.md](MESSAGE-PROTOCOL.md).

---

## The runtime boundary

```
┌─────────────────────────── EXTENSION HOST (Node.js) ───────────────────────────┐
│ dist/extension.js   (esbuild platform:node, external:['vscode'])                │
│                                                                                 │
│  extension.ts ── activate() ── registers:                                       │
│     • SpreadsheetEditorProvider  → viewTypes xlsxViewer.xlsx / .csv / .tsv      │
│     • MDEditorProvider           → viewType  xlsxViewer.md                      │
│     • commands  xlsx-viewer.*   (see "Commands" below)                          │
│                                                                                 │
│  Has: fs, path, exceljs, the real `vscode` module, globalStorage, settings      │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │  webview.postMessage(...)  ▲   ▼  onDidReceiveMessage(...)
                │  ( typed in src/protocol/; see MESSAGE-PROTOCOL.md )
┌───────────────▼─────────────────────────── WEBVIEW (browser sandbox) ──────────┐
│ dist/spreadsheet/spreadsheetWebview.js   dist/md/mdWebview.js  (platform:browser)│
│                                                                                 │
│  HTML shell (getWebviewContent) + CSP + asWebviewUri assets                     │
│  `vscode` = acquireVsCodeApi()  (postMessage/getState/setState ONLY)            │
│  Has: DOM, window, markdown-it (TOC), CodeMirror 6 (MD editor), mermaid, Typo.js│
│  NO fs / node / vscode module                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

esbuild ([esbuild.js](../../esbuild.js)) produces these bundles: the host (CJS), the spreadsheet
webview (IIFE) and the Markdown webview (ES module with code splitting: mermaid and its diagram
types load from `dist/md/chunks/` on first use; the shell loads it with `<script type="module">`). `resources/**` (CSS, SVG,
PNG) are static, loaded into the webview via `asWebviewUri` under the CSP. The boundary is a hard
process boundary: **no shared mutable state, no cross-calls, only messages.**

---

## Providers are `CustomReadonlyEditorProvider`

Both providers implement `vscode.CustomReadonlyEditorProvider`: they own open and save via
`resolveCustomEditor` and file writes, not a managed `TextDocument`. Registration (the
`registerCustomEditorProvider` calls in `activate` in [extension.ts](../../src/extension.ts)) uses
`retainContextWhenHidden: true` (webview state survives tab switches) and
`supportsMultipleEditorsPerDocument: false`.

`SpreadsheetEditorProvider` backs **three** viewTypes with one instance: file type is detected from
the extension (`detectTabularFileType`) and branches internally.

### `resolveCustomEditor` lifecycle (both providers)

1. Set `webview.options`: `enableScripts: true`, `localResourceRoots` (spreadsheet: `resources/` +
   `dist/`; markdown: also workspace folder + document dir for local images).
   Assets outside allowed roots cannot load.
2. `webview.html = getWebviewContent(...)`: the shell with CSP + script/style URIs. Shows a
   loading overlay immediately.
3. Register `onDidReceiveMessage`: the host's half of the protocol.
4. Webview boots, posts `webviewReady`; the host replies with the init payload
   (`initVirtualTable` / `initMarkdown`) + `initSettings` + `setTheme`. **Markdown** skips most of
   that round trip: the host reads the file before step 2 and embeds `initMarkdown`, `initSettings`
   and `fontFamilyChanged` in the HTML as a JSON data block (`renderMarkdownHtml`), the webview
   applies them at boot and posts `webviewReady` with `appliedInitialMessages: true`, and the host
   then sends only `setTheme` (plus `initMarkdown` again if the file changed meanwhile). The version
   history snapshot is written after that, off the critical path.
5. Steady state: user actions in the webview post commands; the host mutates the file or state and
   posts results back.

Spreadsheet shell + CSP: `getWebviewContent` in [spreadsheetHtmlRenderer.ts](../../src/spreadsheet/spreadsheetHtmlRenderer.ts).
Markdown shell + CSP: `getWebviewContent` method in [mdEditorProvider.ts](../../src/mdEditorProvider.ts).

---

## Commands

All registered in `activate` in [extension.ts](../../src/extension.ts) (grep `registerCommand`).
IDs keep the upstream `xlsx-viewer.` prefix.

| Command | What it does | In `package.json` `contributes.commands`? |
|---|---|---|
| `xlsx-viewer.openWithXlsx` / `openWithCsv` / `openWithTsv` / `openWithMd` | Reopen a file in the matching Sheetmark editor ("Open with Sheetmark") | Yes |
| `xlsx-viewer.goBackToTableView` | Reopen a CSV/TSV in the Sheetmark table editor | Yes |
| `xlsx-viewer.goBackToXlsxView` | Reopen an XLSX in the Sheetmark editor | Yes |
| `xlsx-viewer.goBackToMdPreview` | Reopen a Markdown file in the Sheetmark editor | Yes |
| `xlsx-viewer.convertFile` | Convert between csv, tsv, and xlsx (also reachable from the toolbar via the `convertFile` message) | Yes |
| `xlsx-viewer.md.acceptAllDiskChanges` / `md.rejectAllDiskChanges` | Accept or reject every chunk in the disk diff of the active Markdown editor (also bound in `contributes.keybindings`) | Yes |
| `xlsx-viewer.toggleAssociation` | Set or clear Sheetmark as the default editor for a file type (`{ type, enable }`) | **No** (internal only) |
| `xlsx-viewer.toggleMdAssociation` | Legacy Markdown alias kept for backward compatibility; calls `toggleAssociation` | **No** (internal only) |

The webview "Open by default" checkbox does not use these two commands; it sends `enableAsDefault` /
`disableDefaultEditor`, handled in each provider via
[editorAssociationUtils.ts](../../src/shared/editorAssociationUtils.ts).

---

## Key data flows

### Save (spreadsheet)
There is one editing surface (no Edit Table mode) and one **edit ledger** per sheet
([pendingEdits.ts](../../src/webviews/spreadsheet/pendingEdits.ts), instance in `ledger.ts`): every
unsaved cell value, rich-text run, style edit and structure operation is recorded there, in the sheet's
current coordinates. `saveEdits` takes a payload `{ edits, richEdits, styleEdits, operations }` for one
sheet at a time and posts `saveXlsxEdits { sheetIndex, ... }`; with autosave on, `recordChange`
schedules it 1.1 s after the last change. The host applies it (exceljs for XLSX; delimited write for
CSV/TSV), snapshots a version, and posts `saveResult { ok, isAutosave }`; on success `settleSaved`
removes exactly the entries that were sent, so edits made while the save was in flight stay pending.
Autosave defaults: on for CSV/TSV, off for XLSX (an XLSX save rewrites the whole workbook), set by
`xlsxViewer.<type>.autoSave`. Undo and redo are kept per sheet and are recorded into the ledger too, so
they are saved; undo of a structure edit or formatting that is already on disk is not available (the
entry is dropped on save, see `dropUnrecoverableUndoEntries`).

Rows fetched again (`rowsData`) get the pending values laid over them (`overlayRows`), so an edit
survives scrolling, sorting and switching sheets. A sheet with unsaved structure edits keeps its local
rows in `state.sheetStash` while another sheet is on screen.

### Virtualization (large tables)
The webview never holds the whole sheet. On scroll it asks the host for row windows: `requestRows`
→ `getRows` (via [virtualLoader.ts](../../src/webviews/shared/virtualLoader.ts)) → host responds
`rowsData { requestId, rows }` → `VirtualLoader.resolveRequest`. Geometry constants
(`ROW_HEIGHT`, `BUFFER_ROWS`, `CHUNK_SIZE`) live in [common.ts](../../src/webviews/shared/common.ts).

### CSV/TSV hold data only
Delimited files can't store formatting, so CSV/TSV open as data only (`state.isDataOnly`): no formatting
row, no Insert control, no stored styles in the payload, and saves write only the file. Older versions
kept formatting in extension state ([StyleStorageService](../../src/shared/styleStorageService.ts),
keyed `row:col`, expiring 48 hours after the last edit). If a file still has some, `initVirtualTable`
carries `legacyStylesNotice` and the webview shows a notice with Convert to XLSX (`convertToXlsx`: keeps
the styles, merges and checkbox/dropdown controls via `applyStoredMetadataToWorksheet`) and Dismiss
(`dismissLegacyStyles`: deletes them). XLSX stores everything natively (exceljs); there is no
Plain/Styled view for any file type.

### Conversion
[fileConversionService.ts](../../src/shared/fileConversionService.ts) converts csv↔tsv↔xlsx, reachable
from the toolbar (`convertFile` message) and the `xlsx-viewer.convertFile` command.

### Version history
[versionHistory.ts](../../src/shared/versionHistory.ts) snapshots prior file states under
`context.globalStorageUri`, indexed per file. Flow: `showVersionHistory` → preview
(`versionPreviewMd` / preview mode) → `restoreVersion` or `cancelVersionPreview`.

### Markdown live preview (CM6)
The Markdown editor is a single CodeMirror 6 surface
([livePreviewEditor.ts](../../src/webviews/md/livePreview/livePreviewEditor.ts)) with custom widgets
for tables, callouts, mermaid fences, images, and frontmatter. There is no split, raw-textarea, or
reading view. `mdWebview.ts` holds the shell; the CM6 stack lives under `src/webviews/md/livePreview/`.
Both are large: navigate with [MAP-mdWebview.md](MAP-mdWebview.md). `state.currentContent`
(`state.ts`) is the single source of truth: CM6 writes into it through its `onDocChanged`
callback and `getActiveEditorContent()` (`saveSync.ts`) reads it. Outline/TOC still uses markdown-it token parsing;
document rendering is CM6, not a static HTML preview.

### Markdown per-file / global preferences (extension state)
Persisted outside the `.md` bytes by `createMarkdownPreferences` in
[preferenceStore.ts](../../src/shared/preferenceStore.ts) (generic `filePreference` /
`globalPreference` stores; storage keys are persisted user data and must not change):

| Preference | Keyed by | Stores |
|---|---|---|
| `tableColumnWidths` | file (lowercased path) | Table column widths (order-index → px) |
| `frontmatterPanelCollapsed` | file | YAML card collapsed state |
| `mermaidPreviewMode` | global | Mermaid diagram vs code preview |
| `calloutDefaultType` | global | Default callout type slug |
| `outlinePinned` | global | Sidebar outline vs minimal preview-edit line rail |

Per-file preferences listed in `perFile` move with the file on rename (see Renames below).

Loaded into `initMarkdown` / `diskChangedExternally`; webview persists edits via
`saveTableColumnWidths`, `saveFrontmatterPanelCollapsed`, `saveDetailsOpenState`, `saveMermaidPreviewMode`,
`saveCalloutDefaultType`, `saveOutlinePinned`.

### External disk changes
**Markdown:** `createExternalFileChangeWatcher` in
[fileExternalChangeWatcher.ts](../../src/shared/fileExternalChangeWatcher.ts): change →
`diskChangedExternally`; debounced delete → `diskDeletedExternally`. The webview shows persistent
toasts; dirty edits require confirm before reload. With the diff-review setting on, the change opens
a disk-vs-editor diff instead (see the disk-diff cluster in [MAP-mdWebview.md](MAP-mdWebview.md) and
the UX flowchart in [flow.md](../flow.md)). `saveMarkdown` has a host-side conflict check →
`saveConflict`. `requestFreshData` triggers a manual re-read.

**Spreadsheet:** same watcher, but a change is never applied silently. The provider keeps a SHA-1 of the
file as it last loaded or saved it ([fileHash.ts](../../src/shared/fileHash.ts)); on a change it hashes the
file again, ignores its own save (same hash) and otherwise posts `diskChangedExternally`. The webview
([diskSync.ts](../../src/webviews/spreadsheet/diskSync.ts)) shows a persistent toast, "File changed on
disk", with Load disk changes (confirms first if there are unsaved edits, then `requestFreshData`) and,
with unsaved edits, Keep my edits (confirms "Save your edits into the changed file?", then saves with
`force`). `saveXlsxEdits` without `force` checks the hash first and answers `saveConflict` without
writing; a manual save then asks the same question, autosave shows the toast and pauses. A spreadsheet
save is read-modify-write, so forcing keeps the other changes on disk. `initVirtualTable.reason` says why
the table is sent (`reload` and `restore` drop unsaved edits; `save` keeps them). Delete →
`diskDeletedExternally`.

**Renames (both editors):** VS Code closes the open editor and opens a new one at the new path.
`registerRenameStateMigration` ([renameStateMigration.ts](../../src/shared/renameStateMigration.ts))
handles `onWillRenameFiles`: it waits for the panel's queued saves, then moves styles,
Markdown preferences and version history via `migrateFileUriState`, before VS Code renames, so the
new editor loads them. Renames outside VS Code aren't reported and look like a delete.

### Theme, settings, feedback (shared)
Handled in `src/webviews/shared/**` and reused by both editors (file list:
[guide.md](../../src/webviews/shared/guide.md)):
- **Theme:** host posts `{ type: 'setTheme', kind }` (keyed on `message.type`, not `command`),
  applied by [themeManager.ts](../../src/webviews/shared/themeManager.ts). CSS reads VS Code theme
  variables from [resources/shared/theme.css](../../resources/shared/theme.css).
- **Settings:** host pushes `initSettings` / `settingsUpdated`; webview edits post `updateSettings`.
  Definitions live in `package.json` `contributes.configuration`; webview handling in
  [settingsManager.ts](../../src/webviews/shared/settingsManager.ts).
- **Feedback:** [feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts) posts
  `getSystemDetails` / `submitFeedback` / `openExternal`, receives `systemDetails` / `feedbackResult`.

---

## Build

[esbuild.js](../../esbuild.js): three contexts: the extension (node CJS, `external:['vscode']`,
`dist/extension.js`), the spreadsheet webview (browser IIFE, `dist/spreadsheet/`) and the Markdown
webview (browser ESM with splitting, `dist/md/mdWebview.js` + `dist/md/chunks/`). A non-watch build
empties `dist/` first, so stale files never ship in the VSIX. markdown-it, mermaid, CodeMirror 6,
Typo.js, exceljs and the rest are bundled in. tsc only type-checks;
esbuild does the transpile.

Type checking is split by runtime so the boundary above is compiler-enforced:

| Project | Covers | Globals |
|---|---|---|
| [tsconfig.json](../../tsconfig.json) | Host: everything in `src/` except `src/webviews/` | Node, no DOM |
| [src/webviews/tsconfig.json](../../src/webviews/tsconfig.json) | Both webviews and `src/webviews/shared/` | DOM, no Node |
| [tsconfig.test.json](../../tsconfig.test.json) | `*.test.mts` unit tests | DOM + Node (`node:test`) |
| [src/test/integration/tsconfig.json](../../src/test/integration/tsconfig.json) | Integration tests (run in a real VS Code) | Node + mocha |

`npm run verify` runs the type checks, eslint, the unit tests (`node:test` through tsx), the
bundle, and the webview tests (built bundles in headless Chrome, `src/test/webview/`). `npm run test:integration` runs the mocha suites in a real VS Code extension host, driving
the providers through the test API that `activate()` returns. CI runs both on every push and PR;
see [AGENTS.md](../../AGENTS.md) for when to run what.

---

## Known structural debt

- UI logic is concentrated in a few very large files: `spreadsheetWebview.ts`, `mdWebview.ts`,
  `livePreview/tableWidget.ts`, and `spreadsheetEditorProvider.ts`. Don't read them end-to-end; use
  [MAP-spreadsheetWebview.md](MAP-spreadsheetWebview.md) and [MAP-mdWebview.md](MAP-mdWebview.md)
  and grep for symbols.
- Internal IDs still carry upstream `xlsxViewer` / `xlsx-viewer` branding; renaming is deferred
  because the strings are load-bearing across `package.json` + `extension.ts` (and users' settings).
- External-file watching is centralized in `fileExternalChangeWatcher.ts`; extend there when
  touching disk-sync (not inline per-provider watchers).
