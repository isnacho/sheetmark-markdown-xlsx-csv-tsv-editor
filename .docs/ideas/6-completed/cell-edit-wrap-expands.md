---
title: Editing a wrapped cell collapses it to one line and expands the column
slug: cell-edit-wrap-expands
status: completed
created: 2026-07-21
updated: 2026-07-21
---

# Editing a wrapped cell collapses it to one line and expands the column

## Idea

Bug: in a table cell with long text that wraps across multiple lines, clicking into the cell to edit it collapses the text onto a single line and the cell expands (width/height) to fit that single line. Desired: cell width should stay fixed, editing should support multiple wrapped lines, and the cell's appearance (size, wrapping) should stay the same across not-editing, editing, and preview states.

## Brainstorm

Root cause (corrected scope — **Markdown preview tables**, not spreadsheet/CSV): `.cm-md-table-cell-editing` in `resources/md/mdWebview.css` sets `white-space: pre`, which prevents wrapping while a CM6 live-preview table cell is being edited. Separately, `body.preview-edit-mode` pins every table cell to `height: 36px`, blocking row growth as wrapped text changes.

Decided direction:

1. **Core fix:** editing a table cell in the Markdown preview must preserve wrapping (`pre-wrap`) instead of `pre`. Column width stays fixed (`table-layout: fixed` on resized tables).
2. **Row height while typing:** rows use `min-height: 36px` + `height: auto` so wrapped content can grow/shrink; `tableWidget.ts` also syncs row height on input while a cell is active.
3. **Scope:** Markdown CM6 live-preview tables only — spreadsheet/CSV editor untouched.
4. **Follow-on (same idea):** Shift+Enter inserts `<br>` line breaks; inline formatting (bold/italic/code/link/strike) via toolbar + Mod-shortcuts while a cell is active; inactive cells must render `<br>` as real breaks (not escaped literal tags).

## Plan

1. **CSS** (`resources/md/mdWebview.css`)
   - Change `.cm-md-table-cell-editing` from `white-space: pre` → `pre-wrap` (+ word-wrap).
   - Change preview-edit-mode table cells from fixed `height: 36px` → `min-height: 36px; height: auto`.

2. **JS — wrap + row height** (`src/webviews/md/livePreview/tableWidget.ts`)
   - Add `syncEditingRowHeight()` — measure natural row height after wrap, apply to row/cells.
   - Call on cell activation and each `input` (rAF-debounced).

3. **JS — line breaks + inline format** (`tableWidget.ts`, `livePreviewEditor.ts`)
   - Shift+Enter → `<br>` (serialized); Enter still moves to cell below; paste newlines → `<br>`.
   - Cell DOM serialize/load for visual breaks while editing.
   - `applyTableCellInlineFormatAction()` for toolbar; Mod+B/I/E/K/Shift+X in cell keydown.
   - Enable `html: true` on table widget markdown-it so `<br>` renders when cell is inactive.

## Implementation Log

- Reverted mistaken spreadsheet changes (`resources/spreadsheet/spreadsheetWebview.css`, wrap-related code in `spreadsheetWebview.ts`).
- `resources/md/mdWebview.css` — `pre-wrap` on editing cells; `min-height` instead of fixed height on preview-edit tables.
- `src/webviews/md/livePreview/tableWidget.ts` — row-height sync; `<br>` serialize/load; Shift+Enter; inline format helpers + cell keydown/toolbar wiring; `MarkdownIt({ html: true, linkify: true })` for inactive-cell render.
- `src/webviews/md/livePreview/livePreviewEditor.ts` — toolbar routes to `applyTableCellInlineFormatAction` when a table cell is active.
- `src/webviews/md/livePreview/tableWidget.test.mts` — tests for sanitize/wrap/link helpers.
- `npm run compile` + `npm run test:unit` — clean (170 tests).
- **Deviation:** original brainstorm incorrectly targeted spreadsheet CSS; fix applied to Markdown preview per user clarification. Shift+Enter and inline formatting were added in the same pass after initial wrap fix.

## QA

- **2026-07-21 — manual smoke (user):** wrap preserved on edit; Shift+Enter line breaks work; after blur, cells render with real line breaks (no visible `<br>` tags). **Pass.**
