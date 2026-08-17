# CLAUDE.md — agent working guide

VS Code extension: custom editors for spreadsheets (`.xlsx`/`.csv`/`.tsv`) and Markdown (`.md`).
Fork of upstream `xlsx-viewer` v1.9.91, ~20k lines TypeScript. Read this file fully before editing.

Deep references (load on demand): [.docs/dev/ARCHITECTURE.md](.docs/dev/ARCHITECTURE.md) ·
[.docs/dev/MESSAGE-PROTOCOL.md](.docs/dev/MESSAGE-PROTOCOL.md) ·
[.docs/dev/MAP-spreadsheetWebview.md](.docs/dev/MAP-spreadsheetWebview.md) ·
[.docs/dev/MAP-mdWebview.md](.docs/dev/MAP-mdWebview.md) ·
[changelog](CHANGELOG.md) · roadmap: [.docs/product/PLAN.md](.docs/product/PLAN.md) ·
local dev install/reversal: [.docs/product/LOCAL-DEV-INSTALL.md](.docs/product/LOCAL-DEV-INSTALL.md)

---

## 1. The one thing to internalize: TWO runtimes

Code here runs in **two different places** with different globals. Mixing them is the
most common way to break this repo. `import ... 'vscode'` means two different things.

| | **Extension host** (Node.js) | **Webview** (browser sandbox) |
|---|---|---|
| Files | `src/extension.ts`, `src/*EditorProvider.ts`, `src/shared/**` | `src/webviews/**` |
| Bundle | `dist/extension.js` (esbuild, `platform: node`) | `dist/spreadsheet/*.js`, `dist/md/*.js` (esbuild, `platform: browser`, IIFE) |
| `vscode` | the real VS Code module (`vscode.window`, `Uri`, fs, commands) | **NOT available.** `vscode` = `acquireVsCodeApi()` wrapper from [src/webviews/shared/common.ts](src/webviews/shared/common.ts) — only `postMessage` / `getState` / `setState` |
| Can use | Node APIs (`fs`, `path`), `exceljs`, the `vscode` module | `document`, `window`, DOM, `markdown-it` (TOC), CodeMirror 6, `mermaid` |
| Cannot use | DOM / `window` / `document` | Node APIs, `fs`, `path`, the `vscode` module, `require` |

**They talk ONLY by message passing** (`postMessage` ⇄ `onDidReceiveMessage`). There are no
shared function calls across the boundary. See rule 2.

Rule of thumb before writing a line: *"which runtime is this file in?"* If `src/webviews/**`,
you're in the browser — no Node, no `vscode` module, no `fs`.

---

## 2. The message protocol is untyped strings — wire BOTH sides

Every host⇄webview interaction is a `postMessage({ command: 'x', ... })` matched on the other
end by a raw string compare. **The compiler does NOT check these.** A typo or a one-sided edit
is a silent no-op — the #1 bug class in this codebase.

When you add or change any message:
1. Add the **sender** (`vscode.postMessage(...)` in webview, or `webview.postMessage(...)` in provider).
2. Add the **matching handler** on the other side (a `case`/`if` on the exact same string).
3. Keep the payload field names identical on both ends.
4. Update the table in [.docs/dev/MESSAGE-PROTOCOL.md](.docs/dev/MESSAGE-PROTOCOL.md).

The senders/handlers live in files thousands of lines apart — always grep the counterpart
before assuming it exists. The full inventory is in the protocol doc.

---

## 3. Hard DO-NOTs (each has bitten someone)

- **Do NOT rename the internal IDs** `xlsxViewer.*` (viewTypes) or `xlsx-viewer.*` (command IDs).
  They look like leftover fork branding but are load-bearing: `package.json`
  `contributes.customEditors[].viewType` / `commands[].command` must match the strings in
  [src/extension.ts](src/extension.ts) `registerCustomEditorProvider(...)` / `registerCommand(...)`
  **exactly**. Rename one side only → editors/commands silently stop registering. (Users never
  see these strings; renaming is deferred on purpose — see PLAN.md.)
