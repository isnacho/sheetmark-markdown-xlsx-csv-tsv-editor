---
title: Responsive wrap and isolated table scroll
slug: responsive-wrap-table-scroll
status: to-implement
created: 2026-08-05
updated: 2026-08-12
---

# Responsive wrap and isolated table scroll

## Idea

I want the text to wrap when the window is too small, respecting the window width up to a minimum window width of something. Help me define that.

For things like code blocks, the code block should also wrap, but tables should not. The table should remain as long as they are, and the user can scroll horizontally on the table, but only the table should scroll horizontally. The rest of the document should be fixed because, at the moment, scrolling on the table also scrolls the whole document.

## Brainstorm

**Scope:** Preview Edit mode only (CM6 live-preview). Preview-only and split-view modes are out of scope for this idea.

**Decided UX direction:**

### Viewport & prose wrapping

- **No minimum width floor** — content always reflows to fit the available pane width; nothing forces document-level horizontal scroll.
- **Keep the existing `xlsxViewer.md.wordWrap` toggle** (default on). When on, ensure Preview Edit actually respects pane width for all prose content, including long URLs, inline code, and images. Fix any gaps where content still overflows horizontally.
- When `wordWrap` is off, prose and code blocks revert to horizontal scroll behavior (current code-block `overflow-x: auto` pattern).

### Code blocks

- **Follow `wordWrap`:** when on, fenced code blocks soft-wrap (`white-space: pre-wrap`; no horizontal scrollbar on the block). When off, horizontal scroll as today.
- Copy button still copies the full original line content.

### Tables

- **Scope:** Preview Edit (CM6 live-preview) only — reading preview and split-view are out of scope for table scroll changes.
- Tables keep their natural column widths — cells do **not** wrap to shrink the table.
- **Vertical scroll:** tables must **not** scroll vertically. Tall tables grow with the document; only `.cm-scroller` owns vertical scroll. No nested scroll-within-scroll when the pointer is over a table.
- **Horizontal scroll:** tables scroll horizontally **only when wider than the pane** (`scrollWidth > clientWidth`). When the table already fits, no inner scrollbox (no stray scrollbars or wheel capture).
- **Implementation note:** use `overflow-x: auto` + `overflow-y: hidden` on the wrapper — **not** `overflow-y: visible`, which browsers coerce to `auto` when `overflow-x` is `auto`, causing the nested vertical scroll bug.
- Reuse the existing `.cm-md-table-widget` wrapper as the scroll container (no extra DOM node). Remove `display: block` + `overflow: auto` from the `<table>` itself so scroll containment works correctly.
- **No `max-height`** on the table wrapper — height is always natural; document scroll handles tall tables.
- The document pane (`overflow-x: hidden` on the CM6 scroller / preview container) never scrolls horizontally — only the table wrapper does.
- **Fade edge:** when a table overflows horizontally, show a subtle right-edge gradient fade to signal more content is off-screen. No other scroll polish (no shift+scroll shortcut) in v1.
- **Word wrap toggle:** table scroll is **not** gated on any wrap setting. The spreadsheet wrap toggle is unrelated to Markdown table scrolling.

### Inline elements

- **Inline code:** `overflow-wrap: anywhere` so long tokens break instead of widening the pane.
- **Images:** `max-width: 100%; height: auto`.
- **Mermaid diagrams:** fit container width; internal scroll only if the diagram exceeds the pane.

### Out of scope

- Preview-only and split-view layout changes.
- Sticky first table column.
- Per-block or separate "wrap code" toggle.
- Hard minimum-width floor or narrow-panel warning.

## Plan

**Root causes (Preview Edit / CM6):**

1. **Nested vertical scroll on tables:** `.cm-md-table-widget` sets `overflowX: auto` + `overflowY: visible` (`cm6Theme.ts`). Per CSS overflow rules, `visible` on one axis is coerced to `auto` when the other axis is not `visible` — so the wrapper becomes a two-axis scroll container and fights `.cm-scroller` for vertical wheel events.
2. **Document horizontal scroll on wide tables:** Shared `table.md-table { display: block; overflow: auto }` (`mdWebview.css`) can still widen `.cm-content`; wide tables pull the whole document sideways unless the wrapper contains horizontal overflow.
3. **Live `wordWrap` toggle gap (prose/code only):** CM6 mounts with `lineWrapping` from settings (`mountLivePreview`) but `applySettings()` never calls `setLivePreviewLineWrapping()` when the user toggles word wrap mid-session.

**No message-protocol changes** — `wordWrap` already flows host → `initSettings` / `settingsUpdated` → `mdWebview`. **Table scroll is independent of word wrap** (per brainstorm).

### Step 1 — Fix live `wordWrap` toggle in Preview Edit (prose/code; tables unaffected)

**File:** `src/webviews/md/mdWebview.ts`

- Import `setLivePreviewLineWrapping` from `livePreviewEditor.ts`.
- In `applySettings()`, inside the existing `isLivePreviewActive()` block, call `setLivePreviewLineWrapping(currentSettings.wordWrap)`.
- Toggle `document.body.classList` `cm6-word-wrap` on/off in `applySettings()` (and on mount in `setPreviewEditMode`) alongside existing `cm6-preview-active`.

### Step 2 — Document-level horizontal scroll lock (`wordWrap` on only)

