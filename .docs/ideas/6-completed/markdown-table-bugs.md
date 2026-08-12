---
title: Markdown table bugs
slug: markdown-table-bugs
status: completed
created: 2026-08-10
updated: 2026-08-12
---

# Markdown table bugs

## Idea

Table bugs:

- When I didn't use row above or below, the row is really thin and I can't click into it.
- When adding a column to the right, that seems to work, but when I click on the new cell, the content from the column on the right of the new cell is automatically copied. For example, if the column that I say is cell 3, when I click on the new column, it will show that exact wording.

## Brainstorm

**Surface:** CM6 live-preview table widget (`tableWidget.ts`) in preview-edit mode — right-click row/column menu, click-to-edit cells. Not spreadsheet editors.

**Bug 1 — thin, unclickable rows**

Likely cause: empty rows (especially after insert row above/below) collapse below a usable click target. `min-height: 36px` is declared in CSS but the table also uses `display: block`, which breaks normal table layout; row-height sync (`syncEditingRowHeight`) only runs on the *actively editing* row, so inactive empty rows never get the 36px floor.

Options considered:

1. **CSS-only fix** — force `display: table` (or equivalent) in preview-edit mode so `min-height` on `th`/`td` actually applies to every row. Simplest; matches existing 36px constant already in code.
2. **JS row-height sync on mount** — call the existing height-sync logic for all rows when the widget renders, not only the editing row. Heavier; fights layout on every rebuild.
3. **Placeholder content in empty cells** — invisible padding in source. Rejected: pollutes markdown on disk.

**Decision:** Option 1 as primary fix. If any edge case still collapses, extend `syncEditingRowHeight` to all body rows on widget mount (option 2 as fallback only if CSS alone is insufficient).

**Expected behavior:** Every row in an editable table is at least ~36px tall and clickable, whether empty or not, whether or not that row was just inserted via the context menu.

---

**Bug 2 — insert column right shows neighbor's content**

Likely cause: clicking an inactive cell dispatches the cursor to `target.to` (end of cell). For an empty/new cell, that position sits on the boundary with the next column; `findActiveCell`'s midpoint logic resolves it to the *right-hand* neighbor, so `wireActiveCell` loads that column's text.

Options considered:

1. **Click placement fix** — on mousedown, place cursor at `target.from` when the cell is empty (`from === to`), otherwise keep `target.to`. Minimal, targeted.
2. **`findActiveCell` fix** — treat zero-width cells so positions at `cell.to` still belong to that cell, not the neighbor. More general; may affect other cursor positions.
3. **Post-insert auto-select** — after insert column, dispatch selection into the new cell explicitly. Good UX add-on but doesn't fix clicking other empty cells.

**Decision:** Option 1 + option 2 together — click placement for empty cells *and* tighten `findActiveCell` so a cursor at an empty cell's boundary cannot bleed into the next column. Option 3 is nice-to-have: after any insert row/column menu action, land the cursor in the newly created cell (empty, ready to type). Include option 3 if low-cost alongside the fix; skip if it adds complexity.

**Expected behavior:** After "Insert column right" at column N, clicking any cell in the new column shows blank content and accepts typing. Same for any pre-existing empty cell — no ghost text from an adjacent column.

---

**Scope**

- In scope: both bugs above, preview-edit CM6 tables only.
- Out of scope: wiring toolbar `+R`/`+C` buttons (separate gap — those actions aren't in `runFormatCommand` today), spreadsheet tables, reading-mode rendered tables.
- No change to how markdown is stored on disk beyond what insert ops already write (empty cells stay empty).

## Plan

1. **CSS (`resources/md/mdWebview.css`)** — `body.preview-edit-mode .cm-md-table-widget table.md-table { display: table; }` so `min-height: 36px` on cells applies to all rows.
2. **`buildCellGrid` (`tableWidget.ts`)** — root cause for bug 2: Lezer omits `TableCell` nodes for empty cells but markdown-it renders them. Rebuild grid from physical pipe boundaries via `splitTableRowCells` + `cellRangesFromRowLine`; signature becomes `buildCellGrid(state, tableNode)`.
3. **Click + selection (`tableWidget.ts`)** — `collapsedClickPosForCell` uses `from` for whitespace-empty cells; `findActiveCell` short-circuits empty cells; `selectionPosAfterTableInsert` + menu dispatch auto-focus after insert row/column.
4. **Tests (`tableWidget.test.mts`)** — regression tests for empty-column grid, click resolution, post-insert selection.

## Implementation Log

- `resources/md/mdWebview.css` — `display: table` on CM6 widget tables in preview-edit mode.
- `src/webviews/md/livePreview/tableWidget.ts` — `cellRangesFromRowLine`, `buildCellGrid(state, …)`, `collapsedClickPosForCell`, `findActiveCell` empty-cell guard, `selectionPosAfterTableInsert`, menu handler selection dispatch.
- `src/webviews/md/livePreview/tableWidget.test.mts` — two regression tests; all call sites updated for new `buildCellGrid` signature.

**Deviation:** During implementation, bug 2's primary root cause was the Lezer/markdown-it column count mismatch (not just click position). `buildCellGrid` rewrite was required; click-placement and `findActiveCell` guards kept as defense in depth.

Verification: `npm run compile` clean; `npm run test:unit` 191/191 pass.

## QA

`npm run compile` clean. `tableWidget.test.mts` covers `buildCellGrid` empty-column fix, click resolution, and `computeMoveRowTo`/`computeMoveColumnTo` at commit time. Manual smoke: empty rows clickable at min height; new empty columns accept typing without ghost neighbor text. Marked **completed** (2026-08-12).
