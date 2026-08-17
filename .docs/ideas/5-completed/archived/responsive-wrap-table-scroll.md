---
title: Responsive wrap and isolated table scroll
slug: responsive-wrap-table-scroll
status: archived
created: 2026-08-05
updated: 2026-08-15
---

# Responsive wrap and isolated table scroll

## Idea

I want the text to wrap when the window is too small, respecting the window width up to a minimum window width of something. Help me define that.

For things like code blocks, the code block should also wrap, but tables should not. The table should remain as long as they are, and the user can scroll horizontally on the table, but only the table should scroll horizontally. The rest of the document should be fixed because, at the moment, scrolling on the table also scrolls the whole document.

## Brainstorm

**Scope:** CM6 live preview (Markdown editor).

**Decided UX direction:**

### Viewport & prose wrapping

- **No minimum width floor** — content always reflows to fit the available pane width; nothing forces document-level horizontal scroll.
- **Keep the existing `xlsxViewer.md.wordWrap` toggle** (default on). When on, ensure Preview Edit actually respects pane width for all prose content, including long URLs, inline code, and images. Fix any gaps where content still overflows horizontally.
- When `wordWrap` is off, prose and code blocks revert to horizontal scroll behavior (current code-block `overflow-x: auto` pattern).

### Code blocks

- **Follow `wordWrap`:** when on, fenced code blocks soft-wrap (`white-space: pre-wrap`; no horizontal scrollbar on the block). When off, horizontal scroll as today.
- Copy button still copies the full original line content.

### Tables

- Tables keep their natural column widths — cells do **not** wrap to shrink the table when overflowing.
- **Vertical scroll:** tables must **not** scroll vertically. Tall tables grow with the document; only `.cm-scroller` owns vertical scroll. No nested scroll-within-scroll when the pointer is over a table.
- **Horizontal scroll:** tables scroll horizontally **only when wider than the pane** (`scrollWidth > clientWidth`). When the table already fits, no inner scrollbox (no stray scrollbars or wheel capture).
- **Implementation note:** use `overflow-x: auto` + `overflow-y: hidden` on the wrapper — **not** `overflow-y: visible`, which browsers coerce to `auto` when `overflow-x` is `auto`, causing the nested vertical scroll bug.
- Reuse the existing `.cm-md-table-scroll` wrapper as the scroll container. Remove `display: block` + `overflow: auto` from the `<table>` itself so scroll containment works correctly.
- **No `max-height`** on the table wrapper — height is always natural; document scroll handles tall tables.
- The document pane (`overflow-x: hidden` on the CM6 scroller / preview container) never scrolls horizontally — only the table wrapper does.
- **Fade edge:** when a table overflows horizontally, show a subtle right-edge gradient fade to signal more content is off-screen. No other scroll polish (no shift+scroll shortcut) in v1.
- **Word wrap toggle:** table scroll is **not** gated on any wrap setting. The spreadsheet wrap toggle is unrelated to Markdown table scrolling.

### Inline elements

- **Inline code:** `overflow-wrap: anywhere` so long tokens break instead of widening the pane.
- **Images:** `max-width: 100%; height: auto`.
- **Mermaid diagrams:** fit container width; internal scroll only if the diagram exceeds the pane.

### Out of scope

- Sticky first table column.
- Per-block or separate "wrap code" toggle.
- Hard minimum-width floor or narrow-panel warning.

## Plan

**Superseded by:** [wide-tables-beyond-page](../../3-to-implement/wide-tables-beyond-page.md) + `.docs/product/MARKDOWN-TABLES.md`.

Most prose/word-wrap and table scroll isolation steps were implemented before absorption; remaining nowrap-on-overflow and fade edge shipped in wide-tables-beyond-page (2026-08-15).

**Archived:** Absorbed into wide-tables-beyond-page + MARKDOWN-TABLES.md (2026-08-15).

## Implementation Log

Absorbed — see `wide-tables-beyond-page` Implementation Log.

## QA

_Not run under this idea — see wide-tables-beyond-page._