- **Do NOT hardcode a new asset without updating the CSP + `localResourceRoots`.** Webview assets
  load through `webview.asWebviewUri(...)` and are gated by the `Content-Security-Policy` meta tag
  ([spreadsheetHtmlRenderer.ts:30](src/spreadsheet/spreadsheetHtmlRenderer.ts#L30),
  [mdEditorProvider.ts:630](src/mdEditorProvider.ts#L630)) and `webview.options.localResourceRoots`.
  Spreadsheet: `resources/` + `dist/`. Markdown also allows the document directory, workspace
  folders, and ancestor dirs (local images). Anything outside allowed roots, or a scheme the CSP
  forbids, is silently blocked.
- **Do NOT change the esbuild output paths** without updating the provider references. Providers
  hardcode `dist/spreadsheet/spreadsheetWebview.js` and `dist/md/mdWebview.js`; those must match
  `esbuild.js` `entryPoints` + `outdir`.
- **Do NOT trust `npm test` to verify anything** — there is no test suite (see §5).

---

## 4. Where to change what

| Want to change… | File(s) |
|---|---|
| Spreadsheet grid UI / behavior (browser) | `src/webviews/spreadsheet/spreadsheetWebview.ts` + `components/` — see [MAP](.docs/dev/MAP-spreadsheetWebview.md) |
| Spreadsheet file I/O, save, conversion, versions (host) | [src/spreadsheetEditorProvider.ts](src/spreadsheetEditorProvider.ts) |
| Markdown shell (browser) | `src/webviews/md/mdWebview.ts` — see [MAP](.docs/dev/MAP-mdWebview.md) |
| Markdown CM6 live preview + widgets | `src/webviews/md/livePreview/**` — indexed in [MAP](.docs/dev/MAP-mdWebview.md) |
| Markdown file I/O / save / disk sync (host) | [src/mdEditorProvider.ts](src/mdEditorProvider.ts) |
| External file watch + move detection | [fileExternalChangeWatcher.ts](src/shared/fileExternalChangeWatcher.ts), [migrateFileUriState.ts](src/shared/migrateFileUriState.ts) |
| MD per-file prefs (column widths, YAML card, …) | `src/shared/*StorageService.ts` (table widths, frontmatter, mermaid mode, callout default) |
| File conversion csv↔tsv↔xlsx | [src/shared/fileConversionService.ts](src/shared/fileConversionService.ts) |
| CSV/TSV temporary style persistence | [src/shared/styleStorageService.ts](src/shared/styleStorageService.ts) |
| Version history / rollback | [src/shared/versionHistory.ts](src/shared/versionHistory.ts) |
| Commands, activation, provider registration | [src/extension.ts](src/extension.ts) |
| Marketplace-visible settings | `contributes.configuration` in [package.json](package.json) |
| Shared webview building blocks (theme, toolbar, settings, virtual scroll) | `src/webviews/shared/**` (see [guide.md](src/webviews/shared/guide.md)) |
| Static styling | `resources/**/*.css` |
| The HTML shell + CSP for each webview | [src/spreadsheet/spreadsheetHtmlRenderer.ts](src/spreadsheet/spreadsheetHtmlRenderer.ts), `getWebviewContent` in [src/mdEditorProvider.ts](src/mdEditorProvider.ts) |

Large files — **do not read end-to-end**, use the MAPs:
`spreadsheetWebview.ts` (~7.7k), `mdWebview.ts` (~1.8k shell) + `livePreview/` (~7k, especially
`tableWidget.ts` ~1.8k).

---

## 5. Build & verify loop

```bash
npm install            # once
npm run compile        # check-types (tsc --noEmit) + eslint + esbuild bundle — RUN THIS TO VERIFY
npm run watch          # watch build; what F5 uses
npm run package        # production/minified build (pre-publish)
```

- **Verification = `npm run compile` (0 type + 0 lint errors) THEN a manual smoke test.**
  There is **no extension-host test suite** — `npm test` / `vscode-test` are referenced in
  `package.json` but no host tests exist. CM6 `livePreview/` modules have co-located `*.test.mts`
  unit tests. Do not claim "all tests pass" without specifying scope.
- **Manual smoke test:** press **F5** in VS Code → Extension Development Host opens with a live
  watch build → open a sample file from [samples/](samples/) (`test.xlsx`/`.csv`/`.tsv`/`.md`) →
  exercise your change → `Cmd+R` in the host window to reload after edits.
- Baseline has 5 pre-existing eslint `curly` warnings (not errors); don't be alarmed, don't let it grow.
- After touching webview code, confirm the change actually landed in the reloaded host — a silent
  message-protocol break (rule 2) compiles clean but does nothing.

---

## 6. Data model quick facts

- **Two providers, both `CustomReadonlyEditorProvider`** (open + save via `resolveCustomEditor` /
  `vscode.workspace.fs.writeFile`, not `CustomTextEditor`). `SpreadsheetEditorProvider` serves all
  three tabular viewTypes (`xlsxViewer.xlsx/.csv/.tsv`); `MDEditorProvider` serves `xlsxViewer.md`.
- **Markdown editing** is CM6 live preview only (no legacy reading/split HTML preview). `currentContent`
  in `mdWebview.ts` is the single source of truth for save and disk reload.
- **External disk sync** uses [fileExternalChangeWatcher.ts](src/shared/fileExternalChangeWatcher.ts)
  (change, debounced delete, rename via `onDidRenameFiles`). Moves migrate URI-keyed state via
  [migrateFileUriState.ts](src/shared/migrateFileUriState.ts) and post `diskMovedExternally` to the webview.
- **Large tables are virtualized** — the webview requests row windows from the host
  (`getRows` → `rowsData`); it does not hold the whole file. Row height/buffer/chunk in
  `VirtualScrollConfig` ([common.ts](src/webviews/shared/common.ts)).
- **CSV/TSV can't store styles**, so "styled mode" persists formatting in extension state via
  `StyleStorageService` (keyed `row:col`), separate from the delimited file bytes. XLSX stores
  styles natively.
- **Version history** snapshots live under `context.globalStorageUri`, indexed per file.
- Settings are read host-side and pushed to the webview as `initSettings` / `settingsUpdated`.
