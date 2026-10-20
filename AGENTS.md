# AGENTS.md: agent working guide

Sheetmark is a VS Code extension with custom editors for spreadsheets (`.xlsx`/`.csv`/`.tsv`) and
Markdown (`.md`). It started as a fork of upstream `xlsx-viewer` v1.9.91 and is published as
`iggyinc.sheetmark`. TypeScript, bundled with esbuild. Read this file fully before editing.

**Verify every change with `npm run verify`** (types for all three tsconfigs, lint, unit tests,
bundle). It must end green before you call work done. See §5.

Deep references (load on demand):

| Doc | Use it for |
|---|---|
| [.docs/dev/ARCHITECTURE.md](.docs/dev/ARCHITECTURE.md) | Runtime boundary, providers, data model |
| [.docs/dev/MESSAGE-PROTOCOL.md](.docs/dev/MESSAGE-PROTOCOL.md) | Every host ⇄ webview message, both sides |
| [.docs/dev/MAP-spreadsheetWebview.md](.docs/dev/MAP-spreadsheetWebview.md) | Navigating the spreadsheet webview (very large file) |
| [.docs/dev/MAP-mdWebview.md](.docs/dev/MAP-mdWebview.md) | Navigating the Markdown webview and `livePreview/` |
| [CHANGELOG.md](CHANGELOG.md) | Release notes; add user-facing changes under `## Unreleased` |
| [publish-sheetmark skill](.agents/skills/publish-sheetmark/SKILL.md) | Releasing, or installing locally to test in another window |
| [.docs/README.md](.docs/README.md) | Index of everything else (product docs, Idea Lab) |

---

## 1. Two runtimes, enforced by the compiler

Code runs in two places with different globals. Each has its own tsconfig, so using the wrong
runtime's APIs is a compile error, not a runtime surprise.

| | **Extension host** (Node.js) | **Webview** (browser sandbox) |
|---|---|---|
| Files | `src/extension.ts`, `src/*EditorProvider.ts`, `src/shared/**`, `src/spreadsheet/**` | `src/webviews/**` |
| tsconfig | [tsconfig.json](tsconfig.json): Node types, **no DOM** | [src/webviews/tsconfig.json](src/webviews/tsconfig.json): DOM, **no Node types** |
| Bundle | `dist/extension.js` (esbuild, `platform: node`) | `dist/spreadsheet/spreadsheetWebview.js`, `dist/md/mdWebview.js` (`platform: browser`, IIFE) |
| `vscode` | The real VS Code module (`vscode.window`, `Uri`, fs, commands) | **Not available.** `vscode` is the `acquireVsCodeApi()` wrapper in [src/webviews/shared/common.ts](src/webviews/shared/common.ts): only `postMessage` / `getState` / `setState` |
| Can use | Node APIs, `exceljs`, the `vscode` module | DOM, CodeMirror 6, `markdown-it` (TOC, inactive table cells), `mermaid`, `js-yaml`, `typo-js` |

The two sides talk **only** by message passing (`postMessage` ⇄ `onDidReceiveMessage`). Never
import across the boundary (`src/webviews/**` must not import from `src/shared/**` and vice versa);
the one exception is `import type` from `src/protocol/` (§2).

## 2. Messages are typed: change `src/protocol/` first

Every host ⇄ webview message is a member of a union in [src/protocol/](src/protocol/)
(`common.ts`, `spreadsheet.ts`, `markdown.ts`). Both runtimes import these with `import type`;
the files hold types only, the one allowed cross-boundary import. Sends go through typed `post(...)`
helpers and handlers end in exhaustiveness checks, so a typo, a wrong field or a one-sided message
is a compile error.

To add or change a message: edit the union, run `npm run check-types`, and fix every error it
lists (sender, handler, payload). Keep runtime payload validation in host handlers: webview input
is untrusted. Details: [.docs/dev/MESSAGE-PROTOCOL.md](.docs/dev/MESSAGE-PROTOCOL.md).

## 3. Hard DO-NOTs

- **Do not rename the internal IDs** `xlsxViewer.*` (viewTypes) or `xlsx-viewer.*` (command IDs).
  `package.json` `contributes.customEditors[].viewType` / `commands[].command` must match the
  `registerCustomEditorProvider(...)` / `registerCommand(...)` strings in
  [src/extension.ts](src/extension.ts) exactly, or editors and commands silently stop registering.
  Users never see these strings; the rename is deferred on purpose.
- **Do not insert file content into the DOM as HTML without escaping.** Spreadsheet cells and
  Markdown come from untrusted files, and the webviews currently allow inline script. Build
  markup from escaped text.
- **Do not add a webview asset without updating the CSP and `localResourceRoots`.** Assets load
  through `webview.asWebviewUri(...)`, gated by the `Content-Security-Policy` meta tag in
  `getWebviewContent` ([spreadsheetHtmlRenderer.ts](src/spreadsheet/spreadsheetHtmlRenderer.ts) and
  `MDEditorProvider.getWebviewContent` in [mdEditorProvider.ts](src/mdEditorProvider.ts)). Spreadsheet
  roots: `resources/` + `dist/`. Markdown also allows the document's directory, workspace folders
  and ancestor directories (local images). Anything else is silently blocked.
