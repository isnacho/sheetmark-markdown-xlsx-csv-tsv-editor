---
title: One-mode spreadsheet editor with Markdown parity
slug: spreadsheet-editor-refresh
status: to-qa
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

Phase 1 (Steps 0 to 6) is implemented on branch `spreadsheet-one-mode`, one commit per step. Phase 2
(selection stats, sheet tabs, faster open, UI review) is not started.

| Step | Commit | What changed |
|---|---|---|
| 0 | c5fc57c | `src/test/ui/harness.mts` opens `.xlsx`/`.csv`/`.tsv` (Buffer or string sources with an extension, editor associations, waits for the first `td` and the loading overlay), `shot.mts` names shots by extension, new `spreadsheetUi.spec.mts` (type + save + file bytes for xlsx/csv/tsv, light/dark shots) |
| 1 | 2a534c9 | `md/toast.ts` to `shared/toast.ts` (`durationMs` option), `confirmModal` to `shared/confirmModal.ts`, toast and confirm CSS to `resources/shared/theme.css`, `Utils.showToast` is a wrapper, spreadsheet toast CSS removed, `guide.md` and MAP updated |
| 2 | 5f5e7d8 | Plain/Styled and settings scopes removed (`src/protocol/spreadsheet.ts`, provider `getSettings(fileType)`, `state.isDataOnly`), CSV/TSV data only, `legacyStylesNotice` + `convertToXlsx` + `dismissLegacyStyles`, `applyStoredMetadataToWorksheet` (convert keeps merges and controls) in `excelStyle.ts` and `extension.ts`, three settings removed from `package.json`, preferred view mode removed from `styleStorageService.ts`, tests and fixtures updated, integration tests for convert and the notice |
| 3 | 8d03e4d | New `pendingEdits.ts` (+ test) and `ledger.ts`; `persistence.ts` rewritten (`recordChange`, `saveEdits`, `onSaveResult`); `undo.ts` per-sheet stacks, values entries, saved undo; `interactiveControls.ts`, `styleEdits.ts`, `spreadsheetWebview.ts` lose `isEditMode`/`setEditMode` and every mode gate; host fix so CSS-form style edits reach the XLSX (`excelStyle.ts` `withLogicalStyleFields`); new and rewritten webview tests for the six bugs; regression entries |
| 4 | a0e5fa3 | Two-row toolbar: `spreadsheetToolbarComponent.ts` (Reload, Save, Undo, Redo, Column widths), row 2 is `#formattingToolbar.formatting-toolbar` built by `ensureEditFormattingStrip` (Insert at its end), `ToolbarManager.setStickyCompanion`, base `.formatting-toolbar` CSS moved to `resources/shared/theme.css`, new `spreadsheetToolbar.spec.mts` |
| 5 | 84c215a | `src/shared/fileHash.ts` (+ test), provider baseline hash, watcher posts `diskChangedExternally`, `saveXlsxEdits.force` + `saveConflict`, `initVirtualTable.reason`, new `diskSync.ts`, `spreadsheetDiskSync.spec.mts`, integration tests for watcher, own-save echo and conflict |
| 6 | 8a6ca52 | MAP, MESSAGE-PROTOCOL, ARCHITECTURE, AGENTS.md, CHANGELOG, `guide.md` |

### Verification

Every step: `npm run verify` green. `npm run test:integration` green after steps 2, 3 and 5 (23 tests at the end).
`npm run test:ui` (the spreadsheet spec only, not the Markdown UI specs) after steps 0, 2, 3 and 4, light and dark PNGs read.
`npm run test:regressions`: the full run did not complete here (its baseline `npm run verify` in the temporary worktree hung twice on a first browser test, and a mutation that breaks basic editing makes the whole webview suite wait for timeouts, so one entry can take up to 20 minutes). Instead every new or touched entry was re-broken by hand in the working tree and the one test that should notice was run: all of `sheet-*`, `xlsx-css-style-edits-saved`, `csv-save-stores-nothing-aside`, `convert-styles`, `convert-notice-metadata`, `csv-version-history`, `paste-multiline`, `xss-cell-sanitize`, `xss-cell-style-attr` and `resize-listeners-once` fail when re-broken (the `knownGap` entry is meant to survive). A final stale-pattern check of all 81 entries found two stale ones that are not from this work and are stale on `main` too: `md-toggle-handle-centred` and `md-cursor-clear-of-stats`. Run the full `npm run test:regressions` on a quiet machine before the PR.
`npm run test:ui` (all UI specs, spreadsheet and Markdown) was green at the end: 13 tests.
Webview tests flaked three times in total, always the first test of `markdown.spec.mts` failing or hanging and the rest of that file cascading; the same files pass alone and on re-run, and the failures were not in spreadsheet code.

