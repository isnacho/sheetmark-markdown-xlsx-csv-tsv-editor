# Message Protocol: host ⇄ webview

The extension host and each webview communicate **only** by `postMessage`, matched on a raw
`command` string. **TypeScript does not check these strings**: a typo or a one-sided edit is a
silent no-op. This is the #1 bug class in the repo. When you add or change a message you MUST wire
**both** the sender and the handler, keep payload field names identical, and update this table.

- **Webview to host** sender: `vscode.postMessage({...})` (the `vscode` wrapper from
  [common.ts](../../src/webviews/shared/common.ts)); handler: `onDidReceiveMessage` in the provider.
- **Host to webview** sender: `webview.postMessage({...})` in the provider; handler: the
  `window.addEventListener('message', ...)` listener in the webview.
- Dispatch is on `message.command`. **Exception:** `setTheme` is sent as `{ type: 'setTheme', kind }`
  and matched on `message.type` (in `ThemeManager.init`), not `command`.

Anchors below are file + enclosing function or handler, never line numbers. To find one, grep the
command string (for example `'saveXlsxEdits'`) in the named file.

---

## Spreadsheet (`xlsxViewer.xlsx` / `.csv` / `.tsv`)

Webview: [spreadsheetWebview.ts](../../src/webviews/spreadsheet/spreadsheetWebview.ts) ·
Provider: [spreadsheetEditorProvider.ts](../../src/spreadsheetEditorProvider.ts)

- **Provider handler:** `webview.onDidReceiveMessage` inside `resolveCustomEditor`, a chain of
  `if (message?.command === '<command>')` blocks. The table names the block by its command.
- **Webview handler:** the `window.addEventListener('message', ...)` listener near the end of the
  IIFE, a chain of `if (message.command === '<command>')` blocks.

### Webview to host

| command | Payload | Sender (webview) | Handler (provider) |
|---|---|---|---|
| `webviewReady` | none | `DOMContentLoaded` listener (bootstrap) | `webviewReady` block (calls `trySendSettings`, `trySendInit`, sends `setTheme`) |
| `getRows` | `requestId`, range, `sheetIndex` | `VirtualLoader.requestRows` ([virtualLoader.ts](../../src/webviews/shared/virtualLoader.ts)), called from `requestRows` / `requestAllRows` | `getRows` block |
| `saveXlsxEdits` | `sheetIndex`, `edits`, `richEdits`, `styleEdits`, `operations`, `isAutosave` | `persistInteractiveControlEdit`, `persistPlainTextEdit`, `pasteTextAtSelection`, `saveEdits` | `saveXlsxEdits` block (CSV/TSV path goes through `saveDelimitedFileAndStyles`) |
| `updateSettings` | `settingsScope`, `settings` | `postSettings` | `updateSettings` block |
| `requestFreshData` | none | `attachHandlersOnce` (reload button) | `requestFreshData` block (`loadWorkbookPayload` + `trySendInit`) |
| `setPreferredViewMode` | `mode` (`'plain'` \| `'styled'`) | `activateStyledMode`, `attachHandlersOnce` (plain/styled toggle) | `setPreferredViewMode` block |
| `requestStyleMode` | none | `requestStyledMode` | `requestStyleMode` block |
| `styleModeDecision` | `decision` | `submitStyleModeDecision` | `styleModeDecision` block |
| `showVersionHistory` | none | `attachHandlersOnce` | `showVersionHistory` block |
| `restoreVersion` | `versionId` | `ensurePreviewBanner` (Restore button) | `restoreVersion` block |
| `cancelVersionPreview` | none | `ensurePreviewBanner` (Cancel button); Escape key in `initializeSelection` | `cancelVersionPreview` block |
| `convertFile` | none | `attachHandlersOnce` | `convertFile` block |
| `enableAsDefault` | none | `wireSettingsUI` (`onOpenByDefaultChange`) | `enableAsDefault` block |
| `disableDefaultEditor` | none | `wireSettingsUI` (`onOpenByDefaultChange`) | `disableDefaultEditor` block |
| `openExternal` | `url` | `showLinkTooltipForCell`; also `FeedbackModal.bindEvents` (GitHub issues button) in [feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts) | `openExternal` block |
| `getSystemDetails` | none | `FeedbackModal.show` ([feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts)) | `getSystemDetails` block |
| `submitFeedback` | feedback fields | `FeedbackModal.submitForm` ([feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts)) | `submitFeedback` block |