- **Do not bump `@types/vscode` on its own.** It is pinned to the `engines.vscode` floor (1.67) so
  tsc rejects VS Code APIs that older supported versions lack. Raising it means raising `engines` too.
- **Do not change esbuild output paths** without updating the providers, which hardcode
  `dist/spreadsheet/spreadsheetWebview.js` and `dist/md/mdWebview.js`.
- **Do not stage, stash, reset or reformat files you did not change.** The owner often has
  uncommitted work in the tree. Commit only your own files, by path.

## 4. Where to change what

| Want to change… | File(s) |
|---|---|
| Spreadsheet save / autosave payloads (browser) | `src/webviews/spreadsheet/persistence.ts` (shared state in `state.ts`) |
| Spreadsheet grid UI / behavior (browser) | `src/webviews/spreadsheet/spreadsheetWebview.ts` + its split-out modules + `components/` (see [MAP](.docs/dev/MAP-spreadsheetWebview.md)) |
| Spreadsheet file I/O, save, conversion, versions (host) | [src/spreadsheetEditorProvider.ts](src/spreadsheetEditorProvider.ts) |
| Markdown save, autosave, reload, disk-change decisions, version preview (browser) | `src/webviews/md/saveSync.ts` (shared state in `state.ts`) |
| Markdown shell: toolbar, outline, settings, disk diff (browser) | `src/webviews/md/mdWebview.ts` (see [MAP](.docs/dev/MAP-mdWebview.md)) |
| Markdown CM6 live preview + widgets | `src/webviews/md/livePreview/**`, one module per feature, wired in `livePreviewEditor.ts` |
| Markdown file I/O, save, disk sync (host) | [src/mdEditorProvider.ts](src/mdEditorProvider.ts) |
| External file watch (change, delete) | [fileExternalChangeWatcher.ts](src/shared/fileExternalChangeWatcher.ts) |
| Per-file state following a rename/move | [renameStateMigration.ts](src/shared/renameStateMigration.ts), [migrateFileUriState.ts](src/shared/migrateFileUriState.ts) |
| Markdown prefs kept outside the file (column widths, YAML card, mermaid mode, callout default) | [src/shared/preferenceStore.ts](src/shared/preferenceStore.ts) (`createMarkdownPreferences`) |
| CSV/TSV style persistence | [src/shared/styleStorageService.ts](src/shared/styleStorageService.ts) |
| File conversion csv ↔ tsv ↔ xlsx | [src/shared/fileConversionService.ts](src/shared/fileConversionService.ts) |
| Version history / rollback | [src/shared/versionHistory.ts](src/shared/versionHistory.ts) |
| Any host ⇄ webview message | [src/protocol/](src/protocol/) first, then the errors `check-types` reports |
| Commands, activation, provider registration | [src/extension.ts](src/extension.ts) |
| User-visible settings | `contributes.configuration` in [package.json](package.json) |
| Shared webview building blocks (theme, toolbar, settings, menus, virtual scroll) | `src/webviews/shared/**` (see [guide.md](src/webviews/shared/guide.md)) |
| Static styling | `resources/**/*.css` |

**Large files: do not read end-to-end.** Use the MAPs and grep for symbol names:
`spreadsheetWebview.ts`, `spreadsheetEditorProvider.ts`, `mdWebview.ts`, `livePreview/tableWidget.ts`.

## 5. Build and verify

```bash
npm install               # once
npm run verify            # REQUIRED before calling work done: check-types + lint + test:unit + bundle + test:webview
npm run test:integration  # REQUIRED when you touch src/*.ts, src/shared/** or src/spreadsheet/** (real VS Code, ~30 s)
npm run test:unit         # unit tests only (node:test through tsx)
npm run test:webview      # built webviews in headless Chrome (needs Chrome or Edge installed)
node --import tsx --test src/webviews/md/livePreview/tableWidget.test.mts   # one test file
npm run test:regressions  # re-breaks each past fix and checks a test fails (slow; run after fixing a bug)
npm run watch             # watch build; what F5 uses
npm run package           # production build (also runs unit tests); used by vsce on release
```

- `check-types` runs four projects: `tsconfig.json` (host), `src/webviews/tsconfig.json`
  (webviews), `tsconfig.test.json` (unit tests), `src/test/integration/tsconfig.json`, all with
  `noUnusedLocals`: delete dead code instead of leaving it. Lint has zero warnings; keep it that way.
- **Unit tests** are co-located `*.test.mts` files testing pure functions headlessly (node:test, no
  VS Code). For CM6 code, build an `EditorState`, call the `computeXxx` function, assert on the
  result, and wrap states in `fullyParsed(...)` from `livePreview/testState.ts` (CM6 only parses
  for 20 ms per state, so a cold parse can return a partial tree and flake). For DOM-producing code,
  set `globalThis.document` from `linkedom` before importing (see
  `spreadsheetRenderComponent.test.mts`). New logic should be a pure function with a test next to it.