**Files:** `resources/md/mdWebview.css`, `src/webviews/md/livePreview/cm6Theme.ts`

- When `body.cm6-preview-active.cm6-word-wrap`: `.cm-scroller { overflow-x: hidden }` (vertical scroll unchanged).
- When `wordWrap` off: keep `overflow-x: auto` on `.cm-scroller`.
- Ensure `.cm-content` can shrink: `min-width: 0` (keep existing `max-width: 900px`).

### Step 3 — Prose & inline code wrap (`wordWrap` on)

**Files:** `src/webviews/md/livePreview/cm6Theme.ts`, `resources/md/mdWebview.css`

- `.cm-md-inline-code`: add `overflow-wrap: anywhere` when `cm6-word-wrap` active.
- Verify `EditorView.lineWrapping` + no blocking `white-space: nowrap` on `.cm-line`.

### Step 4 — Fenced code block wrap (`wordWrap` on)

**File:** `resources/md/mdWebview.css` (scoped `body.cm6-preview-active.cm6-word-wrap`)

- `.cm-md-fenced-code-line { white-space: pre-wrap; word-break: break-word }`.

### Step 5 — Table scroll isolation (horizontal only when overflowing; no vertical scroll)

**Files:** `src/webviews/md/livePreview/tableWidget.ts`, `src/webviews/md/livePreview/cm6Theme.ts`, `resources/md/mdWebview.css`

**CSS (base state — table fits pane):**

```css
.cm-md-table-widget {
  max-width: 100%;
  overflow-x: hidden;   /* no inner scrollbox when table fits */
  overflow-y: hidden;   /* never vertical scroll on wrapper */
}
.cm-md-table-widget.cm-md-table-overflow-x {
  overflow-x: auto;     /* horizontal scroll only when JS detects overflow */
}
```

- In `cm6Theme.ts`, replace current `.cm-md-table-widget` overflow rules with the above (via theme or drop conflicting inline theme keys in favor of CSS).
- Keep `.cm-md-table-widget table.md-table { display: table; overflow: visible }`.
- Scope out shared `table.md-table { display: block; overflow: auto }` inside `.cm-md-table-widget` (already partially done; verify specificity).
- Table cells: `white-space: nowrap` on `th, td` inside `.cm-md-table-widget`, **except** `.cm-md-table-cell-editing` (`pre-wrap` preserved).
- **No `max-height`** on wrapper.

**JS — conditional horizontal scroll (`wireTableScrollUI`):**

**File:** `src/webviews/md/livePreview/tableWidget.ts`

- Add `wireTableScrollUI(wrap: HTMLElement)` called from `TableWidget.toDOM()` after table render (alongside existing drag/resize wiring).
- `ResizeObserver` + `scroll` listener on `wrap`:
  - Toggle `.cm-md-table-overflow-x` when `wrap.scrollWidth > wrap.clientWidth + 1`.
  - Re-evaluate on column resize, content edit, window resize.
- Existing `scroll` listener for drag-handle repositioning can share the same handler or call into `wireTableScrollUI`'s update.

### Step 6 — Table fade edge

**Files:** `src/webviews/md/livePreview/tableWidget.ts`, `resources/md/mdWebview.css`

- `::after` gradient on `.cm-md-table-widget.cm-md-table-scroll-fade` (right edge, ~24px, `pointer-events: none`).
- Extend `wireTableScrollUI` (or sibling helper) to toggle `.cm-md-table-scroll-fade` when `.cm-md-table-overflow-x` is active **and** `scrollLeft + clientWidth < scrollWidth - 1`.

### Step 7 — Images / Mermaid (best-effort)

- CM6 Preview Edit still renders raw `![...](...)` / ` ```mermaid ` syntax for most cases; rely on `lineWrapping` for long source lines.
- Note in Implementation Log if image widget constraints are deferred.

### Step 8 — Verify compile

```bash
npm run compile
```

### Files touched (expected)

| File | Change |
|------|--------|
| `src/webviews/md/mdWebview.ts` | `setLivePreviewLineWrapping`; `cm6-word-wrap` body class |
| `src/webviews/md/livePreview/cm6Theme.ts` | Table wrapper overflow; cell nowrap; content min-width |
| `src/webviews/md/livePreview/tableWidget.ts` | `wireTableScrollUI()` — overflow class + fade |
| `resources/md/mdWebview.css` | word-wrap scroller lock, fenced-code wrap, table fade |

### Manual QA checklist (for Phase 5)

1. F5 → `samples/test.md` → Preview Edit.
2. **Tall wide table:** vertical wheel over table scrolls the **document** only — no inner vertical scrollbar on the table wrapper.
3. **Wide table:** horizontal scroll inside table only; document does not move sideways (`wordWrap` on).
4. **Narrow table (fits pane):** no horizontal scrollbar on table; wheel does not get "stuck" in a dead scrollbox.
5. Table fade visible when clipped right; gone at scroll end.
6. Toggle `wordWrap` off: long prose/code scroll document horizontally; **table scroll behavior unchanged**.
7. Edit a table cell: active cell wraps; row grows; document scrolls vertically.
8. Row/column drag handles stay aligned during horizontal table scroll.

## Implementation Log

_Not started._

## QA

_Not started._
