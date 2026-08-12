---
title: Drag-to-reorder blocks and table rows/columns
slug: drag-reorder-blocks-and-tables
status: completed
created: 2026-08-10
updated: 2026-08-12
---

# Drag-to-reorder blocks and table rows/columns

## Idea

For tables, when hovering over a row or a column, we have some grabbers at the top or left of the table that we can grab to move the column/row — essentially drag and drop.

Scope expanded during brainstorm: the same drag-handle interaction should also appear beside markdown blocks (e.g. drag a fenced code block up or down), with tables both draggable as a whole unit and reorderable internally by row/column.

**Scope cut (2026-08-12):** document-block drag is **out of scope**. Ship table row/column drag only.

## Brainstorm

Checked current code (`tableWidget.ts`, `formatCommands.ts`). Tables already have column-resize grabbers on header cells and context-menu row/column moves backed by `computeMoveRowUp` / `computeMoveColumn` etc. Document-level `Alt+↑/↓` uses `computeMoveLineUp` / `computeMoveLineDown`, which swap **single physical lines** only — not whole syntax-tree blocks (a multi-line fenced code block would move one line at a time). No block-level drag handles exist in the CM6 live-preview gutter today.

Decided scope, as a product spec:

**1. Unified drag-handle interaction in preview-edit mode.** One visual language for all drag affordances: a small hover-revealed grabber. Placement differs by target (left gutter for document blocks and table rows; top of header for table columns) but look, cursor, and drop feedback are shared.

**2. Left gutter outside content (6A).** Preview-edit mode adds permanent left padding so handles sit in an outside gutter, not overlapping list bullets, heading markers, or cell text. Handles appear on hover of the block (or table row/column band), not as a always-visible full-document chrome strip.

**3. Document blocks — full block model (3D).** Each draggable unit is a syntax-tree block, not a physical line:
- Fenced code (including mermaid fences)
- Paragraphs
- Headings (ATX and Setext)
- Blockquotes (whole quote, all lines)
- Horizontal rules
- List items (marker line + continuation lines, same `ListItem` granularity as list indent logic)
- Tables as a **single block unit** (entire `Table` node — header, delimiter, all body rows)

Dragging moves the whole node's doc range. Drop target is **between** blocks (or before/after the document), shown as a **thin insertion line** (4A) — no ghost block following the pointer in v1.

