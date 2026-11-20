---
title: One-mode spreadsheet editor with Markdown parity
slug: spreadsheet-editor-refresh
status: to-implement
created: 2026-11-20
updated: 2026-11-20
---

# One-mode spreadsheet editor with Markdown parity

## Idea

I want to create a new idea that is to improve spreadsheet editors in Sheetmark: CSV, XLSX and TSV.

I want to bring in the latest decisions from .md into it. I haven't focused on improving it and it is about time.

FX, I don't think we need preview/edit mode. There should be only one mode for simplicity.

Have a look and propose improvements.

## Brainstorm

### Decided direction

The spreadsheet editors (XLSX, CSV, TSV) get **one always-editable surface**, as the Markdown
editor did when Reading and Split were removed. Version preview is the only read-only state. The
safety fixes ship with it, because an always-editable grid without them makes losing work more
likely.

Picks: A1 + B1 + C1 + D1 + E1 + F1 + G1 + G2 + G3 + G4, plus the fixed outcomes. Next separate
idea: warn before closing a tab with unsaved edits (needs both editors on VS Code's full custom
editor API). Later: diff review for external spreadsheet changes.

**Why:** today there are two toggles (View/Edit Table and Plain/Styled), four combinations, two
copies of the settings, and XLSX has two different ways to edit. Users have to learn the modes
before they can change a cell. Markdown already proved the single-surface model in this product.

### Phases

| Phase | Contents | Ships as |
|---|---|---|
| 1 | One mode, toolbar, CSV/TSV data-only, XLSX Plain removed, disk safety, settings cleanup | One PR (it is one behaviour change) |
| 2 | Selection stats, sheet tabs, faster open, screenshot tooling + UI review | One PR each |

### Phase 1: one mode

**Editing model (Excel / Google Sheets):**

- Click selects a cell; drag, Shift+click and row/column headers select ranges, as today.
- Typing a character replaces the cell's contents and starts editing it. Enter, F2 or
  double-click edits in place with the caret at the end. Enter commits and moves down, Tab
  commits and moves right, Shift+Enter inserts a line break (as today).
- Escape inside a cell cancels only what was typed in that cell. It never discards other unsaved
  edits.
- Delete or Backspace on a selection clears it.
- Formatting (XLSX) applies to the selection immediately.
- Undo and redo cover the whole session. History is only reset when the file is reloaded from
  disk.
- Checkbox and dropdown cells work with one click, always.
- Structure edits (insert/delete rows, columns, cells), sort, filter and copy/paste are always
  available from the same menus as today.
- Version preview: read-only, keeps its banner (Restore / Cancel) and Escape exits it, as today.

**Toolbar (two rows, like Markdown):**

- Row 1, file actions, left: Reload from Disk, Save, Undo, Redo, then Column widths (Default /
  Expand All). Right end (unchanged order): Find, Version history, Convert, Help, Settings.
- Row 2, formatting, XLSX only: the controls of today's edit strip in today's order (font, size,
  A−/A+, bold, italic, strikethrough, text colour, background colour, horizontal and vertical
  align, borders + thickness + pattern + colour, indent −/+, Merge, Unmerge, Painter, Clear) plus
  Insert (checkbox, dropdown, rating, date) at the end. In a narrow window it stays one row and
  scrolls sideways with a thin visible scrollbar (Markdown decision).
- CSV/TSV have no second row.
- Save is enabled only when there are unsaved edits. Undo/Redo are enabled only when there is
  something to undo/redo. Reload and Save are disabled while a save or reload is running.
- Tooltips: "Reload from Disk", "Save Changes (Ctrl/Cmd+S)", "Undo (Ctrl/Cmd+Z)",
  "Redo (Ctrl/Cmd+Shift+Z)".
- Removed: Edit Table, Cancel, the Plain/Styled toggle, the separate Bold/Italic/colour toolbar
  buttons that duplicated the strip.
- Sheet switching, Version history, Convert, Help and Reload are always visible (today they hide
  while editing).

**CSV/TSV hold data only:**

- No formatting row, no Insert control, no formatting items in context menus. Structure edits,
  sort, filter, find, copy/paste, conversion and version history stay.
- Checkbox, dropdown, rating and date controls are not shown for CSV/TSV; the cell text
  (TRUE/FALSE, the chosen value) stays.
