# Navigation map: spreadsheet webview

[src/webviews/spreadsheet/spreadsheetWebview.ts](../../src/webviews/spreadsheet/spreadsheetWebview.ts)
runs in the **webview (browser)** for xlsx, csv, and tsv files. It is one big IIFE and is very large:
do not read it end-to-end. Find the cluster below, grep for a listed symbol, and read only around it.
This map anchors on function names, not line numbers, because names don't drift.

Runtime context, hard rules, and the message protocol are in [AGENTS.md](../../AGENTS.md) and
[MESSAGE-PROTOCOL.md](MESSAGE-PROTOCOL.md). The file has only two section headers
(`// ===== Virtual Scrolling Configuration =====` and `// ===== Virtual Scrolling Core =====`), so
grep for function names.

## Responsibility clusters (in file order)

| Cluster | Grep for |
|---|---|
| Imports and component wiring | top of file; `XlsxSelectionManager`, `XlsxFindManager`, `VirtualLoader` |
| Module state and config | `Virtual Scrolling Configuration`; `virtualLoader` (`new VirtualLoader<any[]>('getRows')`), `worksheetsMeta`, `currentWorksheet`, `rowCache`, `selectionManager`, `currentSettings`, `isEditMode`, `isCellEditing`, `isPlainView`, `isVersionPreviewMode`, `editUndoStack`, `pendingWorksheetOps`, `pendingCellStyleEdits` |
| Border and color-preview helpers | `setButtonsEnabled`, `updateColorPreview`, `buildBorderCss`, `syncBorderControlsToUi`, `ensureBorderPopup`, `showBorderPopup`, `hideBorderPopup` |
| Insert-control and dropdown-option popups | `ensureInsertControlPopup`, `showInsertControlPopup`, `promptDropdownOptions`, `parseDropdownOptionsInput`, `editDropdownOptionsForCell` |
| Inserted controls (checkbox, rating, date, dropdown) | `getOrCreateRowCellData`, `createInsertedControlInnerHtml`, `applyInsertedControlToDomCell`, `insertControlIntoSelection` |
| Merge warning and style-mode notice popups | `ensureMergeWarningPopup`, `confirmMergePreserveTopLeftContent`, `ensureStyleModeNoticePopup`, `showStyleModeNoticePopup`, `submitStyleModeDecision` (sends `styleModeDecision`) |
| Find | `getFindManager`, `runFind`, `navigateFind`, `focusCellByPosition`, `applyFindHighlightsInVisibleCells`, `openFindOverlay`, `closeFindOverlay` |
| Row metrics and virtualization math | `ensureAllRowsLoadedForStructureEdits`, `getMutableRowsSnapshot`, `ensureRowOffsetPrefix`, `getRowTopOffset`, `findRowIndexByOffset`, `invalidateRowMetrics` |
| Structure operations (insert/delete rows, columns, cells) | `applyStructureOperation`, `applyCellInsertOperation`, `applyCellDeleteOperation`, `persistStructureChange`, `canApplyStructureEdits` |
| Header context menu and column filters | `ensureHeaderContextMenu`, `showHeaderContextMenu`, `hideHeaderContextMenu`, `activeColumnFilters`, `activeSortState` |
| Cell context menu and edit selection | `showCellContextMenu`, `captureEditSelectionRange`, `restoreEditSelectionRange` |
| Inline styling and plain-view toolbar state | `applyInlineStyleToSelection`, `syncPlainViewUiState`, `updatePlainViewButtonLabel`, `syncSheetSelectorVisibility`, `syncTemporaryFileToolbarActions` |
| Settings scope and styled-mode gating | `resolveSettingsScope`, `normalizeSettingsForScope`, `applySettingsForScope`, `consumeIncomingSettingsPayload`, `requestStyledMode` (sends `requestStyleMode`), `activateStyledMode` (sends `setPreferredViewMode`), `cancelStyledModeRequest` |
| Edit formatting core | `applyEditFormatting`, `getEditTargetCells`, `applyFormatToLogicalSelection`, `getLogicalSelectionBounds` |
| Style normalization and edit recording | `styleToRendererCss`, `normalizeStyleForStorage`, `recordLogicalStyleEdit`, `recordCellStyleEdit` |
| Undo/redo | `captureCellUndoState`, `captureWorksheetStateSnapshot`, `pushEditUndoEntry`, `pushSheetUndoEntry`, `undoEditAction`, `redoEditAction` |
| Align, font, wrap, indent, strikethrough | `applyHorizontalAlign`, `applyVerticalAlign`, `applyFontSize`, `applyFontFamily`, `applyWrapMode`, `applyIndent`, `applyStrikeThrough` |
| Borders | `applyBorderPreset`, `applyBorderColorToSelection`, `applyCurrentBorderMode` |
| Clear formatting and contents | `clearFormattingOnSelection`, `getClearedValueForCellType`, `clearSelectionContents` |
| Merge operations | `queueMergeOperation` (queues `mergeRange` / `unmergeRange` ops) |
| Format painter | `copyFormattingFromCell`, `applyStyleToCellFromPainter`, `toggleFormatPainter` |
| Color palette | `applyCellBackgroundColor`, `applyTextColor`, `ensureColorPalette`, `showColorPalette` |
| Edit-formatting toolbar wiring | `wireEditFormattingControls`, `ensureEditFormattingStrip`, `reorderToolbarAroundFind` |
| Cell types and interactive-control presentation | `getCellType`, `updateCheckboxCellPresentation`, `updateDropdownCellPresentation`, `updateRatingCellPresentation`, `updateDateCellPresentation`, `applyInteractiveControlState`, `showManualSaveReminderIfNeeded` |
| Persist edits and autosave | `persistInteractiveControlEdit`, `persistPlainTextEdit` (both send `saveXlsxEdits`), `scheduleAutoSave`, `hasPendingXlsxEdits` |
| Virtual-scroll core, sort and filter | `Virtual Scrolling Core`; `requestRows`, `requestAllRows` (via `VirtualLoader`, sends `getRows`), `compareDataOpValues`, `rebuildFilteredRows`, `applyDataOpsRowsToViewport` |
| Row rendering and viewport | `createRowHtml`, `adjustColumnWidths`, `setRowHeaderWidth`, `renderVirtualRows`, `updateVisibleRows` |
| Shell, preview banner, worksheet render | `initializeVirtualScrolling`, `createTableShell`, `ensurePreviewBanner` (sends `restoreVersion` / `cancelVersionPreview`), `setVersionPreviewMode`, `renderWorksheet` |
| Resize and auto-fit | `initializeResize`, `autoFitColumn`, `autoFitRow`, `autoFitAllColumns` |
| Selection and clipboard | `selectCell`, `selectRange`, `selectRow`, `selectColumn`, `copySelection`, `pasteTextAtSelection` (sends `saveXlsxEdits`) |
| Selection interaction handlers | `initializeSelection` (mouse and keyboard navigation; Escape in version preview sends `cancelVersionPreview`), `startAutoScroll`, `autoScrollLoop` |
| Link tooltip, image preview, hyperlink hover | `showLinkTooltipForCell` (sends `openExternal`), `showImagePreview`, `initializeHyperlinkHover` |
| Settings visibility and apply | `hideStyledOnlySettingsForPlainMode`, `applySettings`, `postSettings` (sends `updateSettings`) |
| Cell edit mode and navigation | `enterCellEditMode`, `exitCellEditMode`, `moveSelection` (multi-line cell text uses `spreadsheetCellTextComponent.ts`) |
| Edit-mode toggle and save | `setEditMode`, `captureOriginalCellValues`, `saveEdits` (sends `saveXlsxEdits`) |
| Expanded mode, settings UI, toolbar handlers | `setExpandedMode`, `wireSettingsUI` (sends `enableAsDefault` / `disableDefaultEditor`), `attachHandlersOnce` (toolbar buttons: `showVersionHistory`, `convertFile`, `requestFreshData`, `setPreferredViewMode`) |
| Sheet selector | `populateSheetSelector` |
| **Message handler (host to webview)** | `window.addEventListener('message'`, then one `if (message.command === '<command>')` per message |
| Bootstrap | `DOMContentLoaded` listener, posts `webviewReady` |

