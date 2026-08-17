---
title: Table cell click caret placement
slug: table-cell-click-caret-placement
status: completed
created: 2026-08-15
updated: 2026-08-15
---

# Table cell click caret placement

## Idea

When clicking inside a table cell, the cursor always goes to the end of the paragraph instead of where I am actually clicking. I need to click twice — once to enter the cursor into the cell and then another one to move the cursor where I want. When clicking inside a cell, the cursor should go immediately to the location where my pointer is.

## Brainstorm

**Surface:** CM6 Preview Edit mode — in-place table cell editing in `tableWidget.ts` (Notion/Obsidian-style rendered table with one active contenteditable cell).

**Problem:** The first click on an inactive cell intercepts `mousedown`, activates the cell via a CM6 selection dispatch, and always lands the caret at the cell end (`collapsedClickPosForCell` → `cell.to`). A second click is required because only the already-active cell lets the browser place the caret natively.

**Decision:** On the first click, stash viewport coordinates and, once the cell switches to raw editable text (`loadCellForEditing`), map pixel → character offset with `caretRangeFromPoint` / `caretPositionFromPoint`, place the DOM caret there, and sync the CM6 selection to match.

**Known limitation (accepted):** Cells with inline formatting (`**bold**`, links, etc.) may have slightly imprecise placement on the first click because layout shifts when switching from markdown-it rendered HTML to raw markdown for editing. Plain-text cells should feel exact.

**Out of scope:** Spreadsheet editors; reading mode; changing the raw-vs-rendered editing model.

## Plan

Webview-internal only (`src/webviews/md/livePreview/tableWidget.ts`) — no host-side, message-protocol, or settings changes.

1. Add `pendingCellClickPoint` — set on `mousedown` of an inactive cell, consumed in `wireActiveCell`.
2. Add `caretOffsetFromClientPoint(el, x, y)` — uses `document.caretRangeFromPoint` (or `caretPositionFromPoint` fallback) + existing `measureSerializedOffset`.
3. In `wireActiveCell`'s `queueMicrotask`: after `loadCellForEditing`, if pending click coords exist, place caret at mapped offset and `view.dispatch` selection to `active.from + offset`.
4. Keep existing behavior for keyboard navigation (Tab/Enter range select) and for clicks on an already-active cell (browser native).

## Implementation Log

- **`src/webviews/md/livePreview/tableWidget.ts`**
  - `pendingCellClickPoint` module variable — stashed on inactive-cell `mousedown`.
  - `caretOffsetFromClientPoint()` — maps viewport click to serialized offset inside the editable cell DOM.
  - `wireActiveCell` microtask — consumes pending coords to place caret and sync CM6 selection; clears pending point.
  - Removed v1 comment that click pixel→offset mapping was out of scope.
- `npm run compile` — clean (0 type errors, 0 lint errors, bundle built).

## QA

- **Smoke test:** F5 → open a markdown file with a table → single-click mid-text in an inactive cell → caret lands at click position on first click (user confirmed: "works").
- **Result: passed.**
