# Message Protocol — host ⇄ webview

The extension host and each webview communicate **only** by `postMessage`, matched on a raw
`command` string. **TypeScript does not check these strings** — a typo or a one-sided edit is a
silent no-op. This is the #1 bug class in the repo. When you add/change a message you MUST wire
**both** the sender and the handler, keep payload field names identical, and update this table.

- **Webview → host** sender: `vscode.postMessage({...})` (the `vscode` wrapper from
  [common.ts](../src/webviews/shared/common.ts)); handler: `onDidReceiveMessage` in the provider.
- **Host → webview** sender: `webview.postMessage({...})` in the provider; handler: the
  `window.addEventListener('message', ...)` listener in the webview.
- Dispatch is entirely on `message.command`. (`type: 'setTheme'` is the one exception — see note.)

Line numbers are anchors, not guarantees — grep the command string if a line has drifted.

---

## Spreadsheet (`xlsxViewer.xlsx` / `.csv` / `.tsv`)

Sender webview: [spreadsheetWebview.ts](../src/webviews/spreadsheet/spreadsheetWebview.ts) ·
Provider: [spreadsheetEditorProvider.ts](../src/spreadsheetEditorProvider.ts)

### Webview → host

| command | Payload | Sender (webview) | Handler (provider) |
|---|---|---|---|
| `webviewReady` | — | :7727 | :1474 |
| `getRows` | `requestId`, range | via `VirtualLoader` ([virtualLoader.ts](../src/webviews/shared/virtualLoader.ts)), triggered by `requestRows`/`requestAllRows` :4554 | :1656 |
| `saveXlsxEdits` | `sheetIndex`, `edits`, `richEdits`, `styleEdits`, `operations`, `isAutosave` | :4423, :4453, :5695, :7355 | :1813 |
| `updateSettings` | `settingsScope`, `settings` | :6876 | :1592 |
| `requestFreshData` | — | :7496 | :1767 |
| `toggleView` | `isTableView` | :7416 | :1685 |
| `setPreferredViewMode` | `mode` (`'plain'`\|`'styled'`) | :2113, :7467 | :1752 |
| `requestStyleMode` | — | :2101 | :1777 |
| `styleModeDecision` | `decision` | :942 | :1791 |
| `showVersionHistory` | — | :7477 | :1487 |
| `restoreVersion` | `versionId` | :5186 | :1548 |
| `cancelVersionPreview` | — | :5189, :6407 | :1536 |
| `convertFile` | — | :7489 | :1743 |
| `enableAsDefault` | — | :7492 | :1629 (`enableAsDefault`\|`enableDefaultEditor`) |
| `openExternal` | `url` | :6649 | :1693 |
| `disableDefaultEditor` | — | shared module | :1636 |
| `getSystemDetails` | — | [feedbackModal.ts](../src/webviews/shared/feedbackModal.ts) | :1705 |
| `submitFeedback` | feedback fields | [feedbackModal.ts](../src/webviews/shared/feedbackModal.ts) | :1718 |

### Host → webview

| command | Payload | Sender (provider) | Handler (webview) |
|---|---|---|---|
| `initVirtualTable` | `worksheets`, `fileType`, `isPlainView`, `rowHeaderWidth`, `previewMode`, `versionId`, `timestamp` | :1320 | :7646 |
| `rowsData` | `requestId`, `rows` | :1662 | :7640 (→ `VirtualLoader.resolveRequest`) |
| `initSettings` | `settings`, scope | :1290 | :7569 |
| `settingsUpdated` | `settings` | :2321 | :7574 |
| `saveResult` | `ok`, `isAutosave` | :1020, :1817, :1829, :2307, :2309 | :7579 |
| `styleModeActivated` | — | :1780, :1796 | :7624 |
| `showStyleModeNotice` | — | :1783 | :7629 |
| `styleModeCancelled` | — | :1785, :1805, :1807 | :7634 |
| `versionRestoredXlsx` | — | :1577 | :7614 |
| `versionPreviewCancelledXlsx` | — | :1543 | :7619 |
| `versionHistoryError` | `message` | :1492 | :7609 |
| `setTheme` | `kind` | :1300, :1482 | `ThemeManager` ([themeManager.ts](../src/webviews/shared/themeManager.ts)) — **not** the main listener; keyed on `message.type` |
| `systemDetails` | details | :1709 | [feedbackModal.ts](../src/webviews/shared/feedbackModal.ts) |
| `feedbackResult` | `ok` | :1736, :1738 | [feedbackModal.ts](../src/webviews/shared/feedbackModal.ts) |