> **External disk changes (spreadsheet):** a change reloads via `loadWorkbookPayload` +
> `trySendInit` (re-sends `initVirtualTable`). Moves and deletes come from the
> `createExternalFileChangeWatcher` callbacks ([fileExternalChangeWatcher.ts](../../src/shared/fileExternalChangeWatcher.ts))
> at the end of `resolveCustomEditor`.

### Host to webview

| command | Payload | Sender (provider) | Handler (webview) |
|---|---|---|---|
| `initVirtualTable` | `worksheets`, `fileType`, `isPlainView`, `rowHeaderWidth`, `previewMode`, `versionId`, `timestamp` | `trySendInit` | `initVirtualTable` block |
| `rowsData` | `requestId`, `rows` | `getRows` block | `rowsData` block (calls `virtualLoader.resolveRequest`) |
| `initSettings` | `settings`, `plainSettings`, `styledSettings`, `settingsScope` (from `getPersistedSettings`) | `trySendSettings` | `initSettings` block |
| `settingsUpdated` | same shape as `initSettings` | `onDidChangeConfiguration` listener (`configChangeDisposable`) | `settingsUpdated` block |
| `saveResult` | `ok`, `isAutosave`, `error` (on failure) | `saveXlsxEdits` block; `saveDelimitedFileAndStyles` | `saveResult` block |
| `styleModeActivated` | none | `requestStyleMode` and `styleModeDecision` blocks | `styleModeActivated` block |
| `showStyleModeNotice` | none | `requestStyleMode` block | `showStyleModeNotice` block |
| `styleModeCancelled` | none | `requestStyleMode` and `styleModeDecision` blocks | `styleModeCancelled` block |
| `versionRestoredXlsx` | none | `restoreVersion` block | `versionRestoredXlsx` block |
| `versionPreviewCancelledXlsx` | none | `cancelVersionPreview` block | `versionPreviewCancelledXlsx` block |
| `versionHistoryError` | `message` | `showVersionHistory` and `restoreVersion` blocks | `versionHistoryError` block |
| `diskMovedExternally` | `fileName` | `handleMove` | `diskMovedExternally` block |
| `diskDeletedExternally` | none | watcher `onDelete` callback | `diskDeletedExternally` block |
| `setTheme` | `kind` (discriminator is `type`, not `command`) | `webviewReady` block; `onDidChangeActiveColorTheme` listener | `ThemeManager.init` ([themeManager.ts](../../src/webviews/shared/themeManager.ts)), **not** the main listener |
| `systemDetails` | details | `getSystemDetails` block | `FeedbackModal.initialize` listener ([feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts)) |
| `feedbackResult` | `ok` | `submitFeedback` block | `FeedbackModal.initialize` listener ([feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts)) |

### Removed messages (spreadsheet)

`enableDefaultEditor` (host-only alias), the legacy webview `init` handler (the host sends
`initVirtualTable`) and `toggleView` were one-sided and have been deleted. Do not reintroduce them
without wiring both sides.

---

## Markdown (`xlsxViewer.md`)

Webview: [mdWebview.ts](../../src/webviews/md/mdWebview.ts) ·
Provider: [mdEditorProvider.ts](../../src/mdEditorProvider.ts)

- **Provider handler:** `switch (message.command)` inside `onDidReceiveMessage` in
  `resolveCustomEditor`, one `case '<command>'` per message.
- **Webview handler:** `switch (m.command)` under the `// ===== Message Handler =====` section of
  `mdWebview.ts`, one `case '<command>'` per message.

### Webview to host

