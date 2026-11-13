---
title: Table header drag-select and double-click word select
slug: table-header-text-selection
status: completed
created: 2026-10-22
updated: 2026-10-22
---

# Table header drag-select and double-click word select

## Idea

Bug: in Markdown live-preview tables, drag-to-select text and double-click word select do not work in **header** cells. Body cells behave normally.

## Brainstorm

**Surface:** `wireTableDragUI` in `tableWidget.ts`.

**Root cause:** Column reorder drag used `columnTargetAt`, which matched the full `<th>` height. The wrap `mousedown` handler called `startColDrag` on any header press. `startColDrag` called `preventDefault()` / `stopPropagation()` **before** checking for `.cm-md-table-cell-editing`, so the browser never got native selection gestures while editing a header.

**Fix:** Narrow mousedown to `columnDragGripAt` (top grip band only, aligned with `positionColHandle`); guard `startColDrag` / `startRowDrag` and wrap `mousedown` with `tableCellEditingAtPointer` before canceling default; resolve `colTarget` on direct grip `mousedown`.

## Plan

1. Export `columnDragGripTarget` for unit tests; add `columnDragGripAt` + `tableCellEditingAtPointer`.
2. Reorder drag starters so editing guard runs before `preventDefault`.
3. Regression entry `md-table-header-text-select`; CHANGELOG Unreleased bullet.

## Implementation Log

- `src/webviews/md/livePreview/tableWidget.ts` — grip-only column drag hits; editing guards; grip mousedown col resolution.
- `src/webviews/md/livePreview/tableWidget.test.mts` — two tests for `columnDragGripTarget`.
- `scripts/check-regression-tests.mjs` — `md-table-header-text-select`.
- `CHANGELOG.md` — Unreleased note.
- Verification: `check-types`, lint, unit tests (462 pass).

## QA

Manual: edit header cell → drag-select and double-click word work; column reorder still starts from top grip. Marked **completed** (2026-10-22).
