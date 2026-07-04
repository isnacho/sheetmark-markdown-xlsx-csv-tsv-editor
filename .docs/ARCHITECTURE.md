# Architecture

The "why" behind the layout. For hard rules and the change-map see [CLAUDE.md](../CLAUDE.md);
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
│     • commands  xlsx-viewer.*  (goBackTo*, convertFile, toggle*Association)     │
│                                                                                 │
│  Has: fs, path, exceljs, the real `vscode` module, globalStorage, settings      │
└───────────────┬─────────────────────────────────────────────────────────────┘
                │  webview.postMessage(...)  ▲   ▼  onDidReceiveMessage(...)
                │  ( untyped {command,...} — see MESSAGE-PROTOCOL.md )
┌───────────────▼─────────────────────────── WEBVIEW (browser sandbox) ──────────┐
│ dist/spreadsheet/spreadsheetWebview.js   dist/md/mdWebview.js  (platform:browser)│
│                                                                                 │
│  HTML shell (getWebviewContent) + CSP + asWebviewUri assets                     │
│  `vscode` = acquireVsCodeApi()  (postMessage/getState/setState ONLY)            │
│  Has: DOM, window, markdown-it, mermaid, highlight.js. NO fs / node / vscode mod │
└─────────────────────────────────────────────────────────────────────────────┘
```

Two esbuild builds ([esbuild.js](../esbuild.js)) produce these bundles. `resources/**` (CSS, SVG,
PNG) are static, loaded into the webview via `asWebviewUri` under the CSP. The boundary is a hard
process boundary: **no shared mutable state, no cross-calls — only messages.**

---

## Providers are `CustomEditorProvider` (not `CustomTextEditor`)

Both providers own their document model and save path themselves — VS Code does not manage a
`TextDocument` for them. Registration ([extension.ts:278](../src/extension.ts#L278)) uses
`retainContextWhenHidden: true` (webview state survives tab switches) and
`supportsMultipleEditorsPerDocument: false`.

`SpreadsheetEditorProvider` backs **three** viewTypes with one instance — file type is detected from
the extension (`detectTabularFileType`) and branches internally.

### `resolveCustomEditor` lifecycle (both providers)

1. Set `webview.options` — `enableScripts: true`, `localResourceRoots: [resources/, dist/]`.
   Assets outside these roots cannot load.
2. `webview.html = getWebviewContent(...)` — the shell with CSP + script/style URIs. Shows a
   loading overlay immediately.
3. Register `onDidReceiveMessage` — the host's half of the protocol.
4. Webview boots, posts `webviewReady`; the host replies with the init payload
   (`initVirtualTable` / `initMarkdown`) + `initSettings` + `setTheme`.
5. Steady state: user actions in the webview post commands; the host mutates the file / state and
   posts results back.

Spreadsheet shell + CSP: [spreadsheetHtmlRenderer.ts](../src/spreadsheet/spreadsheetHtmlRenderer.ts).
Markdown shell + CSP: `getWebviewContent` in [mdEditorProvider.ts](../src/mdEditorProvider.ts).

---

## Key data flows

### Save (spreadsheet)
Webview collects edits into `{ edits, richEdits, styleEdits, operations }` and posts `saveXlsxEdits`
(manual via `saveEdits`, or debounced via `scheduleAutoSave`). Host applies them (exceljs for XLSX;
delimited write for CSV/TSV), snapshots a version, and posts `saveResult { ok, isAutosave }`.
Autosave behavior is gated by the `xlsxViewer.*.autoSave` / `autoSaveMode` settings.

### Virtualization (large tables)
The webview never holds the whole sheet. On scroll it asks the host for row windows: `requestRows`
→ `getRows` (via [virtualLoader.ts](../src/webviews/shared/virtualLoader.ts)) → host responds
`rowsData { requestId, rows }` → `VirtualLoader.resolveRequest`. Geometry constants
(`ROW_HEIGHT`, `BUFFER_ROWS`, `CHUNK_SIZE`) live in [common.ts](../src/webviews/shared/common.ts).

### Styled mode for CSV/TSV
Delimited files can't store formatting. When a CSV/TSV is put in "styled mode", formatting is kept
in extension state via [StyleStorageService](../src/shared/styleStorageService.ts), keyed `row:col`,
independent of the file bytes. This is why there's a `requestStyleMode` / `styleModeDecision`
handshake and a "styled vs plain" view distinction. XLSX stores styles natively (via exceljs), no
side storage. Styled CSV/TSV formatting can be carried into an XLSX on conversion.

### Conversion
[fileConversionService.ts](../src/shared/fileConversionService.ts) converts csv↔tsv↔xlsx, reachable
from the toolbar (`convertFile`) and the `xlsx-viewer.convertFile` command.

### Version history
[versionHistory.ts](../src/shared/versionHistory.ts) snapshots prior file states under
`context.globalStorageUri`, indexed per file. Flow: `showVersionHistory` → preview
(`versionPreviewMd` / preview mode) → `restoreVersion` or `cancelVersionPreview`.

### Theme & settings & feedback (shared)
Handled in `src/webviews/shared/**` and reused by both editors:
- **Theme** — host posts `setTheme { kind }` (keyed on `message.type`), applied by
  [themeManager.ts](../src/webviews/shared/themeManager.ts). CSS reads VS Code theme variables from
  [resources/shared/theme.css](../resources/shared/theme.css).
- **Settings** — host pushes `initSettings` / `settingsUpdated`; webview edits post `updateSettings`.
  Definitions live in `package.json` `contributes.configuration`; webview handling in
  [settingsManager.ts](../src/webviews/shared/settingsManager.ts).
- **Feedback** — [feedbackModal.ts](../src/webviews/shared/feedbackModal.ts) posts
  `getSystemDetails` / `submitFeedback`, receives `systemDetails` / `feedbackResult`.

---

## Build

[esbuild.js](../esbuild.js) — two contexts: the extension (node, `external:['vscode']`,
`dist/extension.js`) and the webviews (browser IIFE, `dist/spreadsheet/` + `dist/md/`). markdown-it,
mermaid, highlight.js, exceljs etc. are bundled in. `npm run compile` = `tsc --noEmit` (type-check
only; esbuild does the actual transpile) + eslint + esbuild. `tsconfig.json` is `strict`.

There is **no test suite** — see [CLAUDE.md §5](../CLAUDE.md) for the manual verify loop.

---

## Known structural debt

- Two files carry most of the UI logic and are hard to navigate:
  `spreadsheetWebview.ts` (~7.7k), `mdWebview.ts` (~3.7k). Use the MAPs. Split if you touch them heavily.
- The message protocol is stringly-typed across the boundary (see MESSAGE-PROTOCOL.md) — a shared
  typed union would make it compiler-checked.
- Internal IDs still carry upstream `xlsxViewer` / `xlsx-viewer` branding; renaming is deferred
  (see [PLAN.md](PLAN.md)) because the strings are load-bearing across `package.json` + `extension.ts`.
