# Navigation map — spreadsheetWebview.ts (~7,726 lines)

[src/webviews/spreadsheet/spreadsheetWebview.ts](../../src/webviews/spreadsheet/spreadsheetWebview.ts)
runs in the **webview (browser)**. It's too large to read end-to-end — use this index to jump to
the section you need with `Read(offset, limit)`, then read only that range.

One big IIFE. Runtime context, hard rules, and the message protocol are in
[AGENTS.md](../../AGENTS.md) and [MESSAGE-PROTOCOL.md](MESSAGE-PROTOCOL.md). Line ranges are
approximate — confirm by reading the boundary.

| Lines | Section | Responsibility |
|---|---|---|
| 1–62 | Imports | Shared managers, spreadsheet components, types, helpers |
| 64–252 | Module state & config | IIFE open; virtual-scroll constants, icons, worksheet/selection/edit/resize/settings state, `XlsxSelectionManager` wiring |
| 253–393 | Border/color-preview helpers | Button enable, color preview, border CSS build/sync, border popup |
| 395–632 | Insert-control & dropdown-option popups | Insert-control popup, dropdown-options popup, prompt/edit options |
| 633–844 | Inserted controls | Row cell-data access, control inner HTML, apply to DOM, `insertControlIntoSelection` |
| 846–999 | Merge & style-mode notice popups | Merge-warning popups; style-mode notice; `submitStyleModeDecision` |
| 1000–1084 | Find | `getFindManager`, highlight, `focusCellByPosition`, `runFind`, `navigateFind`, overlay |
| 1085–1203 | Row metrics / virtualization math | Load-all-rows, snapshot, row-height/offset prefix sums, `findRowIndexByOffset` |
| 1204–1477 | Structure operations | `applyStructureOperation`, cell insert/delete shift ops |
| 1478–1824 | Header context menu & filtering | Header menu, per-column filter panel (apply/clear) |
| 1825–1950 | Cell context menu & edit selection range | `showCellContextMenu`, capture/restore edit selection |
| 1951–2028 | Inline styling & plain-view UI state | `applyInlineStyleToSelection`, plain-view/sheet-selector/temp-file toolbar state |
| 2029–2146 | Settings scope & styled-mode gating | Settings resolve/normalize/apply; `requestStyledMode`, `activateStyledMode`, cancel |
| 2147–2365 | Edit formatting core | `applyEditFormatting`, target-cell resolution, logical selection bounds |
| 2366–2530 | Style normalization & edit recording | `styleToRendererCss`, `normalizeStyleForStorage`, style edit recording |
| 2531–2710 | Undo/redo | Cell/worksheet state capture & apply, `undoEditAction`/`redoEditAction` |
| 2711–2940 | Align/font/wrap/indent/strike | Horizontal/vertical align, font size/family, wrap, indent, strikethrough |
| 2941–3141 | Borders | `applyBorderPreset`, `applyBorderColorToSelection` |
| 3142–3339 | Clear formatting/contents | Clear formatting, per-type clear-value, `clearSelectionContents` |
| 3340–3479 | Merge operations | `queueMergeOperation` (mergeRange/unmergeRange) |
| 3480–3745 | Format painter | Copy/apply formatting, `toggleFormatPainter` |
| 3746–3885 | Color palette | Background/text color, palette show/hide |
| 3886–4171 | Edit-formatting toolbar wiring | `wireEditFormattingControls`, `ensureEditFormattingStrip` |
| 4172–4405 | Cell-type & interactive-control presentation | Date/rating/checkbox/dropdown presentation, control enable state, manual-save reminder |
| 4406–4542 | Persist edits & autosave | `persistInteractiveControlEdit`, `persistPlainTextEdit`, `scheduleAutoSave` (**sends `saveXlsxEdits`**) |
| 4543–4805 | Virtual-scroll core & data ops | `requestRows`/`requestAllRows` (**`getRows`**), sort/filter parse & compare, `rebuildFilteredRows` |
| 4806–5093 | Row rendering & viewport | `createRowHtml`, column/row sizing, `renderVirtualRows`, `updateVisibleRows` |
| 5094–5298 | Init scroll, shell, preview banner, worksheet render | `initializeVirtualScrolling`, `createTableShell`, `renderWorksheet` |
| 5299–5502 | Resize & auto-fit | `initializeResize`, autofit column/row/all |
| 5503–5721 | Selection & clipboard | select cell/range/row/column, copy/paste, `invertColor` |
| 5722–6603 | Selection interaction handlers | `initializeSelection`: mouse/keyboard nav, auto-scroll loop |
| 6604–6781 | Link tooltip, image preview, hyperlink hover | Tooltip build/show/hide, image-preview overlay |
| 6782–6882 | Settings visibility & apply | Setting-item hide/reset, `applySettings`, `postSettings` |
| 6883–7082 | Cell edit mode & navigation | `enterCellEditMode`, `exitCellEditMode`, `moveSelection` |
| 7083–7357 | Edit-mode toggle & save flow | `setEditMode`, `captureOriginalCellValues`, `saveEdits` (**sends `saveXlsxEdits`**) |
| 7358–7538 | Expanded mode, settings UI, handler attach | `setExpandedMode`, `wireSettingsUI`, `attachHandlersOnce` (toolbar buttons + their sends) |
| 7539–7564 | Sheet selector | `populateSheetSelector` |
| 7556–7680 | **Message handler (host→webview)** | Includes `diskMovedExternally` / `diskDeletedExternally`; see [MESSAGE-PROTOCOL.md](MESSAGE-PROTOCOL.md) |
| 7721–7726 | Bootstrap | `DOMContentLoaded` → posts `webviewReady`; IIFE close |

Component files (imported here, live in
[components/](../../src/webviews/spreadsheet/components/)): render, selection, toolbar, find, border,
rich-text, settings, copy, sheet-data, types.
