# Navigation map: spreadsheet webview

[src/webviews/spreadsheet/spreadsheetWebview.ts](../../src/webviews/spreadsheet/spreadsheetWebview.ts)
runs in the **webview (browser)** for xlsx, csv, and tsv files. It is one big IIFE and is still very large:
do not read it end-to-end. Several areas already live in their own modules (next section). Find the cluster below, grep for a listed symbol, and read only around it.
This map anchors on function names, not line numbers, because names don't drift.

Runtime context, hard rules, and the message protocol are in [AGENTS.md](../../AGENTS.md) and
[MESSAGE-PROTOCOL.md](MESSAGE-PROTOCOL.md). The file has only two section headers
(`// ===== Virtual Scrolling Configuration =====` and `// ===== Virtual Scrolling Core =====`), so
grep for function names.

## Modules split out of the IIFE

| File | Contains |
|---|---|
| [state.ts](../../src/webviews/spreadsheet/state.ts) | All mutable webview state, accessed as `state.x` (`state.rowCache`, `state.isDataOnly`, `state.currentSettings`, selection sets, undo stacks, popup elements). `MIN_ROW_HEADER_WIDTH` |
| [pendingEdits.ts](../../src/webviews/spreadsheet/pendingEdits.ts), [ledger.ts](../../src/webviews/spreadsheet/ledger.ts) | The edit ledger: unsaved values, rich runs, styles and structure ops per sheet (`recordValue`, `recordOp` with `remapAddress`, `takePayload`, `settleSaved`, `overlayRows`, `snapshot`/`restore`). Pure and unit-tested; `ledger.ts` is the instance plus current-sheet helpers |
| [persistence.ts](../../src/webviews/spreadsheet/persistence.ts) | `recordCellValue`, `recordChange` (autosave debounce), `saveEdits` (one sheet per `saveXlsxEdits`, queued while a save runs, `force`), `onSaveResult`, `onSaveConflictResult`. Gets toolbar refresh and conflict handling via `initPersistence`. Pinned by `spreadsheetEditing.spec.mts` |
| [diskSync.ts](../../src/webviews/spreadsheet/diskSync.ts) | "File changed on disk" toast (Load disk changes, Keep my edits), the conflict confirm, `isDiskChangePending` (autosave waits). Pinned by `spreadsheetDiskSync.spec.mts` |
| [cellValues.ts](../../src/webviews/spreadsheet/cellValues.ts) | `getCellType`, `getCellNormalizedValue`, `getOrCreateRowCellData`, value normalizers (`normalizeCellText`, rating, date, boolean) |
| [dataOps.ts](../../src/webviews/spreadsheet/dataOps.ts) | Sort and filter: `readCellTextForDataOps`, `compareDataOpValues`, `filterAndSortRows` (unit-tested) |
| [rowMetrics.ts](../../src/webviews/spreadsheet/rowMetrics.ts) | Row-height prefix sums and `rowIndexAtOffset` for virtual scrolling (unit-tested) |
| [rowLayout.ts](../../src/webviews/spreadsheet/rowLayout.ts) | The same math bound to `state`: `getRowTopOffset`, `getRowHeightRange`, `findRowIndexByOffset`, `invalidateRowMetrics`, `getMutableRowsSnapshot` |
| [styleEdits.ts](../../src/webviews/spreadsheet/styleEdits.ts) | `styleToRendererCss`, `normalizeStyleForStorage` (unit-tested), `recordCellStyleEdit` / `recordLogicalStyleEdit` (record style edits into the ledger), `applyStyleToCellData` |
| [undo.ts](../../src/webviews/spreadsheet/undo.ts) | Undo/redo, one stack pair per sheet (`switchUndoSheet`): `captureCellUndoState`, `captureWorksheetStateSnapshot`, `pushEditUndoEntry` (cells), `pushValuesUndoEntry` (paste, clear), `pushSheetUndoEntry` (structure), `undoEditAction`, `redoEditAction` (both record into the ledger), `dropUnrecoverableUndoEntries`. Gets four helpers (selection, menu, re-render, find highlights) via `initUndo` |
| [interactiveControls.ts](../../src/webviews/spreadsheet/interactiveControls.ts) | Checkbox, dropdown, rating and date cells: `applyInteractiveControlState`, `update*CellPresentation`, the Insert Control and dropdown-options popups, `insertControlIntoSelection`. Gets two helpers via `initInteractiveControls`. Pinned by `spreadsheetControls.spec.mts` |
| [notices.ts](../../src/webviews/spreadsheet/notices.ts) | Merge warning (`confirmMergePreserveTopLeftContent`) and the CSV/TSV legacy-formatting notice (`showLegacyStylesNotice`: Convert to XLSX / Dismiss) |
| [linkPreview.ts](../../src/webviews/spreadsheet/linkPreview.ts) | Hyperlink tooltip (`showLinkTooltipForCell`, sends `openExternal`), `initializeHyperlinkHover`, image preview overlay |
| [ui.ts](../../src/webviews/spreadsheet/ui.ts), [messaging.ts](../../src/webviews/spreadsheet/messaging.ts) | Loading overlay; the typed `post` to the host |

