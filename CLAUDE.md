# CLAUDE.md — agent working guide

VS Code extension: custom editors for spreadsheets (`.xlsx`/`.csv`/`.tsv`) and Markdown (`.md`).
Fork of upstream `xlsx-viewer` v1.9.91, ~20k lines TypeScript. Read this file fully before editing.

Deep references (load on demand): [.docs/ARCHITECTURE.md](.docs/ARCHITECTURE.md) ·
[.docs/MESSAGE-PROTOCOL.md](.docs/MESSAGE-PROTOCOL.md) ·
[.docs/MAP-spreadsheetWebview.md](.docs/MAP-spreadsheetWebview.md) ·
[.docs/MAP-mdWebview.md](.docs/MAP-mdWebview.md) · roadmap: [.docs/PLAN.md](.docs/PLAN.md) ·
local dev install/reversal: [.docs/LOCAL-DEV-INSTALL.md](.docs/LOCAL-DEV-INSTALL.md)

---

## 1. The one thing to internalize: TWO runtimes

Code here runs in **two different places** with different globals. Mixing them is the
most common way to break this repo. `import ... 'vscode'` means two different things.

| | **Extension host** (Node.js) | **Webview** (browser sandbox) |
|---|---|---|
| Files | `src/extension.ts`, `src/*EditorProvider.ts`, `src/shared/**` | `src/webviews/**` |
| Bundle | `dist/extension.js` (esbuild, `platform: node`) | `dist/spreadsheet/*.js`, `dist/md/*.js` (esbuild, `platform: browser`, IIFE) |
| `vscode` | the real VS Code module (`vscode.window`, `Uri`, fs, commands) | **NOT available.** `vscode` = `acquireVsCodeApi()` wrapper from [src/webviews/shared/common.ts](src/webviews/shared/common.ts) — only `postMessage` / `getState` / `setState` |
| Can use | Node APIs (`fs`, `path`), `exceljs`, the `vscode` module | `document`, `window`, DOM, `markdown-it`, `mermaid` |
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
4. Update the table in [.docs/MESSAGE-PROTOCOL.md](.docs/MESSAGE-PROTOCOL.md).

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
  [mdEditorProvider.ts:604](src/mdEditorProvider.ts#L604)) and `webview.options.localResourceRoots`
  (`resources/` + `dist/` only). Anything outside those, or a scheme the CSP forbids, is silently blocked.
- **Do NOT change the esbuild output paths** without updating the provider references. Providers
  hardcode `dist/spreadsheet/spreadsheetWebview.js` and `dist/md/mdWebview.js`; those must match
  `esbuild.js` `entryPoints` + `outdir`.
- **Do NOT trust `npm test` to verify anything** — there is no test suite (see §5).

---

## 4. Where to change what

| Want to change… | File(s) |
|---|---|
| Spreadsheet grid UI / behavior (browser) | `src/webviews/spreadsheet/spreadsheetWebview.ts` + `components/` — see [MAP](.docs/MAP-spreadsheetWebview.md) |
| Spreadsheet file I/O, save, conversion, versions (host) | [src/spreadsheetEditorProvider.ts](src/spreadsheetEditorProvider.ts) |
| Markdown preview/editor (browser) | `src/webviews/md/mdWebview.ts` — see [MAP](.docs/MAP-mdWebview.md) |
| Markdown file I/O / save (host) | [src/mdEditorProvider.ts](src/mdEditorProvider.ts) |
| File conversion csv↔tsv↔xlsx | [src/shared/fileConversionService.ts](src/shared/fileConversionService.ts) |
| CSV/TSV temporary style persistence | [src/shared/styleStorageService.ts](src/shared/styleStorageService.ts) |
| Version history / rollback | [src/shared/versionHistory.ts](src/shared/versionHistory.ts) |
| Commands, activation, provider registration | [src/extension.ts](src/extension.ts) |
| Marketplace-visible settings | `contributes.configuration` in [package.json](package.json) |
| Shared webview building blocks (theme, toolbar, settings, virtual scroll) | `src/webviews/shared/**` (see [guide.md](src/webviews/shared/guide.md)) |
| Static styling | `resources/**/*.css` |
| The HTML shell + CSP for each webview | [src/spreadsheet/spreadsheetHtmlRenderer.ts](src/spreadsheet/spreadsheetHtmlRenderer.ts), `getWebviewContent` in [src/mdEditorProvider.ts](src/mdEditorProvider.ts) |

Two files are huge — **do not read them end-to-end**, use the MAPs to jump:
`spreadsheetWebview.ts` (~7.7k lines), `mdWebview.ts` (~3.7k lines).

---

## 5. Build & verify loop

```bash
npm install            # once
npm run compile        # check-types (tsc --noEmit) + eslint + esbuild bundle — RUN THIS TO VERIFY
npm run watch          # watch build; what F5 uses
npm run package        # production/minified build (pre-publish)
```

- **Verification = `npm run compile` (0 type + 0 lint errors) THEN a manual smoke test.**
  There is **no automated test suite** — `npm test` / `vscode-test` / `mocha` are referenced in
  `package.json` but no test files exist. Do not claim "tests pass."
- **Manual smoke test:** press **F5** in VS Code → Extension Development Host opens with a live
  watch build → open a sample file from [samples/](samples/) (`test.xlsx`/`.csv`/`.tsv`/`.md`) →
  exercise your change → `Cmd+R` in the host window to reload after edits.
- Baseline has 5 pre-existing eslint `curly` warnings (not errors); don't be alarmed, don't let it grow.
- After touching webview code, confirm the change actually landed in the reloaded host — a silent
  message-protocol break (rule 2) compiles clean but does nothing.

---

## 6. Data model quick facts

- **Two providers, both `CustomEditorProvider`** (they own their document + save, not `CustomTextEditor`).
  `SpreadsheetEditorProvider` serves all three tabular viewTypes (`xlsxViewer.xlsx/.csv/.tsv`);
  `MDEditorProvider` serves `xlsxViewer.md`.
- **Large tables are virtualized** — the webview requests row windows from the host
  (`getRows` → `rowsData`); it does not hold the whole file. Row height/buffer/chunk in
  `VirtualScrollConfig` ([common.ts](src/webviews/shared/common.ts)).
- **CSV/TSV can't store styles**, so "styled mode" persists formatting in extension state via
  `StyleStorageService` (keyed `row:col`), separate from the delimited file bytes. XLSX stores
  styles natively.
- **Version history** snapshots live under `context.globalStorageUri`, indexed per file.
- Settings are read host-side and pushed to the webview as `initSettings` / `settingsUpdated`.
