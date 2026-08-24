# Message Protocol — host ⇄ webview

The extension host and each webview communicate **only** by `postMessage`, matched on a raw
`command` string. **TypeScript does not check these strings** — a typo or a one-sided edit is a
silent no-op. This is the #1 bug class in the repo. When you add/change a message you MUST wire
**both** the sender and the handler, keep payload field names identical, and update this table.

- **Webview → host** sender: `vscode.postMessage({...})` (the `vscode` wrapper from
  [common.ts](../../src/webviews/shared/common.ts)); handler: `onDidReceiveMessage` in the provider.
- **Host → webview** sender: `webview.postMessage({...})` in the provider; handler: the
  `window.addEventListener('message', ...)` listener in the webview.
- Dispatch is entirely on `message.command`. (`type: 'setTheme'` is the one exception — see note.)

Line numbers are anchors, not guarantees — grep the command string if a line has drifted.

---

## Spreadsheet (`xlsxViewer.xlsx` / `.csv` / `.tsv`)

Sender webview: [spreadsheetWebview.ts](../../src/webviews/spreadsheet/spreadsheetWebview.ts) ·
Provider: [spreadsheetEditorProvider.ts](../../src/spreadsheetEditorProvider.ts)

### Webview → host

| command | Payload | Sender (webview) | Handler (provider) |
|---|---|---|---|
| `webviewReady` | — | :7714 | :1474 |
| `getRows` | `requestId`, range, `sheetIndex` | via `VirtualLoader` ([virtualLoader.ts](../../src/webviews/shared/virtualLoader.ts)), triggered by `requestRows`/`requestAllRows` :4550 | :1656 |
| `saveXlsxEdits` | `sheetIndex`, `edits`, `richEdits`, `styleEdits`, `operations`, `isAutosave` | :4420, :4450, :5691, :7345 | :1805 |
| `updateSettings` | `settingsScope`, `settings` | :6872 | :1592 |
| `requestFreshData` | — | :7489 | :1759 |
| `setPreferredViewMode` | `mode` (`'plain'`\|`'styled'`) | :2107, :7464 | :1744 |
| `requestStyleMode` | — | :2095 | :1769 |
| `styleModeDecision` | `decision` | :941 | :1783 |
| `showVersionHistory` | — | :7474 | :1487 |
| `restoreVersion` | `versionId` | :5182 | :1548 |
| `cancelVersionPreview` | — | :5185, :6403 | :1536 |
| `convertFile` | — | :7482 | :1735 |
| `enableAsDefault` | — | spreadsheet settings `chkOpenByDefault` | :1629 (`enableAsDefault`\|`enableDefaultEditor`) |
| `openExternal` | `url` | :6645 | :1685 |
| `disableDefaultEditor` | — | spreadsheet settings `chkOpenByDefault` | :1636 |
| `getSystemDetails` | — | [feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts) | :1697 |
| `submitFeedback` | feedback fields | [feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts) | :1710 |

> **External disk changes (spreadsheet):** change reloads via `initVirtualTable`. Moves and deletes
> via [fileExternalChangeWatcher.ts](../../src/shared/fileExternalChangeWatcher.ts) (:2352+).

### Host → webview

| command | Payload | Sender (provider) | Handler (webview) |
|---|---|---|---|
| `initVirtualTable` | `worksheets`, `fileType`, `isPlainView`, `rowHeaderWidth`, `previewMode`, `versionId`, `timestamp` | :1319 | :7643 |
| `rowsData` | `requestId`, `rows` | :1661, :1675 | :7637 (→ `VirtualLoader.resolveRequest`) |
| `initSettings` | `settings`, scope | :1289 | :7556 |
| `settingsUpdated` | `settings` | :2313 | :7561 |
| `saveResult` | `ok`, `isAutosave`, `error` (on failure) | :1020, :1809, :1821, :2299, :2301 | :7566 |
| `styleModeActivated` | — | :1772, :1788 | :7611 |
| `showStyleModeNotice` | — | :1775 | :7616 |
| `styleModeCancelled` | — | :1777, :1797, :1799 | :7621 |
| `versionRestoredXlsx` | — | :1577 | :7601 |
| `versionPreviewCancelledXlsx` | — | :1543 | :7606 |
| `versionHistoryError` | `message` | :1492, :1528, :1559, :1582 | :7596 |
| `diskMovedExternally` | `fileName` | move handler :2345 | :7626 |
| `diskDeletedExternally` | — | watcher `onDelete` :2371 | :7631 |
| `setTheme` | `kind` | :1300, :1482 | `ThemeManager` ([themeManager.ts](../../src/webviews/shared/themeManager.ts)) — **not** the main listener; keyed on `message.type` |
| `systemDetails` | details | :1700 | [feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts) |
| `feedbackResult` | `ok` | :1728, :1730 | [feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts) |

> `init` (webview :7673) is a **legacy** handler for an older data shape; the current provider sends
> `initVirtualTable`, not `init`. Leave it unless you're deliberately removing dead paths.

> `toggleView` was removed — dead code; do not reintroduce without wiring both sides.

---

## Markdown (`xlsxViewer.md`)

Sender webview: [mdWebview.ts](../../src/webviews/md/mdWebview.ts) ·
Provider: [mdEditorProvider.ts](../../src/mdEditorProvider.ts)

### Webview → host

