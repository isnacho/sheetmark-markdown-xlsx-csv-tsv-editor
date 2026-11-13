---
title: Table header cell text clips at the right edge while editing
slug: table-header-edit-text-clipping
status: completed
created: 2026-10-22
updated: 2026-10-22
---

# Table header cell text clips at the right edge while editing

## Idea

Bug: typing in a Markdown live-preview **table header** cell shows text flush against the right edge; long text truncates immediately with no room to read or edit. Body cells behave correctly.

## Brainstorm

**Surface:** CM6 table widget (`tableWidget.ts`), preview-edit mode.

**Root causes:**

1. **CSS `nowrap` on `<th>` only** — For wide manually resized tables (`cm-md-table-resized` + `cm-md-table-overflow-x`), inactive cells use `white-space: nowrap` so column widths stay stable. Body cells exempt the active editor via `td:not(.cm-md-table-cell-editing)`; header cells did not, so `nowrap` overrode `.cm-md-table-cell-editing { pre-wrap }` while editing a header.
2. **Column resize handle inside `contentEditable`** — `wireResizeHandle` appends `.cm-md-col-resize-handle` to each `<th>` after `wireActiveCell`. When the header is the active cell, the grip sat inside the editable surface and crowded the right edge.

**Fix direction:** Mirror body-cell behavior for headers (`th:not(.cm-md-table-cell-editing)`); skip attaching a resize handle on the header column being edited; `contentEditable="false"` on grips and ignore them in `serializeCellContent`.

## Plan

1. `resources/md/mdWebview.css` + `src/webviews/md/livePreview/cm6Theme.ts` — add `:not(.cm-md-table-cell-editing)` to the `th` selector in the overflow `nowrap` rule.
2. `src/webviews/md/livePreview/tableWidget.ts` — do not call `wireResizeHandle` when `activeCell` is that header column; harden serialize + handle attributes.
3. `CHANGELOG.md` — user-facing bullet under Unreleased.

## Implementation Log

- `resources/md/mdWebview.css`, `src/webviews/md/livePreview/cm6Theme.ts` — `th:not(.cm-md-table-cell-editing)` in nowrap rule.
- `src/webviews/md/livePreview/tableWidget.ts` — skip resize handle on editing header; `handle.contentEditable = 'false'`; skip `.cm-md-col-resize-handle` in `serializeCellContent`.
- `CHANGELOG.md` — Unreleased note.
- Verification: `check-types`, lint, `test:unit` (incl. `tableWidget.test.mts`) green. User confirmed fix in session.

## QA

Manual: edit a header cell in a resized/wide table — text wraps while editing and is not clipped at the column edge. Marked **completed** (2026-10-22).
