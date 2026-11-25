---
title: Spreadsheet parity add-ons
slug: spreadsheet-parity-add-ons
status: to-implement
created: 2026-11-25
updated: 2026-11-25
---

# Spreadsheet parity add-ons

## Idea

Phase 2 of [One-mode spreadsheet editor with Markdown parity](../5-completed/spreadsheet-editor-refresh.md), split out on 2026-11-25 when Phase 1 passed QA: selection stats, sheet tabs, faster open and a spreadsheet UI review. The spec and plan below were approved with that idea on 2026-11-20 and are copied here unchanged. The screenshot tooling it lists already shipped in Phase 1 (Step 0), so only the UI review is left from that item.

## Brainstorm

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

Ships as one PR per item (G1 to G4). The per-sheet edit ledger, two-row toolbar and shared toast from Phase 1 are in place.

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

- Every item: `npm run verify`; `npm run test:integration` when host code changes (G3).
- G1 and G2: `npm run test:ui`, then read the light and dark PNGs in `.vscode-test/ui-shots/`.
- Each bug fix found on the way: a failing test plus a `scripts/check-regression-tests.mjs` entry.

## Implementation Log

## QA