| command | Payload | Sender (webview) | Handler (provider) |
|---|---|---|---|
| `webviewReady` | — | :1805 | :157 |
| `saveMarkdown` | `text`, `force` (bypass host disk-conflict check after explicit overwrite confirm), `isAutosave` | :616 | :261 |
| `updateSettings` | `settings` (includes `autoSave`, Document Stats toggles, current-line toggle, `autoShowDiskDiff`, `diffLayout`) | :1119 | :221 |
| `requestFreshData` | — | :724 | :247 |
| `resolveImageUris` | `sources` | :197, :202, :502 | :191 |
| `openExternal` | `url` | :483 | :448 |
| `openRelativeFile` | `href`, `documentUri` | :485 | :459 |
| `showVersionHistory` | — | :1541 | :326 |
| `restoreVersion` | optional `versionId` (webview usually omits — host uses preview id), optional `force` (bypass host disk-conflict check after explicit restore confirm) | :559, :1460 | :405 |
| `cancelVersionPreview` | — | :562 | :382 |
| `saveTableColumnWidths` | `widths` (table order-index → px per column) | :440 | :291 |
| `saveFrontmatterPanelCollapsed` | `collapsed` (boolean) | :326 | :300 |
| `saveMermaidPreviewMode` | `mode` (`diagram` \| `code`) | :331 | :308 |
| `saveCalloutDefaultType` | `type` (slug: `[\w-]+`) | :336 | :317 |
| `enableAsDefault` | — | md settings `chkOpenByDefault` | `enableAsDefault` case |
| `disableDefaultEditor` | — | md settings `chkOpenByDefault` | `disableDefaultEditor` case |
| `getSystemDetails` | — | [feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts) | :486 |
| `submitFeedback` | feedback fields | [feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts) | :499 |

### Host → webview

| command | Payload | Sender (provider) | Handler (webview) |
|---|---|---|---|
| `initMarkdown` | `content` (not `text`), `fileName`, `documentUri`, `documentDirUri`, `workspaceFolderUri`, `tableColumnWidths`, `frontmatterPanelCollapsed`, `mermaidPreviewMode`, `calloutDefaultType` | `buildInitMarkdownPayload` :134, sent e.g. :165 | :1284 |
| `initSettings` | `settings` (includes `autoSave`, live-preview flags, `isDefaultEditor`, Document Stats toggles, current-line toggle, `autoShowDiskDiff`, `diffLayout`) | :178 | :1392 |
| `settingsUpdated` | `settings` (includes `isDefaultEditor`, Document Stats toggles, current-line toggle, `autoShowDiskDiff`, `diffLayout`) | config listener | :1400 |
| `saveResult` | `ok`, `isAutosave`, `error` (on failure) | :283, :285 | :1404 |
| `saveConflict` | — | `saveMarkdown` handler fresh-read mismatch :273 | :1435 |
| `restoreConflict` | `versionId` | `restoreVersion` handler fresh-read mismatch | :1457 |
| `resolvedImageUris` | `resolved` | :212 | :1449 |
| `versionPreviewMd` | `versionId`, `timestamp` | :369 | :1434 |
| `versionPreviewCancelledMd` | — | :396 | :1439 |
| `versionRestoredMd` | `versionId`, `timestamp` | :433 | :1444 |
| `versionHistoryError` | `message` | :330, :375, :398, :416, :437 | :1430 |
| `diskChangedExternally` | same fields as `initMarkdown` (re-read payload) | watcher `onChange` :601, `requestFreshData` :251 | :1309 |
| `diskDeletedExternally` | — | watcher `onDelete` :610 | :1374 |
| `diskMovedExternally` | `fileName`, `documentUri`, `documentDirUri` | `handleMove` :582 | :1380 |
| `reloadFromDiskError` | `message` | `requestFreshData` catch :255, `webviewReady` catch :193 | :1378 |
| `setTheme` | `kind` | :181, :548 | `ThemeManager`; keyed on `message.type` |
| `systemDetails` | details | :490 | [feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts) |
| `feedbackResult` | `ok` | :514, :516 | [feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts) |

> Version preview also re-sends `initMarkdown` with preview content before `versionPreviewMd`
> (:368–370). Restore/cancel similarly re-send `initMarkdown` with live disk content.

---

## Notes

- **Shared-module messages.** `getSystemDetails`/`submitFeedback`/`systemDetails`/`feedbackResult`
  (feedback flow) and `setTheme` (theming) are sent/handled inside `src/webviews/shared/**`
  ([feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts),
  [themeManager.ts](../../src/webviews/shared/themeManager.ts)), not the per-editor webview entry files.
  Both editors reuse them, so a change there hits both.
- **Settings** flow one way at init (`initSettings`) and on host-side change (`settingsUpdated`);
  webview edits flow back via `updateSettings`. Shapes are defined in
  [settingsManager.ts](../../src/webviews/shared/settingsManager.ts) and, for the spreadsheet,
  [spreadsheetSettingsComponent.ts](../../src/webviews/spreadsheet/components/spreadsheetSettingsComponent.ts).
- **Disk-vs-editor diff adds no new commands.** The overlay is entirely webview-side: the
  baseline is `currentContent` captured in the existing `diskChangedExternally` handler and the
  new content already arrives in that message's `content` field. Only the settings payloads gained
  fields (`autoShowDiskDiff`, `diffLayout`). `diffLayout` is the one non-boolean setting, so the
  host's `updateSettings` writer validates it against `'inline' | 'sideBySide'` instead of coercing.
- **External file watching.** Both providers use
  [fileExternalChangeWatcher.ts](../../src/shared/fileExternalChangeWatcher.ts) (VS Code watcher +
  `fs.watch` fallback, debounced delete, `onDidRenameFiles` for moves). URI-keyed extension state
  migrates via [migrateFileUriState.ts](../../src/shared/migrateFileUriState.ts) on move.
- **The durable fix:** these tables drift on every edit. The real remedy is a shared typed
  discriminated union (`src/shared/messages.ts`) imported by both runtimes so the compiler enforces
  the contract. Until that exists, this doc is the source of truth — keep it current.