### Deviations from the plan

- **Step 1: the spreadsheet toast looks different.** Because `Utils.showToast` is now the shared toast, spreadsheet messages ("Saved" and the rest) use the dark bottom-centre toast of the Markdown editor instead of the round one in the middle. The plan asked for this wrapper; it is a visible change, so it has a changelog line.
- **Step 2: stored legacy styles are not remapped on CSV saves.** `saveDelimitedFile` no longer touches `StyleStorageService`, so if a user inserts a row in a CSV that still has legacy formatting, that formatting no longer lines up (it expires after 48 hours or on Dismiss/Convert). The plan asked to stop remapping; the effect on Convert after structure edits is noted here.
- **Step 3: an extra bug fix.** The webview sends style edits in CSS form (`backgroundColor`, `fontWeight`, ...) but the host's `applyStyleEditToCell` read only logical names (`bgColor`, `bold`, ...), so colours, font and alignment set from the toolbar were never written to the XLSX (bold only reached the file through rich-text runs). `withLogicalStyleFields` maps both forms; unit and integration tests and a regression entry added. Not one of the six listed bugs.
- **Step 3: rich runs only when there is real formatting.** The old edit-mode save also wrote rich text for every edited cell whose HTML changed, so a plain edit became a rich-text cell. The ledger records runs only when `hasRunFormatting`.
- **Step 3: typing is committed at Enter/Tab/leaving the cell, not per keystroke.** The old edit mode autosaved while a cell was still being typed in (and Cancel then saved it: bug 5). Autosave now waits for the commit.
- **Step 3: structure edits are blocked while a save is in flight** ("Saving, try again in a moment"), because the host reloads the sheet when a save carried structure edits and local rows would be replaced.
- **Step 3: `body.edit-mode` and `td.editable-cell` kept as styling hooks only.** Nothing in code reads them as a mode; `syncEditableSurface` sets `edit-mode` on the body for XLSX outside version preview so the existing stylesheet keeps working, and the 46 CSS rules were not rewritten (only `plain-view` became `data-only` and the dead `controls-editable-outside-edit-mode` selector part was dropped). The plan listed removing or re-keying them in Step 4; they are re-keyed by this single class, which a later cleanup can rename.
- **Step 3: inverse operations were not attempted** (see Known gaps).
- **Step 3/4: Save/Undo/Redo ids.** Step 3 kept `#saveTableEditsButton` as the only Save button; Step 4 renamed it to `#saveEditsButton` and added `#undoEditsButton`/`#redoEditsButton` (Markdown ids). The sheet selector dropdown stays at the very left of row 1 until the Phase 2 tabs.
- **Step 4: `--header-height` counts both rows.** `ToolbarManager.setStickyCompanion` adds the formatting row; `--main-toolbar-height` stays the main row, and the main toolbar's `min-height` is keyed to it in `spreadsheetWebview.css` (otherwise the two feed each other).
- **Step 5: no `reason` on every message**, only on `initVirtualTable`; `saveResult` and the rest are unchanged.
- **Test harness:** the fixture's `reinit` now waits for row 15 (not the last row), so tests can use sheets bigger than one screen.

### Known gaps

- **Undo of already-saved structure edits and formatting.** Inverse operations for rows, columns, cells, merges, inserted controls and formatting that are already on disk were not built. The fallback from the plan is in place: `dropUnrecoverableUndoEntries` removes those entries when a save succeeds, so Undo skips them instead of misleading. Still undoable after a save: typed values, paste, clear, checkbox/dropdown/rating/date changes. Structure edits and formatting are fully undoable while unsaved (ledger snapshots). Pinned by the test "a structure edit that is already saved cannot be undone" and the `knownGap` regression entry `sheet-saved-structure-undo-inverse-ops`.
- **Pressing End inside a cell while editing in a very large sheet** can scroll the grid and re-render the row window, which drops the edit in progress (seen while writing a test with 400 rows; likely older than this work, not investigated).
- **Legacy styles notice can be replaced by another toast.** It uses the single shared toast, so a later "Saved" or "Copied" toast replaces it until the file is reopened (it is not lost: Dismiss or Convert are still pending until acted on).
- **No separate manual test in a real window** for: the legacy notice appearance, the disk-change toast, the confirm dialogs and the narrow-window toolbar scroll (only headless Chrome tests and the light/dark shots of the grid and toolbar).


## QA

_Not started._
