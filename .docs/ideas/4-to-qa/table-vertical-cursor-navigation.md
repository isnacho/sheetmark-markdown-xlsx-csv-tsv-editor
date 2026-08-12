---
title: Table vertical cursor navigation
slug: table-vertical-cursor-navigation
status: to-qa
created: 2026-08-12
updated: 2026-08-12
---

# Table vertical cursor navigation

## Idea

When moving up and down the document using the cursor, it seems to work correctly within normal paragraphs, but when doing it within a table, it does not work.

I'm in the line above the table. Clicking down takes me to the first cell or to the left of the table, which works fine. Clicking left to right also moves through the columns, which is also correct. When clicking down, between the first and second row, it works well, but when I want to go from the second row to the third row, it takes me completely outside of the table, while this should go actually to the third row.

Something similar happens when coming to a table from below. I go up, and it selects the bottom left cell of the table, which is correct, but when I go up again, it takes me outside of the table. This should be fixed.

## Brainstorm

**Surface:** CM6 Preview Edit mode — arrow-key cursor movement through GFM pipe-table source (`tableBoundaryEditing.ts` keymap). Not spreadsheet editors, not reading mode, not in-cell contenteditable nav in `tableWidget.ts` (out of scope unless a separate issue is filed).

**Problem:** Vertical ↑↓ navigation treats the GFM delimiter row (`| --- |`) as part of the row sequence, or miscounts rows via a grid that doesn't align with the rendered table (header + body rows only). Result: after one or two successful row moves, the caret jumps **outside** the table instead of continuing to the next body row. Entering from below shows the same pattern — lands on the last row correctly, then ↑ exits instead of moving to the row above.

**Decisions (A1 + B2 + C1 + D1 + E1 + F1):**

- **Navigation model (B2):** ↑↓ walk the **visual cell grid** — header row plus body rows only. The delimiter row is never a navigation stop; vertical moves skip it the same way the rendered table widget hides it.
- **Column alignment (C1):** On every vertical move (including enter-from-above/below), land in the **same column** as the current cell, using horizontal cursor offset as the column hint.
- **Horizontal (D1, default):** ←→ within a row stays as-is — column-aware, no change.
- **Boundaries (E1):** ↓ exits the table only from the **last body row**; ↑ exits only from the **header row** (or the non-table line above). No premature exit from intermediate body rows.
- **Success criterion (F1):** In a table with multiple body rows, every body row is reachable via ↑↓ without jumping out early.

**Expected behavior (golden paths):**

1. Line above table → ↓ → header cell, column aligned with cursor position above.
2. Header → ↓ → first body row (same column), **not** the delimiter line.
3. Body row N → ↓ → body row N+1 (same column) until the last body row.
4. Last body row → ↓ → first non-table line below.
5. Line below table → ↑ → last body row (column aligned).
6. Last body row → ↑ → previous body row (same column); repeat until header.
7. Header → ↑ → line above the table.

**Out of scope:** In-cell contenteditable arrow-at-edge behavior inside the rendered widget; reading mode; source/plain-text mode outside Preview Edit.

## Plan

1. **`tableBoundaryEditing.ts`** — route vertical ↑↓ through `buildCellGrid` (header + body rows, delimiter excluded) via `rowIndexForLine` / `pickCellInRow`; pipe rows not in the grid redirect to the nearest visual row. Keep ←→ on the current line. Enter/exit boundaries use grid row 0 / last row.
2. **`tableBoundaryEditing.test.mts`** — regression tests for delimiter skip, multi-row ↓/↑ without early exit, boundary enter/exit.

## Implementation Log

- `src/webviews/md/livePreview/tableBoundaryEditing.ts` — visual-grid ↑↓ navigation; `buildCellGrid` now scans pipe lines (skips delimiter); relaxed delimiter detection for `| - |` rows; enter/exit table only on **immediately adjacent** lines (blank lines are no longer skipped).
- `src/webviews/md/livePreview/tableWidget.ts` — in-cell ↑↓ always moves between rows for single-line cells; land on `collapsedClickPosForCell` so chained moves work.
- `src/webviews/md/livePreview/tableBoundaryEditing.test.mts` — regression tests including multi-row grid and ↑ without early exit.

**Deviation:** Root cause was two-fold: (1) CM6-only fix missed the contenteditable cell key handlers in `tableWidget.ts`; (2) `buildCellGrid` used Lezer nodes and missed body rows / misclassified `| - |` delimiters.

Verification: `npm run compile` clean; `tableBoundaryEditing.test.mts` 18/18 pass.

## QA

_Not started._