- **Integration tests** (`src/test/integration/*.test.ts`, mocha `suite`/`test`) run in a real
  VS Code via `@vscode/test-cli` (`.vscode-test.mjs`; the first run downloads VS Code into
  `.vscode-test/`). In test mode only, `activate()` returns a test API (`SheetmarkTestApi` in `extension.ts`):
  `openEditors()` gives each open panel plus `dispatch(message)`, which delivers a message to the
  host exactly as the webview would and resolves when it is handled. Use it to test saves, history,
  links, CSP and commands against real files (see `helpers.ts`).
- **Webview tests** (`src/test/webview/*.spec.mts`) load the built bundles from `dist/` in headless
  Chrome with the real HTML shell and CSP (`src/shared/webviewHtml.ts`) and a stubbed
  `acquireVsCodeApi`. `harness.mts` gives `send(hostMessage)`, `posted()` / `waitForPosted(command)`
  and `problems()` (CSP violations, page errors). Use them for anything in the webview UI:
  rendering, paste, keyboard, listeners, real-browser security checks. Tests act as the host, for
  example answering `getRows` (see `spreadsheet.spec.mts`).
- **Every bug fix gets a test that fails without the fix**, plus an entry in
  [scripts/check-regression-tests.mjs](scripts/check-regression-tests.mjs) that re-breaks it.
  Untestable fixes are listed there as `knownGap` so the gap stays visible.
- **Manual smoke test** for what no test sees yet (visual layout, VS Code theming): **F5** opens an Extension
  Development Host on [samples/](samples/) → open `test.xlsx` / `.csv` / `.tsv` / `.md` → exercise
  the change → `Cmd+R` to reload after edits.
- When reporting results, say exactly what ran ("verify + integration green, smoke-tested table
  paste") rather than "all tests pass".
- CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs `verify` and the integration tests
  on every push to `main` and every PR.

## 6. Workflow conventions

- **Branches:** work on a branch, not `main`. Releases publish from pushed `main` only.
- **Commits:** imperative, sentence case, describes the user-visible effect
  ("Fix drag-to-select on hanging-indent list lines."). Releases use `chore: release vX.Y.Z`.
- **Changelog:** every user-facing change gets a bullet under `## Unreleased` in
  [CHANGELOG.md](CHANGELOG.md), written for users (where, what they do, what happens) in 1 to 3
  sentences. The release flow turns `Unreleased` into a version heading.
- **Releases and local installs:** follow the [publish-sheetmark skill](.agents/skills/publish-sheetmark/SKILL.md).
  Never print `VSCE_PAT` / `OVSX_PAT` values.
- **Idea Lab:** feature ideas move through `.docs/ideas/1-to-brainstorm` → `2-to-plan` →
  `3-to-implement` → `4-to-qa` → `5-completed`, driven by the `mii-idea-lab` skill. When you ship
  an idea, move its file forward.
- **Skills** live in `.agents/skills/` (`.claude/skills` and `.codex/skills` are symlinks to it).
  `mii-idea-lab` is a symlink into the `.docs/mii-ai` git submodule (`isnacho/mii-ai-resources`):
  edits there must be committed and pushed inside the submodule (GitHub account `isnacho`; locally
  `gh auth switch --user nachosdesign`), then the submodule pointer
  bumped in this repo.
- **Docs:** point at symbols (function, class, handler names), never line numbers, and don't
  record file sizes. Both drift within weeks. When you add a file or a message, update the MAP or
  MESSAGE-PROTOCOL doc in the same change.

## 7. Data model quick facts

- **Two providers, both `CustomReadonlyEditorProvider`**: they open and save themselves through
  `resolveCustomEditor` / `vscode.workspace.fs.writeFile`, not `CustomTextEditor`.
  `SpreadsheetEditorProvider` serves `xlsxViewer.xlsx/.csv/.tsv`; `MDEditorProvider` serves `xlsxViewer.md`.
- **Markdown editing** is CM6 live preview only. `state.currentContent` (`src/webviews/md/state.ts`)
  is the single source of truth for save and disk reload.
- **External disk sync** uses `fileExternalChangeWatcher.ts` (change, debounced delete).
- **Renames:** VS Code closes an open Sheetmark editor when its file is renamed and opens a new one
  at the new path. Per-file state (styles, view mode, Markdown prefs, version history) moves in
  `onWillRenameFiles` (`renameStateMigration.ts`), which VS Code waits for, so the new editor finds
  it. Don't add in-panel move handling: that panel is already closing.
- **Large tables are virtualized**: the webview requests row windows (`getRows` → `rowsData`) and
  never holds the whole file. Tunables are in `VirtualScrollConfig` ([common.ts](src/webviews/shared/common.ts)).
- **CSV/TSV can't store styles**, so styled mode persists formatting in extension state via
  `StyleStorageService` (keyed `row:col`), separate from the file bytes. XLSX stores styles natively.
- **Version history** snapshots live under `context.globalStorageUri`, indexed per file.
- Settings are read host-side and pushed to the webview as `initSettings` / `settingsUpdated`.
