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
                │  ( untyped {command,...}; see MESSAGE-PROTOCOL.md )
┌───────────────▼─────────────────────────── WEBVIEW (browser sandbox) ──────────┐
│ dist/spreadsheet/spreadsheetWebview.js   dist/md/mdWebview.js  (platform:browser)│
│                                                                                 │
│  HTML shell (getWebviewContent) + CSP + asWebviewUri assets                     │
│  `vscode` = acquireVsCodeApi()  (postMessage/getState/setState ONLY)            │
│  Has: DOM, window, markdown-it (TOC), CodeMirror 6 (MD editor), mermaid, Typo.js│
│  NO fs / node / vscode module                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

Two esbuild builds ([esbuild.js](../../esbuild.js)) produce these bundles. `resources/**` (CSS, SVG,
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
   (`initVirtualTable` / `initMarkdown`) + `initSettings` + `setTheme`.
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
Webview collects edits into `{ edits, richEdits, styleEdits, operations }` and posts `saveXlsxEdits`
(manual via `saveEdits`, or debounced via `scheduleAutoSave`). Host applies them (exceljs for XLSX;
delimited write for CSV/TSV), snapshots a version, and posts `saveResult { ok, isAutosave }`.
Autosave behavior is gated by the `xlsxViewer.*.autoSave` / `autoSaveMode` settings.

### Virtualization (large tables)
The webview never holds the whole sheet. On scroll it asks the host for row windows: `requestRows`
→ `getRows` (via [virtualLoader.ts](../../src/webviews/shared/virtualLoader.ts)) → host responds
`rowsData { requestId, rows }` → `VirtualLoader.resolveRequest`. Geometry constants
(`ROW_HEIGHT`, `BUFFER_ROWS`, `CHUNK_SIZE`) live in [common.ts](../../src/webviews/shared/common.ts).

### Styled mode for CSV/TSV
Delimited files can't store formatting. When a CSV/TSV is put in "styled mode", formatting is kept
in extension state via [StyleStorageService](../../src/shared/styleStorageService.ts), keyed `row:col`,
independent of the file bytes. This is why there's a `requestStyleMode` / `styleModeDecision`
handshake and a "styled vs plain" view distinction. XLSX stores styles natively (via exceljs), no
side storage. Styled CSV/TSV formatting can be carried into an XLSX on conversion.

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
Both are large: navigate with [MAP-mdWebview.md](MAP-mdWebview.md). `currentContent` in
`mdWebview.ts` is the single source of truth: CM6 writes into it through its `onDocChanged`
callback and `getActiveEditorContent()` reads it. Outline/TOC still uses markdown-it token parsing;
document rendering is CM6, not a static HTML preview.

### Markdown per-file / global preferences (extension state)
Persisted outside the `.md` bytes via small storage services keyed by document URI (or global for
editor-wide defaults):

| Service | Keyed by | Stores |
|---|---|---|
| [tableColumnWidthStorageService.ts](../../src/shared/tableColumnWidthStorageService.ts) | file URI | Table column widths (order-index → px) |
| [frontmatterPanelStorageService.ts](../../src/shared/frontmatterPanelStorageService.ts) | file URI | YAML card collapsed state |
| [mermaidPreviewModeStorageService.ts](../../src/shared/mermaidPreviewModeStorageService.ts) | global | Mermaid diagram vs code preview |
| [calloutDefaultTypeStorageService.ts](../../src/shared/calloutDefaultTypeStorageService.ts) | global | Default callout type slug |

Loaded into `initMarkdown` / `diskChangedExternally`; webview persists edits via
`saveTableColumnWidths`, `saveFrontmatterPanelCollapsed`, `saveMermaidPreviewMode`,
`saveCalloutDefaultType`.

### External disk changes
**Markdown:** `createExternalFileChangeWatcher` in
[fileExternalChangeWatcher.ts](../../src/shared/fileExternalChangeWatcher.ts): change →
`diskChangedExternally`; debounced delete → `diskDeletedExternally`; rename (`onDidRenameFiles`) →
`migrateFileUriState` + `diskMovedExternally` + watcher `repoint`. The webview shows persistent
toasts; dirty edits require confirm before reload. With the diff-review setting on, the change opens
a disk-vs-editor diff instead (see the disk-diff cluster in [MAP-mdWebview.md](MAP-mdWebview.md) and
the UX flowchart in [flow.md](../flow.md)). `saveMarkdown` has a host-side conflict check →
`saveConflict`. `requestFreshData` triggers a manual re-read.

**Spreadsheet:** same watcher: change reloads and re-sends `initVirtualTable`; delete →
`diskDeletedExternally`; move → `migrateFileUriState` + `diskMovedExternally`.

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

[esbuild.js](../../esbuild.js): two contexts, the extension (node, `external:['vscode']`,
`dist/extension.js`) and the webviews (browser IIFE, `dist/spreadsheet/` + `dist/md/`). markdown-it,
mermaid, CodeMirror 6, Typo.js, exceljs, and the rest are bundled in. tsc only type-checks;
esbuild does the transpile.

Type checking is split by runtime so the boundary above is compiler-enforced:

| Project | Covers | Globals |
|---|---|---|
| [tsconfig.json](../../tsconfig.json) | Host: everything in `src/` except `src/webviews/` | Node, no DOM |
| [src/webviews/tsconfig.json](../../src/webviews/tsconfig.json) | Both webviews and `src/webviews/shared/` | DOM, no Node |
| [tsconfig.test.json](../../tsconfig.test.json) | `*.test.mts` unit tests | DOM + Node (`node:test`) |

`npm run verify` runs all three, eslint, the unit tests (`node:test` through tsx) and the bundle; CI
runs it on every push and PR. There is **no extension-host integration test**; see
[AGENTS.md](../../AGENTS.md) for the manual smoke test. Unit tests exist only for Markdown webview
modules today.

---

## Known structural debt

- UI logic is concentrated in a few very large files: `spreadsheetWebview.ts`, `mdWebview.ts`,
  `livePreview/tableWidget.ts`, and `spreadsheetEditorProvider.ts`. Don't read them end-to-end; use
  [MAP-spreadsheetWebview.md](MAP-spreadsheetWebview.md) and [MAP-mdWebview.md](MAP-mdWebview.md)
  and grep for symbols.
- The message protocol is stringly-typed across the boundary (see MESSAGE-PROTOCOL.md); a shared
  typed union would make it compiler-checked.
- Internal IDs still carry upstream `xlsxViewer` / `xlsx-viewer` branding; renaming is deferred
  because the strings are load-bearing across `package.json` + `extension.ts` (and users' settings).
- External-file watching is centralized in `fileExternalChangeWatcher.ts`; extend there when
  touching disk-sync (not inline per-provider watchers).