> `init` (webview :7686) is a **legacy** handler for an older data shape; the current provider sends
> `initVirtualTable`, not `init`. Leave it unless you're deliberately removing dead paths.

---

## Markdown (`xlsxViewer.md`)

Sender webview: [mdWebview.ts](../src/webviews/md/mdWebview.ts) ·
Provider: [mdEditorProvider.ts](../src/mdEditorProvider.ts)

### Webview → host

| command | Payload | Sender (webview) | Handler (provider) |
|---|---|---|---|
| `webviewReady` | — | :3661 | :137 |
| `saveMarkdown` | `text` | :890 | :253 |
| `updateSettings` | `settings` | :1564 | :214 |
| `requestFreshData` | — | :1791 | :241 |
| `toggleView` | `isPreviewView` | :1811 | :234 |
| `resolveImageUris` | `sources` | :455 | :184 |
| `openExternal` | `url` | :3447 | :389 |
| `openRelativeFile` | `href`, `documentUri` | :3461 | :400 |
| `showVersionHistory` | — | :1902 | :268 |
| `restoreVersion` | — (uses preview id) | :825 | :347 |
| `cancelVersionPreview` | — | :828 | :324 |
| `enableMdEditor` | — | :1782 | :486 |
| `disableMdEditor` | — | :1801 | :465 |
| `toggleMdAssociation` | `enable` | shared module | :509 |
| `saveTableColumnWidths` | `widths` (table order-index -> px per column) | :860 | :274 |
| `getSystemDetails` | — | [feedbackModal.ts](../src/webviews/shared/feedbackModal.ts) | :427 |
| `submitFeedback` | feedback fields | [feedbackModal.ts](../src/webviews/shared/feedbackModal.ts) | :440 |

> MD provider receive line numbers are approximate offsets inside the `switch (message.command)` at
> [mdEditorProvider.ts:134](../src/mdEditorProvider.ts#L134) — grep the case label to confirm.

### Host → webview

| command | Payload | Sender (provider) | Handler (webview) |
|---|---|---|---|
| `initMarkdown` | `text`, `documentUri`, `documentDirUri`, `workspaceFolderUri`, `tableColumnWidths` (persisted table order-index -> px per column, read via `TableColumnWidthStorageService`) | :112 | :1692 |
| `initSettings` | `settings` | :~ | :1706 |
| `settingsUpdated` | `settings` | :~ | :1707 |
| `saveResult` | `ok` | :~ | :1711 |
| `resolvedImageUris` | `resolved` | :205 | :1750 |
| `versionPreviewMd` | `timestamp` | :311 | :1735 |
| `versionPreviewCancelledMd` | — | :~ | :1740 |
| `versionRestoredMd` | — | :374 | :1745 |
| `versionHistoryError` | `message` | :272, :317, :340, :358, :380 | :1731 |
| `diskChangedExternally` | `content`, `fileName`, `documentUri`, `documentDirUri`, `workspaceFolderUri`, `tableColumnWidths` | requestFreshData handler `:256`, FileSystemWatcher.onDidChange `:597` | :2119 |
| `reloadFromDiskError` | `message` | requestFreshData handler (catch) `:260` | :2150 |
| `setTheme` | `kind` | :175, :550 | `ThemeManager`; keyed on `message.type` |
| `systemDetails` | details | :430 | [feedbackModal.ts](../src/webviews/shared/feedbackModal.ts) |
| `feedbackResult` | `ok` | :~ | [feedbackModal.ts](../src/webviews/shared/feedbackModal.ts) |

---

## Notes

- **Shared-module messages.** `getSystemDetails`/`submitFeedback`/`systemDetails`/`feedbackResult`
  (feedback flow) and `setTheme` (theming) are sent/handled inside `src/webviews/shared/**`
  ([feedbackModal.ts](../src/webviews/shared/feedbackModal.ts),
  [themeManager.ts](../src/webviews/shared/themeManager.ts)), not the per-editor webview entry files.
  Both editors reuse them, so a change there hits both.
- **Settings** flow one way at init (`initSettings`) and on host-side change (`settingsUpdated`);
  webview edits flow back via `updateSettings`. Shapes are defined in
  [settingsManager.ts](../src/webviews/shared/settingsManager.ts) and, for the spreadsheet,
  [spreadsheetSettingsComponent.ts](../src/webviews/spreadsheet/components/spreadsheetSettingsComponent.ts).
- **The durable fix:** these tables drift on every edit. The real remedy is a shared typed
  discriminated union (`src/shared/messages.ts`) imported by both runtimes so the compiler enforces
  the contract. Until that exists, this doc is the source of truth — keep it current.
