---
title: Responsive wrap and isolated table scroll
slug: responsive-wrap-table-scroll
status: planned
created: 2026-08-05
updated: 2026-08-05
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

- Tables keep their natural column widths — cells do **not** wrap to shrink the table.
- Wrap each table in a dedicated scroll container (`.md-table-scroll-wrapper`) with `overflow-x: auto; max-width: 100%`. Remove `display: block` + `overflow: auto` from the `<table>` itself so scroll containment works correctly.
- The document pane (`overflow-x: hidden` on the CM6 scroller / preview container) never scrolls horizontally — only the table wrapper does.
- **Fade edge:** when a table overflows horizontally, show a subtle right-edge gradient fade to signal more content is off-screen. No other scroll polish (no shift+scroll shortcut) in v1.

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

**Root cause:** In CM6 Preview Edit, `.cm-scroller` scrolls both axes (`cm6Theme.ts`). Wide tables (`table.md-table { display: block; width: max-content }` in `mdWebview.css`) expand `.cm-content`, so horizontal wheel/trackpad gestures on a table scroll the whole document. `.cm-md-table-widget` already has `overflowX: auto` but containment is incomplete.

**No message-protocol changes** — `wordWrap` already flows host → `initSettings` / `settingsUpdated` → `mdWebview`.

### Step 1 — Fix live `wordWrap` toggle in Preview Edit

**File:** `src/webviews/md/mdWebview.ts`

- Import `setLivePreviewLineWrapping` from `livePreviewEditor.ts`.
- In `applySettings()` (~1974), inside the existing `isLivePreviewActive()` block, call `setLivePreviewLineWrapping(currentSettings.wordWrap)`.
- When mounting CM6 (`setPreviewEditMode`), toggle a body class `cm6-word-wrap` on/off alongside existing `cm6-preview-active` so CSS can branch (or toggle on `#markdownPreview`).

### Step 2 — Document-level horizontal scroll lock (wordWrap on only)

**Files:** `resources/md/mdWebview.css`, `src/webviews/md/livePreview/cm6Theme.ts`

- When `body.cm6-preview-active.cm6-word-wrap`: `.cm-scroller { overflow-x: hidden }` (vertical scroll unchanged).
- When `wordWrap` off: keep `overflow-x: auto` on `.cm-scroller` (current behavior — whole doc scrolls horizontally for long lines).
- Ensure `.cm-content` can shrink: `min-width: 0; max-width: min(900px, 100%)` (or equivalent) so narrow panes don't force overflow.

### Step 3 — Prose & inline code wrap (wordWrap on)

**Files:** `src/webviews/md/livePreview/cm6Theme.ts`, `resources/md/mdWebview.css`

- `.cm-md-inline-code`: add `overflow-wrap: anywhere` (always, or only when `cm6-word-wrap`).
- Long URLs / plain text: already handled by `EditorView.lineWrapping` once Step 1 wires the toggle; verify no `white-space: nowrap` on `.cm-line` blocks it.

### Step 4 — Fenced code block wrap (wordWrap on)

**Files:** `resources/md/mdWebview.css` (scoped `body.cm6-preview-active.cm6-word-wrap`)

- `.cm-md-fenced-code-line { white-space: pre-wrap; word-break: break-word }` so fence lines soft-wrap visually in addition to CM6 `lineWrapping`.
- When `wordWrap` off: no extra rule; rely on `lineWrapping` off + `.cm-scroller` horizontal scroll.

**Note:** CM6 shows raw fence markers (no reading-mode `.code-block` widget). Ctrl/Cmd+click copy in `livePreviewInteractions.ts` is unaffected.

### Step 5 — Table scroll isolation

**Files:** `src/webviews/md/livePreview/tableWidget.ts`, `src/webviews/md/livePreview/cm6Theme.ts`, `resources/md/mdWebview.css`

- Reuse existing outer wrapper `.cm-md-table-widget` as the scroll container (matches brainstorm's `.md-table-scroll-wrapper` intent — no extra DOM node unless needed). Strengthen CSS:
  - `max-width: 100%`
  - `overflow-x: auto`
  - `overflow-y: visible`
- In `cm6Theme.ts`, keep override `.cm-md-table-widget table.md-table { display: table; overflow: visible }`.
- Add CM6-scoped rule so shared `mdWebview.css` `table.md-table { display: block; overflow: auto }` does **not** apply inside `.cm-md-table-widget` (higher-specificity selector or `body.cm6-preview-active` scope).
- Table cells: `white-space: nowrap` on `th, td` inside `.cm-md-table-widget`, **except** `.cm-md-table-cell-editing` (keeps `pre-wrap` for active cell edit).

### Step 6 — Table fade edge

**Files:** `src/webviews/md/livePreview/tableWidget.ts`, `resources/md/mdWebview.css`

- Add `::after` gradient on `.cm-md-table-widget.cm-md-table-scroll-fade` (right edge, ~24px, `pointer-events: none`).
- In `TableWidget.toDOM()`, after render, attach a small helper (`wireTableScrollFade(wrap)`):
  - `ResizeObserver` + `scroll` listener
  - Toggle `.cm-md-table-scroll-fade` when `scrollWidth > clientWidth` **and** `scrollLeft + clientWidth < scrollWidth - 1`
  - Clean up listeners if widget is destroyed (use `destroy` on widget if available, or weak pattern consistent with existing table widget lifecycle).

### Step 7 — Images / Mermaid (best-effort)

CM6 Preview Edit renders **raw** `![...](...)` and ` ```mermaid ` syntax — no `<img>` or mermaid SVG widgets. No new widgets in this idea.

- Rely on `lineWrapping` for long image URLs / mermaid source lines.
- Document in Implementation Log that rendered-image constraints (`max-width: 100%`) apply only when/if image widgets ship later.

### Step 8 — Verify compile

```bash
npm run compile
```

### Files touched (expected)

| File | Change |
|------|--------|
| `src/webviews/md/mdWebview.ts` | Import + call `setLivePreviewLineWrapping`; toggle `cm6-word-wrap` class |
| `src/webviews/md/livePreview/cm6Theme.ts` | Table cell nowrap; content min-width; optional scroller overflow tweak |
| `src/webviews/md/livePreview/tableWidget.ts` | `wireTableScrollFade()` in `toDOM()` |
| `resources/md/mdWebview.css` | CM6-scoped word-wrap, fenced-code, table fade, scroller overflow-x rules |

### Manual QA checklist (for Phase 5)

1. F5 → open `samples/test.md` → Preview Edit mode.
2. Narrow the editor panel: prose wraps, no horizontal doc scrollbar (`wordWrap` on).
3. Toggle `wordWrap` off in settings: long lines / code scroll the document horizontally again.
4. Wide table: horizontal scroll only inside the table; document does not move sideways.
5. Table fade visible when clipped right; disappears when scrolled to end.
6. Long inline `` `token` `` breaks instead of widening the pane.
7. Edit a table cell: active cell still wraps/edits normally.

## Implementation Log

_Not started._

## QA

_Not started._