- A file that still has Sheetmark-only styles (they already expire 48 hours after the last
  edit) shows a notice: *"This file has formatting saved only in Sheetmark. CSV files can't
  store formatting, so it is no longer shown. Convert to XLSX to keep it."* Actions:
  **Convert to XLSX**, **Dismiss**. Convert to XLSX keeps the stored styles, merges and
  checkbox/dropdown controls (today's convert drops merges and controls; this idea fixes that).
  Dismiss deletes the stored styles, so the notice does not come back.
- The "Styled mode" notice popup and its flow are removed.

**XLSX Plain view:** removed. XLSX always shows its own formatting.

**Autosave:** one Autosave checkbox per file type. Defaults stay: CSV/TSV on, XLSX off (an XLSX
save rewrites the whole workbook and can drop parts the library doesn't support, such as charts;
an accidental edit should not write that automatically). With autosave off there is no reminder
toast: the enabled Save button is the signal. Manual save shows "Saved"; autosave stays quiet;
a failed autosave still warns.

**Disk changes (Markdown rules, adapted to how spreadsheet saves work):**

- The file watcher never applies a change silently, and own-save echoes are ignored.
- Change detected: a persistent toast *"File changed on disk"* with **Load disk changes**, plus
  **Keep my edits** when there are unsaved edits; no close button.
  - Load disk changes with unsaved edits: confirm "Discard unsaved changes and reload from
    disk?" first; without unsaved edits it applies at once and shows "Reloaded from disk".
  - Keep my edits: confirm *"Save your edits into the changed file? Cells you edited get your
    values; other changes on disk are kept."*, then save. A spreadsheet save writes the edited
    cells into the file as it is on disk, so unlike Markdown it never overwrites the whole file.
  - If disk changes again before the user acts, the toast stays and Load disk changes loads the
    latest version.
- Manual save when the file changed on disk since it was loaded or last saved: the same "Save
  your edits into the changed file?" confirm before writing. Autosave never shows a dialog: it
  shows the toast and pauses until the user picks.
- The Reload from Disk button asks to discard unsaved edits first, or reloads at once when there
  are none. It replaces Cancel as the way to throw edits away.
- File deleted on disk: unchanged.

**Settings removed** (old values ignored silently, no migration notice): Edit Checkbox/Dropdown
Without Edit Mode, Autosave only checkbox/dropdown, Manual Save Popup (Autosave Off), the
separate Plain/Styled settings sets, and the stored preferred view mode.

### Phase 2: Markdown parity add-ons

- **Selection stats pill** (bottom right, same look as Markdown's Document Stats pill): when 2+
  cells are selected it shows `Count 12 · Sum 1,234 · Average 102.8`. Count counts non-empty
  cells; Sum and Average use numeric cells only and hide when there are none. Hidden for a single
  cell. Settings: "Show Selection Stats" with Count, Sum and Average each switchable, all on by
  default. Stats cover the whole selection, including rows not on screen.
- **Sheet tabs** replace the sheet dropdown: a bar along the bottom, one tab per worksheet, click
  to switch, active tab highlighted, scrolls sideways when there are many. Only shown with 2+
  sheets (so never for CSV/TSV). Unsaved edits survive switching sheets and Save writes them all.
  No rename/add/delete in this idea.
- **Faster open:** the first screen of rows and the settings come with the page itself (the
  Markdown `initialMessages` pattern), so the grid shows without a blank page or a half-styled
  flash.
- **Screenshot tooling + UI review:** `npm run shot` and the real-VS-Code UI tests open
  `.xlsx`/`.csv`/`.tsv`; then a spreadsheet UI review like `UI-REVIEW-2026-11-12.md`.

### Out of scope

Warn on tab close with unsaved edits (next idea), diff review of spreadsheet disk changes,
formulas, sheet rename/add/delete, row/column drag reorder.

## Plan

Approved 2026-11-20.

### Why the modes go: bugs found while planning

The modes are mostly an illusion: typing on a selected cell already edits it in every mode except
version preview. Edit Table mainly adds the formatting strip, Insert, and a **second save path**
(edit mode diffs the DOM against `dataset.originalText`; everything else uses
`pendingOutsideControlEdits` plus direct posts). The two paths cause these bugs, which double as
the test checklist for Step 3 and Step 5:

1. With autosave off, an edited cell that is scrolled out and back, or re-entered, drops out of
   the save (`renderVirtualRows` / `enterCellEditMode` re-stamp `originalText`).
2. `onSaveResult` clears *all* pending ops, styles and edits, including ones made while the save
   was in flight or not part of it.
3. Pending edits, styles, ops and undo entries have no sheet index, so switching sheets sends
   them to the wrong sheet.
4. Undo outside edit mode is not saved (except control cells).
5. Cancel saves a cell that is mid-edit.
6. An external disk change silently reloads the grid (watcher `onChange` →
   `loadWorkbookPayload` + `trySendInit`); unsaved edits vanish or get re-applied unseen. No
   save-conflict check exists.

Core design: **one edit ledger per sheet** is the single source of truth for unsaved changes
(the spreadsheet equivalent of Markdown's `currentContent` vs `originalContent`).

### Prerequisite

The owner's uncommitted Markdown fast-open work overlaps files this plan touches
(`CHANGELOG.md`, `scripts/check-regression-tests.mjs`, `src/protocol/common.ts`,
`src/shared/webviewHtml.ts`, `src/shared/commonHostMessages.ts`, `src/shared/editorTestHooks.ts`,
`src/test/webview/harness.mts`, `.docs/dev/*`). Commit (ideally merge) it first, then branch
`spreadsheet-one-mode` from `main`.

### Phase 1: one mode (one PR, one commit per step, `npm run verify` green after each)

Each step lands with its tests; new logic goes in pure modules with co-located `*.test.mts`.

| Step | What | Main files |
|---|---|---|
| 0 | Spreadsheet screenshot tooling (moved up from Phase 2 so visual steps can be checked): harness opens xlsx/csv/tsv (Buffer sources, editor associations, wait for `#xlsxTable td[data-row]`), `shot.mts` strips any extension, new UI spec types + saves + asserts bytes, light/dark shots | `src/test/ui/harness.mts`, `shot.mts`, new `spreadsheetUi.spec.mts` |
| 1 | Shared toast and confirm dialog, no behaviour change. `Utils.showToast` becomes a wrapper so its call sites stay | `src/webviews/md/toast.ts` → `src/webviews/shared/toast.ts`; `confirmModal` → `src/webviews/shared/confirmModal.ts`; toast CSS → `resources/shared/theme.css`; `src/webviews/shared/utils.ts`, `guide.md` |
| 2 | Drop Plain/Styled and the settings scopes; CSV/TSV data-only; legacy-styles notice; convert keeps merges + controls; remove 3 settings | `src/protocol/spreadsheet.ts`, `src/spreadsheetEditorProvider.ts` (one `getSettings(fileType)`, no stored styles in CSV payload, `legacyStylesNotice`, `convertToXlsx`, `dismissLegacyStyles`), `src/spreadsheet/excelStyle.ts` (`applyStoredStylesToWorksheet` + merges/controls), `src/shared/styleStorageService.ts` (drop preferred view mode), `package.json`, webview `state.isDataOnly`, `notices.ts`, `spreadsheetRenderComponent.ts` |
| 3 | One editing surface + one edit ledger (riskiest). Ledger per sheet of values, rich runs, styles, ops: `recordX`, `remapForOp`, `takePayload`, `settleSaved` (fixes 2), `overlayRows` on `rowsData` (fixes 1), `isDirty`. One `scheduleSave` / `saveEdits`; delete `isEditMode`, `setEditMode`, direct posts, reminder toast. Edit-mode gates → `!isVersionPreviewMode`, plain gates → `isDataOnly`. Escape restores only the cell. Undo per sheet, saved (fixes 4); already-saved structure edits undo via inverse ops | new `pendingEdits.ts` + test, new `inverseOps.ts` + test, `persistence.ts`, `undo.ts`, `interactiveControls.ts`, `spreadsheetWebview.ts` |
| 4 | Two-row toolbar. Row 1: Reload from Disk, Save, Undo, Redo, Column widths … Find, History, Convert, Help, Settings. Row 2 (XLSX only): today's strip + Insert in `#formattingToolbar.formatting-toolbar` (Markdown id/class, so tooltips, panel placement and hover-reveal work). Remove mode buttons and mode CSS | `components/spreadsheetToolbarComponent.ts`, `ensureEditFormattingStrip`, `ui.ts`, `resources/spreadsheet/spreadsheetWebview.css`, base `.formatting-toolbar` CSS → `resources/shared/` |
| 5 | Disk sync. Host: SHA-1 baseline of file bytes (set on load and own save); watcher posts `diskChangedExternally` instead of reloading; `saveXlsxEdits.force`, `saveConflict`; `initVirtualTable.reason`. Webview: toast + confirms per spec, autosave pauses on conflict, Reload / Restore confirm when dirty (fixes 6) | `src/spreadsheetEditorProvider.ts`, new pure hash helper in `src/shared/`, `src/protocol/spreadsheet.ts`, new `src/webviews/spreadsheet/diskSync.ts` |
| 6 | Docs + changelog | `MAP-spreadsheetWebview.md`, `MESSAGE-PROTOCOL.md`, `ARCHITECTURE.md`, `AGENTS.md` §7, `CHANGELOG.md` |

Tests to rewrite: the 6 mode-button tests in `spreadsheetEditing.spec.mts`, the
`enterEditMode` helper in `spreadsheetControls.spec.mts`, fixtures in `spreadsheetFixture.mts`
and `spreadsheet.spec.mts`, the styled-CSV rich-text test (move to xlsx, add "CSV renders text
only"), `spreadsheetRenderComponent.test.mts`, `fileMove.test.ts`. New tests: one per bug above,
each with a `scripts/check-regression-tests.mjs` entry; integration tests for conflict, watcher,
own-save echo, convert keeping merges/controls, legacy notice; webview `spreadsheetDiskSync.spec.mts`.
Regression entry `sheet-edit-strip-in-start-group` gets repointed.

### Phase 2: parity add-ons (one PR each)

- **G1 Selection stats:** extend the existing `#selectionInfo` pill (`updateSelectionInfo` in
  `components/spreadsheetSelectionComponent.ts`) with Markdown's `.status-info` look (CSS to
  `resources/shared/theme.css`); pure `selectionStats.ts` + test; selections beyond loaded rows
  use `requestAllRows`. Settings shared across file types (like `fontFamily`):
  `xlsxViewer.spreadsheet.showSelectionStats`, `.selectionStatsShowCount/Sum/Average`.
- **G2 Sheet tabs:** bottom `#sheetTabs` (`role="tablist"`, arrows, Ctrl+PageUp/PageDown)
  replaces `#sheetSelector` / `populateSheetSelector`; the per-sheet ledger keeps edits.
- **G3 Faster open:** generic `serializeInitialMessages`; move `readInitialMessages` /
  `revealAndApplyInitialMessages` to `src/webviews/shared/`; `renderSpreadsheetHtml` embeds
  settings, `initVirtualTable` and the first rows window (nonce in `spreadsheetCsp`); host runs
  `pruneHistory` / `persistVersionSnapshot` after first paint; `VirtualLoader` takes pre-seeded
  rows.
- **G4 UI review:** run `.docs/product/UI-REVIEW-PROMPT.md` adapted to spreadsheets, log in
  `.docs/product/UI-REVIEW-<date>-spreadsheet.md`.

### Verification

- Every step: `npm run verify`. Steps 2, 3, 5: `npm run test:integration`. Steps 0, 2, 4, G1,
  G2: `npm run test:ui` and read the PNGs. End of Phase 1: `npm run test:regressions`.
- Manual F5 smoke on `samples/test.xlsx/.csv/.tsv`: type, Enter/Tab/Escape, Delete, paste,
  insert/delete row then undo after autosave, switch sheets with unsaved edits then Save, format
  (XLSX), checkbox one click, CSV has no formatting row, CSV with stored styles shows the notice
  and Convert keeps merges/controls, external edit (clean and dirty), save into a changed file,
  version preview/restore while dirty, narrow-window toolbar scroll.

### Risks

- Step 3 rewrites the path every edit goes through. Inverse ops for already-saved structure
  edits are the hardest piece; fallback if they slip: drop saved structure entries from the undo
  stack (Undo disables rather than lying) and log a known gap.
- XLSX save still rewrites the workbook through exceljs (can drop charts); autosave stays off
  for XLSX.

## Implementation Log

_Not started._

## QA

_Not started._