| command | Payload | Sender (webview) | Handler (provider) |
|---|---|---|---|
| `webviewReady` | none | `Initialize` section (bootstrap); Retry button in `showInitialLoadError` | `case 'webviewReady'` |
| `saveMarkdown` | `text`, `force` (bypass host disk-conflict check after explicit overwrite confirm), `isAutosave` | `doSave` | `case 'saveMarkdown'` |
| `updateSettings` | `settings` (includes `autoSave`, Document Stats toggles, current-line toggle, `diffReviewEnabled`, `diffLayout`) | `applySettings` (when `persist` is true) | `case 'updateSettings'` |
| `requestFreshData` | none | `requestReloadFromDisk` | `case 'requestFreshData'` |
| `resolveImageUris` | `sources` | `wireImageUriResolver`, `handleLivePreviewModifierClick` | `case 'resolveImageUris'` |
| `openExternal` | `url` | `executeLivePreviewLinkAction`; also `FeedbackModal.bindEvents` (GitHub issues button) in [feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts) | `case 'openExternal'` |
| `openRelativeFile` | `href`, `documentUri` | `executeLivePreviewLinkAction` | `case 'openRelativeFile'` |
| `showVersionHistory` | none | `initializeSettings` (`openVersionHistorySetting` button) | `case 'showVersionHistory'` |
| `restoreVersion` | optional `versionId` (webview usually omits; host uses the preview id), optional `force` (bypass host disk-conflict check after explicit restore confirm) | `ensureVersionPreviewBanner` (Restore button); `case 'restoreConflict'` in the webview handler (resend with `force`) | `case 'restoreVersion'` |
| `cancelVersionPreview` | none | `ensureVersionPreviewBanner` (Cancel button) | `case 'cancelVersionPreview'` |
| `saveTableColumnWidths` | `widths` (table order-index to px per column) | `onColumnWidthsChanged` callback in `enterPreviewEditMode` | `case 'saveTableColumnWidths'` |
| `saveFrontmatterPanelCollapsed` | `collapsed` (boolean) | `persistFrontmatterPanelCollapsed` | `case 'saveFrontmatterPanelCollapsed'` |
| `saveMermaidPreviewMode` | `mode` (`diagram` \| `code`) | `persistMermaidPreviewMode` | `case 'saveMermaidPreviewMode'` |
| `saveCalloutDefaultType` | `type` (slug: `[\w-]+`) | `persistCalloutDefaultType` | `case 'saveCalloutDefaultType'` |
| `enableAsDefault` | none | `initializeSettings` (`chkOpenByDefault`) | `case 'enableAsDefault'` |
| `disableDefaultEditor` | none | `initializeSettings` (`chkOpenByDefault`) | `case 'disableDefaultEditor'` |
| `getSystemDetails` | none | `FeedbackModal.show` ([feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts)) | `case 'getSystemDetails'` |
| `submitFeedback` | feedback fields | `FeedbackModal.submitForm` ([feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts)) | `case 'submitFeedback'` |

### Host to webview

| command | Payload | Sender (provider) | Handler (webview) |
|---|---|---|---|
| `initMarkdown` | `content` (not `text`), `fileName`, `documentUri`, `documentDirUri`, `workspaceFolderUri`, `tableColumnWidths`, `frontmatterPanelCollapsed`, `mermaidPreviewMode`, `calloutDefaultType` | built by `buildInitMarkdownPayload`; sent from `case 'webviewReady'`, `case 'showVersionHistory'` (preview content), `case 'cancelVersionPreview'`, `case 'restoreVersion'` | `case 'initMarkdown'` |
| `initSettings` | `settings` from `buildMdWebviewSettings` (includes `autoSave`, live-preview flags, `isDefaultEditor`, Document Stats toggles, current-line toggle, `diffReviewEnabled`, `diffLayout`) | `case 'webviewReady'` | `case 'initSettings'` |
| `settingsUpdated` | `settings` (same builder) | `onDidChangeConfiguration` listener (`configChangeDisposable`); `case 'enableAsDefault'`; `case 'disableDefaultEditor'` | `case 'settingsUpdated'` |
| `saveResult` | `ok`, `isAutosave`, `error` (on failure) | `case 'saveMarkdown'` | `case 'saveResult'` |
| `saveConflict` | none | `case 'saveMarkdown'` (fresh-read mismatch) | `case 'saveConflict'` |
| `restoreConflict` | `versionId` | `case 'restoreVersion'` (fresh-read mismatch) | `case 'restoreConflict'` |
| `resolvedImageUris` | `resolved` | `case 'resolveImageUris'` | `case 'resolvedImageUris'` |
| `versionPreviewMd` | `versionId`, `timestamp` | `case 'showVersionHistory'` | `case 'versionPreviewMd'` |
| `versionPreviewCancelledMd` | none | `case 'cancelVersionPreview'` | `case 'versionPreviewCancelledMd'` |
| `versionRestoredMd` | `versionId`, `timestamp` | `case 'restoreVersion'` | `case 'versionRestoredMd'` |
| `versionHistoryError` | `message` | `case 'showVersionHistory'`, `case 'cancelVersionPreview'`, `case 'restoreVersion'` | `case 'versionHistoryError'` |
| `diskChangedExternally` | same fields as `initMarkdown` (re-read payload) | watcher `onChange` callback; `case 'requestFreshData'` | `case 'diskChangedExternally'` |
| `diskDeletedExternally` | none | watcher `onDelete` callback | `case 'diskDeletedExternally'` |
| `diskMovedExternally` | `fileName`, `documentUri`, `documentDirUri` | `handleMove` | `case 'diskMovedExternally'` |
| `reloadFromDiskError` | `message` | `case 'requestFreshData'` catch; `case 'webviewReady'` catch | `case 'reloadFromDiskError'` |
| `openRelativeFileFailed` | `message` | `case 'openRelativeFile'` (missing file or open error) | `case 'openRelativeFileFailed'` |
| `acceptAllDiskChanges` | none | `xlsx-viewer.md.acceptAllDiskChanges` command in `activate` ([extension.ts](../../src/extension.ts)) calls `MDEditorProvider.postCommandToActivePanel` | `case 'acceptAllDiskChanges'` |
| `rejectAllDiskChanges` | none | `xlsx-viewer.md.rejectAllDiskChanges` command in `activate` ([extension.ts](../../src/extension.ts)) calls `MDEditorProvider.postCommandToActivePanel` | `case 'rejectAllDiskChanges'` |
| `setTheme` | `kind` (discriminator is `type`, not `command`) | `case 'webviewReady'`; `onDidChangeActiveColorTheme` listener (`themeChangeDisposable`) | `ThemeManager.init` ([themeManager.ts](../../src/webviews/shared/themeManager.ts)) |
| `systemDetails` | details | `case 'getSystemDetails'` | `FeedbackModal.initialize` listener ([feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts)) |
| `feedbackResult` | `ok` | `case 'submitFeedback'` | `FeedbackModal.initialize` listener ([feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts)) |