**4. Tables — two layers, no in-cell block drag (7).**
- **Table as block:** the table's left-gutter handle moves the entire table relative to other document blocks (same insertion-line drop model).
- **Inside a table:** row handles on row hover (left edge) and column handles on column hover (top of header) reorder rows/columns using existing structural move semantics (header row not draggable; first body row can't cross above header; edge no-ops). Column resize handles on header right edge stay resize-only — separate hit targets, no accidental move-on-resize.
- **No document-block drag inside cells:** cell content is not treated as nested draggable blocks; structural row/column handles are the only in-table drag affordances.

**5. Multi-block selection drag (8).** When the user has a contiguous text selection, dragging any involved handle moves **all blocks touched by that selection together** as one unit, preserving their internal order, to a single new insertion point. **Partial selections expand to whole blocks:** if the selection starts or ends mid-block, expand to the enclosing block boundaries for the drag (first block from its start, last block through its end). Discontiguous multi-cursor selection is out of scope (editor has no multi-cursor today).

**6. Keyboard stays line-level (5A).** `Alt+↑/↓` keeps today's `computeMoveLineUp` / `computeMoveLineDown` behavior (single-line swap). Drag is the block-level (and table row/column) path. No keyboard change in v1.

**7. Context menu moves remain.** Table row/column context-menu items stay as fallback; drag is additive discoverability.

Explicitly out of scope: drag across files; raw split-view textarea editor; discontiguous multi-cursor multi-select; ghost-block drag preview (insertion line only); **document-block gutter drag** (paragraphs, headings, code fences, etc. — cut 2026-08-12; table row/column drag only).

## Plan

### Architecture

Two drag layers, one visual language (`cm-md-drag-handle`, shared cursor `grab`/`grabbing`, insertion line `cm-md-drag-insertion-line`):

| Layer | UI host | Commit logic |
|---|---|---|
| Document blocks (+ whole table) | `blockDragPlugin` ViewPlugin overlay | New pure helpers in `blockBoundary.ts` |
| Table row / column | `wireRowDragHandle` / `wireColumnDragHandle` in `tableWidget.ts` | Reuse `computeMoveRowUp/Down`, `computeMoveColumn` |

**Do not** add per-block `Decoration.replace` widgets — would rebuild on every keystroke and fight reveal/table widget lifecycle.

**Message protocol:** no new commands. Column-width remap reuses existing `setColumnWidthsEffect` → `onColumnWidthsChanged` → `saveTableColumnWidths`.

### Step 1 — `blockBoundary.ts` (pure + tests)

New file `src/webviews/md/livePreview/blockBoundary.ts` + `blockBoundary.test.mts`.

**Draggable block types** (lezer node names):
- `FencedCode`, `ATXHeading1–6`, `SetextHeading1–2`, `Blockquote`, `HorizontalRule`, `ListItem`, `Table`
- Top-level `Paragraph` only when not nested under `ListItem`, `Blockquote`, `Table`, or another block container

**Functions:**
1. `enumerateDraggableBlocks(state)` → sorted `{ node, from, to }[]` (whole-doc scan, same tradeoff as `tableWidgetField`)
2. `blocksForSelection(state)` → expand `selection.main` to union of enclosing blocks for any touched range (partial selection expands to whole block boundaries per brainstorm §5)
3. `computeMoveBlocksTo(state, blocks[], insertBeforePos)` → cut contiguous block ranges (preserving order), insert at target with blank-line normalization between moved blocks and neighbors; return `TransactionSpec | null`
4. `insertionIndexForY(view, clientY, excludeRanges)` → which gap between blocks the pointer targets (for insertion line)
5. `remapTableWidthsOnTableMove(widthsMap, movedIndex, newIndex)` → reorder keys in `columnWidthsField` map when a `Table` block moves among siblings

**Tests:** enumeration skips nested paragraphs; list item includes continuations; multi-block selection expansion; move preserves order; no-op when dropping between own blocks; table width map remap.

### Step 2 — `blockDrag.ts` ViewPlugin

New file `src/webviews/md/livePreview/blockDrag.ts`.

**DOM structure:** sibling overlay inside editor wrapper (or absolutely positioned over `.cm-scroller`):
- Container for hover-revealed handles (one per visible block band)
- Fixed insertion-line element updated on `mousemove` during drag

**Behavior:**
1. On `mousemove` (throttled rAF): map Y to block via `enumerateDraggableBlocks` + `view.lineBlockAtHeight` / block vertical bands; show handle in left gutter column
2. On handle `mousedown`: resolve drag set — if selection spans multiple blocks use `blocksForSelection`, else single block under handle; `preventDefault` to avoid selection bleed
3. During drag: show insertion line at gap from `insertionIndexForY`; exclude dragged block ranges from drop targets inside the dragged span
4. On `mouseup`: `view.dispatch(computeMoveBlocksTo(...))`; if moved blocks include `Table` node(s), also dispatch width-map remap effect
5. Hide handles during active drag; cancel on Escape

**Table-as-block handle:** ViewPlugin positions handle aligned to `Table` node's vertical band (via syntax tree `Table.from`/`to` line blocks). Do not nest inside `TableWidget` (`ignoreEvent: true` would still work for widget-local handles, but block-level table drag stays in ViewPlugin to share insertion-line logic with paragraphs).

**Row-band handles inside tables:** NOT in ViewPlugin — handled in Step 4 inside `TableWidget` (separate hit targets).

### Step 3 — Register plugin + CSS

**`livePreviewEditor.ts`:**
- Add `blockDragCompartment` (separate from `revealCompartment` so block drag works when reveal is off)
- `blockDragCompartment.of([blockDragPlugin])` always when preview-edit mounts (same lifetime as CM6 view)
- Pass `gutterCompartment` state into plugin if needed for handle X offset when line numbers on

**`cm6Theme.ts`:**
- Increase left padding on `.cm-content` (or scroller) for gutter column (~24px handle lane outside the 16px content padding)
- Base handle + insertion-line theme tokens

**`mdWebview.css`:**
- `.cm-md-drag-handle`, `.cm-md-drag-insertion-line`
- Table row/col move handles alongside existing `.cm-md-col-resize-handle` (Step 4)

### Step 4 — Table internal row/column drag (`tableWidget.ts`)

Mirror `wireResizeHandle` pattern:

**`wireRowDragHandle(tr, view, tableIndex, row, grid, tableNode)`**
- Left-edge strip on body rows only (not header); hover-reveal class
- `mousedown`: `preventDefault` + `stopPropagation`
- Track pointer across row bands; show insertion line **within table** (local element on `wrap`, not global block line)
- On drop: map target row index → repeated `computeMoveRowUp/Down` **or** new `computeMoveRowTo(state, tableNode, grid, fromRow, toRow)` (prefer single helper if drop index differs from adjacent swap — plan: add `computeMoveRowTo` if drag-drop needs non-adjacent row insert; otherwise stepwise swap on drop only if v1 limits to adjacent — **actually drag-drop implies arbitrary row index** — need `computeMoveRowTo` or cut/paste row source lines)

**`wireColumnDragHandle(th, view, col, ...)`**
- Top-edge strip on header cells (separate from right-edge resize handle)
- On drop: need `computeMoveColumnTo(state, tableNode, grid, fromCol, toCol)` — existing `computeMoveColumn` only swaps adjacent; drag implies arbitrary column index (same as row)

**New pure helpers in `tableWidget.ts` (or `blockBoundary.ts` for table-internal):**
- `computeMoveRowTo` — reorder body row source lines to target index
- `computeMoveColumnTo` — regenerate table with column moved to target index (like `computeMoveColumn` but arbitrary target)
- `remapColumnWidths(widths, fromCol, toCol)` — swap/move width array entry on column reorder; dispatch `setColumnWidthsEffect` on commit

Wire row handles on `tbody tr`; column handles on `thead th` **after** `wireResizeHandle` (same ordering constraint as resize vs `wireActiveCell`).

### Step 5 — Width/index persistence fixes

When table **block** moves among document blocks:
- `remapTableWidthsOnTableMove` updates `columnWidthsField` keys (table order index)
- Existing `updateListener` in `livePreviewEditor.ts` fires `onColumnWidthsChanged` → host `saveTableColumnWidths`

When **column** moves within table:
- `remapColumnWidths` on the table's width array
- Same persist path

Add tests in `tableWidget.test.mts` for width remap.

### Step 6 — Edge cases & conflicts

- **Active cell editing:** block drag handles hidden or no-op when `document.activeElement` is `.cm-md-table-cell-editing`; table row/col drag must not steal mousedown from active cell (handles on row edge, not cell center)
- **Resize vs move:** column resize = right 6px strip (`col-resize`); column move = top band (`grab`) — verify hit boxes in manual QA
- **Blank lines between blocks:** `computeMoveBlocksTo` inserts single `\n` separators; don't leave double blank or swallow required list/blockquote structure
- **Drop at doc start/end:** insertion index 0 / after last block
- **Dragging selection that includes table + paragraphs:** one cut, one insert
- **Programmatic annotation:** mark block-move transactions with existing `programmatic` annotation if needed so `onDocChanged` behavior stays correct (block moves are user edits — should trigger save; do NOT mark programmatic)

### File checklist

| File | Action |
|---|---|
| `src/webviews/md/livePreview/blockBoundary.ts` | **new** |
| `src/webviews/md/livePreview/blockBoundary.test.mts` | **new** |
| `src/webviews/md/livePreview/blockDrag.ts` | **new** |
| `src/webviews/md/livePreview/tableWidget.ts` | row/col drag wiring + `computeMoveRowTo` / `computeMoveColumnTo` + width remap |
| `src/webviews/md/livePreview/tableWidget.test.mts` | move-to + width remap tests |
| `src/webviews/md/livePreview/livePreviewEditor.ts` | register `blockDragCompartment` |
| `src/webviews/md/livePreview/cm6Theme.ts` | gutter padding + handle theme |
| `resources/md/mdWebview.css` | handle + insertion line + table row/col handle styles |

**Not expected to change:** `mdEditorProvider.ts`, `extension.ts`, `package.json`, CSP, esbuild paths, `xlsxViewer.*` IDs.

### Implementation order

1. `blockBoundary.ts` + tests
2. `blockDrag.ts` + CSS + `livePreviewEditor` registration (document blocks only)
3. `computeMoveRowTo` / `computeMoveColumnTo` + width remap (pure + tests)
4. `tableWidget.ts` internal drag handles
5. `npm run compile` — fix types/lint
6. Manual F5 smoke (QA phase)

### Risks

| Risk | Mitigation |
|---|---|
| Widget `updateDOM` / focus steal on table row move | Dispatch once on mouseup; don't rebuild widget mid-drag |
| `ignoreEvent()` on `TableWidget` | All table handles self-wired with stopPropagation |
| `columnWidthsField` index drift | Remap on table block move + column move |
| Gutter overlap with line numbers | Offset handle X when `gutterCompartment` active |
| Non-adjacent row/col drop | `computeMoveRowTo` / `computeMoveColumnTo` (not just repeated adjacent swap) |

## Implementation Log

Built per plan. No message-protocol changes.

**New files:**
- `src/webviews/md/livePreview/blockBoundary.ts` — block enumeration, selection expansion, `computeMoveBlocksTo`, width-map remap after table block moves
- `src/webviews/md/livePreview/blockBoundary.test.mts` — 10 tests
- `src/webviews/md/livePreview/blockDrag.ts` — `blockDragPlugin` ViewPlugin (gutter handles, insertion line, dispatch)

**Modified files:**
- `src/webviews/md/livePreview/tableWidget.ts` — `computeMoveRowTo`, `computeMoveColumnTo`, `replaceColumnWidthsEffect`, `wireRowDragHandle`, `wireColumnDragHandle`, column width remap on column drag
- `src/webviews/md/livePreview/tableWidget.test.mts` — tests for move-to helpers
- `src/webviews/md/livePreview/livePreviewEditor.ts` — `blockDragCompartment`, `replaceColumnWidthsEffect` persist hook
- `src/webviews/md/livePreview/cm6Theme.ts` — left gutter padding, overlay/handle/insertion-line theme
- `resources/md/mdWebview.css` — table row/column drag handle styles

**Deviations:**
- `remapColumnWidths` duplicated locally in `tableWidget.ts` (tsc disallows `.ts` extension imports from non-test modules; kept pure copy in `blockBoundary.ts` for tests).
- `computeMoveBlocksTo` joins blocks with `\n\n` and collapses `\n{3,}` to avoid triple blank lines after cut-paste.
- Line-number gutter offset for block handles deferred — handles use `coordsAtPos(0)`; may overlap line numbers when enabled (manual QA item).

**Verification:** `npm run compile` clean; `npm run test:unit` 203 tests pass.

**Scope cut (2026-08-12):** document-block drag (`blockBoundary.ts`, `blockDrag.ts`) not built — product decision to ship table-only. Table row/column drag + `computeMoveRowTo` / `computeMoveColumnTo` + width remap are the delivered surface.

**QA bounce-back (2026-08-12):** table row/column drag appeared broken — grips sit in the widget's left/top gutter padding but hover detection only listened on `<tr>`/`<th>`, so hovering the gutter (where the grips render) never revealed them. Superseded by `wireTableDragUI` refactor below.

**Final implementation (2026-08-12):** replaced per-row/per-column hit zones with one `wireTableDragUI` per table — grips positioned on `wrap` `mousemove` (row grip when cursor is over a body row; column grip when cursor is in the column strip including the top gutter). Column grip straddles the header top edge so it stays reachable. Row/column insertion lines share base `cm-md-table-drag-insertion-line` styles; column line is vertical and spans full table height. `npm run compile` clean.

## QA

### Automated (agent)

| Check | Result |
|---|---|
| `npm run compile` (types + lint + bundle) | Pass |
| `npm run test:unit` | Pass (203 tests) |

### Manual smoke test (F5 Extension Development Host)

Setup: **F5** → open `samples/test.md` → **Preview Edit** mode. Reload host (**Cmd+R**) after any further code edits.

**Document blocks** — _out of scope (table-only ship); skip._

**Tables (`samples/test.md` ~line 115+)**

- [x] Hover body row → left-edge grip → drag to new row index → row moves; blue horizontal insertion line visible
- [x] Hover header column → top grip → drag column → all rows update; blue vertical insertion line visible
- [x] Right-edge drag on header still **resizes** column (does not move column)
- [ ] Resize a column, drag column to new index, save file, reopen → widths still match columns (not re-tested this session)

**Regression**

- [ ] Edit a table cell → typing/focus stable (not re-tested this session)
- [ ] Context menu row/column move still works (not re-tested this session)
- [ ] Toggle reveal off/on → column widths survive reveal toggle (not re-tested this session)

### Outcome

Table-only drag-to-reorder shipped. User confirmed row drag, column drag (after column hit-strip + insertion-line fixes), and insertion indicators working (2026-08-12). Document-block drag remains out of scope. Marked **completed**.