## Components

Imported by `spreadsheetWebview.ts`; they live in
[components/](../../src/webviews/spreadsheet/components/).

| File | Responsibility | Grep for |
|---|---|---|
| spreadsheetRenderComponent.ts | Row HTML, cell style CSS, dropdown cell content | `createXlsxRowHtml`, `formatCellStyle`, `renderDropdownCellContent`, `getExcelColumnLabel` |
| spreadsheetCellTextComponent.ts | Multi-line cell text: serialize editable DOM to `\n`, render with line breaks, Shift+Enter insert | `serializeEditableCellText`, `loadEditableCellContent`, `insertLineBreakAtCaret`, `formatCellTextHtml` |
| spreadsheetSelectionComponent.ts | Selection state and bindings | `XlsxSelectionManager`, `XlsxSelectionBindings` |
| spreadsheetToolbarComponent.ts | Toolbar button definitions | `createXlsxToolbarButtons` |
| spreadsheetFindComponent.ts | Find matches and navigation | `XlsxFindManager`, `XlsxFindMatch` |
| spreadsheetBorderComponent.ts | Border style parse/compose to CSS | `buildBorderCss`, `borderStyleToCss`, `inferBorderModeFromStyle` |
| spreadsheetRichTextComponent.ts | Rich-text runs inside a cell | `getCellRichRuns`, `hasRunFormatting`, `normalizeColorToHex` |
| spreadsheetSettingsComponent.ts | Spreadsheet settings shape and panel definitions | `XlsxViewSettings`, `defaultXlsxViewSettings`, `normalizeXlsxSettings`, `createXlsxSettingsDefinitions` |
| spreadsheetCopyComponent.ts | Copy selection to clipboard | `copySelectionToClipboard`, `writeToClipboardAsync` |
| spreadsheetSheetDataComponent.ts | Row/cell data helpers after structure changes | `getCellFromRow`, `setCellOnRow`, `normalizeRowsAfterStructureChange`, `cloneWorksheetOps` |
| spreadsheetTypes.ts | Shared types for ops, style edits, and undo entries | `StructuralOp`, `WorksheetOp`, `CellStyleEdit`, `EditUndoEntry` |