> Version preview also re-sends `initMarkdown` with preview content just before `versionPreviewMd`
> (in `case 'showVersionHistory'`). Restore and cancel similarly re-send `initMarkdown` with live
> disk content.

---

## Notes

- **Shared-module messages.** `getSystemDetails` / `submitFeedback` / `systemDetails` /
  `feedbackResult` (feedback flow), the feedback modal's `openExternal`, and `setTheme` (theming)
  are sent or handled inside `src/webviews/shared/**`
  ([feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts),
  [themeManager.ts](../../src/webviews/shared/themeManager.ts)), not the per-editor webview entry
  files. Both editors reuse them, so a change there hits both.
- **Settings** flow one way at init (`initSettings`) and on host-side change (`settingsUpdated`);
  webview edits flow back via `updateSettings`. Shapes are defined in
  [settingsManager.ts](../../src/webviews/shared/settingsManager.ts) and, for the spreadsheet,
  [spreadsheetSettingsComponent.ts](../../src/webviews/spreadsheet/components/spreadsheetSettingsComponent.ts).
- **Disk-vs-editor diff.** The overlay itself is entirely webview-side: the baseline is
  `currentContent` captured in the existing `diskChangedExternally` handler, and the new content
  already arrives in that message's `content` field. The settings payloads gained fields
  (`diffReviewEnabled`, `diffLayout`). `diffLayout` is the one non-boolean setting, so the host's
  `updateSettings` writer validates it against `'inline' | 'sideBySide'` instead of coercing.
  The two exceptions are `acceptAllDiskChanges` / `rejectAllDiskChanges` (see the host to webview
  table above): real `contributes.commands` / `keybindings` in package.json, routed through
  `MDEditorProvider`'s tracked `activePanel` (there is no VS Code API to ask "which custom editor
  is focused") rather than through the webview's own message flow. UX flow: [flow.md](../flow.md).
- **External file watching.** Both providers use `createExternalFileChangeWatcher` from
  [fileExternalChangeWatcher.ts](../../src/shared/fileExternalChangeWatcher.ts) (VS Code watcher +
  `fs.watch` fallback, debounced delete, `onDidRenameFiles` for moves). URI-keyed extension state
  migrates via `migrateFileUriState` ([migrateFileUriState.ts](../../src/shared/migrateFileUriState.ts))
  on move.
- **The durable fix:** these tables drift on every edit. The real remedy is a shared typed
  discriminated union (`src/shared/messages.ts`, not yet created) imported by both runtimes so the
  compiler enforces the contract. Until that exists, this doc is the source of truth; keep it
  current.