To move more code out, see [scripts/refactor/](../../scripts/refactor/): `cluster-deps.cjs` shows what a group of functions needs from the rest of the file, and `move-functions.cjs` moves it and fixes the imports.

## Responsibility clusters still in spreadsheetWebview.ts (in file order)

| Cluster | Grep for |
|---|---|
| Imports and component wiring | top of file; `XlsxSelectionManager`, `XlsxFindManager`, `VirtualLoader` |
| Config | `Virtual Scrolling Configuration`; `virtualLoader` (`new VirtualLoader<any[]>('getRows')`), `selectionManager` (state itself is in `state.ts`) |
| Border and color-preview helpers | `updateColorPreview`, `buildBorderCss`, `syncBorderControlsToUi`, `ensureBorderPopup`, `showBorderPopup`, `hideBorderPopup` |
| Find | `getFindManager`, `navigateFind`, `focusCellByPosition`, `applyFindHighlightsInVisibleCells`, `openFindOverlay` |
| Loading every row before a structure edit | `ensureAllRowsLoadedForStructureEdits`, `rerenderCurrentSheetFromLocalState` |
| Structure operations (insert/delete rows, columns, cells) | `applyStructureOperation`, `applyCellInsertOperation`, `applyCellDeleteOperation`, `persistStructureChange`, `canApplyStructureEdits` |
| Header context menu and column filters | `ensureHeaderContextMenu`, `showHeaderContextMenu`, `hideHeaderContextMenu`, `activeColumnFilters`, `activeSortState` |
| Cell context menu and edit selection | `showCellContextMenu`, `captureEditSelectionRange`, `restoreEditSelectionRange` |
| Inline styling, editable surface and toolbar state | `applyInlineStyleToSelection`, `syncEditableSurface`, `updateToolbarState`, `syncSheetSelectorVisibility`, `switchWorksheet`, `reloadFromDisk`, `discardUnsavedEdits` |
| Settings payload | `consumeIncomingSettingsPayload` (one `settings` per file type; there are no scopes) |
| Edit formatting core | `applyEditFormatting`, `getEditTargetCells`, `applyFormatToLogicalSelection`, `getLogicalSelectionBounds` |
| Align, font, wrap, indent, strikethrough | `applyHorizontalAlign`, `applyVerticalAlign`, `applyFontSize`, `applyFontFamily`, `applyWrapMode`, `applyIndent`, `applyStrikeThrough` |
| Borders | `applyBorderPreset`, `applyBorderColorToSelection`, `applyCurrentBorderMode` |
| Clear formatting and contents | `clearFormattingOnSelection`, `getClearedValueForCellType`, `clearSelectionContents` |
| Merge operations | `queueMergeOperation` (queues `mergeRange` / `unmergeRange` ops) |
| Format painter | `copyFormattingFromCell`, `applyStyleToCellFromPainter`, `toggleFormatPainter` |
| Color palette | `applyCellBackgroundColor`, `applyTextColor`, `ensureColorPalette`, `showColorPalette` |
| Edit-formatting toolbar wiring | `wireEditFormattingControls`, `ensureEditFormattingStrip` (builds row 2, `#formattingToolbar`) |
| Persist edits and autosave | moved to `persistence.ts` |
| Virtual-scroll core, sort and filter | `Virtual Scrolling Core`; `requestRows`, `requestAllRows` (via `VirtualLoader`, sends `getRows`), `rebuildFilteredRows`, `applyDataOpsRowsToViewport` (sort/filter logic: `filterAndSortRows` in `dataOps.ts`) |
| Row rendering and viewport | `createRowHtml`, `adjustColumnWidths`, `setRowHeaderWidth`, `renderVirtualRows`, `updateVisibleRows` |
| Shell, preview banner, worksheet render | `initializeVirtualScrolling`, `createTableShell`, `ensurePreviewBanner` (sends `restoreVersion` / `cancelVersionPreview`), `setVersionPreviewMode`, `renderWorksheet` |
| Resize and auto-fit | `initializeResize`, `autoFitColumn`, `autoFitRow` |
| Selection and clipboard | `selectCell`, `selectRange`, `selectRow`, `selectColumn`, `pasteTextAtSelection` (sends `saveXlsxEdits`) |
| Selection interaction handlers | `initializeSelection` (mouse and keyboard navigation; Escape in version preview sends `cancelVersionPreview`), `startAutoScroll`, `autoScrollLoop` |
| Settings visibility and apply | `syncSettingsVisibilityForFileType`, `applySettings`, `postSettings` (sends `updateSettings`) |
| Cell editing and navigation | `enterCellEditMode`, `exitCellEditMode` (records the value into the ledger), `commitControlEdit`, `moveSelection` (multi-line cell text uses `spreadsheetCellTextComponent.ts`) |
| Expanded mode, settings UI, toolbar handlers | `setExpandedMode`, `wireSettingsUI` (sends `enableAsDefault` / `disableDefaultEditor`), `attachHandlersOnce` (toolbar buttons: `showVersionHistory`, `convertFile`, `requestFreshData`) |
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
| spreadsheetToolbarComponent.ts | Row 1 button definitions (Reload, Save, Undo, Redo, Column widths; Find ... Settings at the end). Row 2 is `ensureEditFormattingStrip` | `createXlsxToolbarButtons` |
| spreadsheetFindComponent.ts | Find matches and navigation | `XlsxFindManager`, `XlsxFindMatch` |
| spreadsheetBorderComponent.ts | Border style parse/compose to CSS | `buildBorderCss`, `borderStyleToCss`, `inferBorderModeFromStyle` |
| spreadsheetRichTextComponent.ts | Rich-text runs inside a cell | `getCellRichRuns`, `hasRunFormatting`, `normalizeColorToHex` |
| spreadsheetSettingsComponent.ts | Spreadsheet settings shape and panel definitions | `XlsxViewSettings`, `defaultXlsxViewSettings`, `normalizeXlsxSettings`, `createXlsxSettingsDefinitions` |
| spreadsheetCopyComponent.ts | Copy selection to clipboard | `copySelectionToClipboard`, `writeToClipboardAsync` |
| spreadsheetSheetDataComponent.ts | Row/cell data helpers after structure changes | `getCellFromRow`, `setCellOnRow`, `normalizeRowsAfterStructureChange`, `cloneWorksheetOps` |
| spreadsheetTypes.ts | Shared types for ops, style edits, and undo entries | `StructuralOp`, `WorksheetOp`, `CellStyleEdit`, `EditUndoEntry` |
