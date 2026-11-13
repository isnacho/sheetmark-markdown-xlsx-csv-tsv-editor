---
title: Click another table cell while editing moves the caret
slug: table-cell-click-switch-while-editing
status: completed
created: 2026-10-22
updated: 2026-10-22
---

# Click another table cell while editing moves the caret

## Idea

While editing one cell in a Markdown live-preview table, clicking a different cell in the same table should move the caret there. It did not — focus stayed on the first cell or the selection was reset by editor-level click handlers.

## Brainstorm

**Surface:** CM6 Preview Edit — `tableWidget.ts` inactive-cell `mousedown` already dispatches CM6 selection and stashes `pendingCellClickPoint` for caret placement.

**Root cause:** The cell handler called `preventDefault()` but not `stopPropagation()`, so `contentClickHandlers` and the shell `mousedown` in `livePreviewEditor.ts` still ran afterward and moved the selection away from the clicked cell. Editor handlers also used `posAtCoords` when the pointer was over the table widget.

**Fix direction:** Commit the previous cell on switch; `stopPropagation()` on successful inactive-cell activation; skip table-widget targets in shared click handlers (`isTableWidgetPointerTarget`).

## Plan

1. `tableWidget.ts` — commit + `stopPropagation` on inactive-cell `mousedown`.
2. `contentClickPositioning.ts` — `isTableWidgetPointerTarget`; early return in `runContentClick`.
3. `livePreviewEditor.ts` — same guard on shell `mousedown`.
4. `CHANGELOG.md` — Unreleased bullet; unit test for `isTableWidgetPointerTarget`.

## Implementation Log

- `src/webviews/md/livePreview/tableWidget.ts` — commit prior `activeTableEditingCell` before switch; `event.stopPropagation()`.
- `src/webviews/md/livePreview/contentClickPositioning.ts` — `isTableWidgetPointerTarget`.
- `src/webviews/md/livePreview/livePreviewEditor.ts` — guard shell `mousedown`.
- `src/webviews/md/livePreview/contentClickPositioning.test.mts` — headless test (linkedom).
- `CHANGELOG.md` — Unreleased note.
- Verification: `check-types`, lint, `test:unit` green; esbuild bundle built.

## QA

Manual: F5 → table with several cells → edit cell A → click cell B → caret and edit focus move to B on first click. User confirmed complete (2026-10-22).

**Result: passed.**
