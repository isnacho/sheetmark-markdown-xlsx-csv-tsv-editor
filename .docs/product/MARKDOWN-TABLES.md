# Markdown tables — product behavior

Canonical product rules for GFM pipe tables in the Markdown editor (CM6 live preview).
Implementation lives in `tableWidget.ts`, `tableColumnWidthStorageService.ts`, and table CSS in
`resources/md/mdWebview.css` / `src/webviews/md/livePreview/cm6Theme.ts`.

**Change rule:** any PR that changes table behavior must update this file in the same change.

**Scope:** CM6 live preview only — normal edit and version-preview (read-only). There is no
separate reading or split view. The `#markdownPreview` / `.markdown-preview` DOM shell is the
CM6 container (legacy class names), not a second surface.

---

## Goals

1. **Readable defaults** — new tables fit the content column; cell text wraps; no document
   horizontal scroll (when word wrap is on).
2. **Optional wide tables** — user can resize columns so the table exceeds the pane; horizontal
   scroll is isolated to the table wrapper.
3. **Predictable chrome** — bordered outline hugs narrow resized tables; pane-width scrollbox when
   wide.

---

## Layout modes

### Default layout

**When:** table has no persisted column widths (fresh table, or all manual widths cleared).

- Table element: `width: 100%`, `max-width: 100%`, `table-layout: fixed`.
- Columns share available width equally.
- Bordered wrapper (`.cm-md-table-scroll`): full content column width.
- Inactive cells: text wraps (`overflow-wrap` / `word-break`).
- Table never exceeds pane width from layout alone.

### Manual layout

**Enter:**

- First column resize on a table (adds `.cm-md-table-resized`).
- Reopening a file with stored widths (`TableColumnWidthStorageService`).

**Behavior:**

- Table width = sum of explicit column widths (`width: auto`, `max-width: none`).
- No upper cap on column width (minimum column width only).
- Widths persist per file URI, keyed by table order-of-appearance in the document.

**Leave:**

- Double-click a column resize handle clears that column's width.
- When no explicit widths remain, revert to default layout.

---

## Behavior matrix

| Layout | Fits pane? | Wrapper | Inactive cell text | Horizontal scroll | Vertical scroll |
|--------|------------|---------|--------------------|-------------------|-----------------|
| Default | always | `width: 100%` | wraps | none | document (`.cm-scroller`) |
| Manual | yes | hugs content (`cm-md-table-hug-content`) | wraps within column | none | document |
| Manual | no (wide) | pane-width scrollbox (`cm-md-table-overflow-x`) | `nowrap` | table wrapper | document |

**Active editing cell** (`.cm-md-table-cell-editing`): always `pre-wrap` — row can grow vertically;
document scrolls for tall rows.

---

## Scroll ownership

- **Vertical:** only `.cm-scroller` scrolls vertically. Table wrapper uses `overflow-y: hidden`.
  Tall tables grow with the document; no nested vertical scroll on the table.
- **Horizontal (word wrap on):** document pane does not scroll sideways (`overflow-x: hidden` on
  `.cm-scroller`). When a manual-layout table is wider than the pane, only `.cm-md-table-scroll`
  scrolls horizontally (`overflow-x: auto` when `cm-md-table-overflow-x` is set).
- **Horizontal (word wrap off):** document may scroll horizontally for long prose/code; table scroll
  behavior is unchanged (not gated on word wrap).
- **Fade edge:** when overflowing and not scrolled to the end, a right-edge gradient
  (`cm-md-table-scroll-fade`) signals clipped content.

---

## DOM structure

```
.cm-md-table-widget          ← row/col drag grips sit outside bordered chrome
  .cm-md-table-scroll        ← border, radius, horizontal scroll viewport
    table.md-table           ← GFM table; `cm-md-table-resized` when manual layout
```

Overflow detection compares table width to the **widget** width (parent of scroll wrapper), not
`scroll.clientWidth` (which tracks content when hugging).

---

## Interactions

| Action | Result |
|--------|--------|
| Drag column resize handle | Manual layout; commit widths on mouseup |
| Double-click resize handle | Clear that column; revert to default when all cleared |
| Drag row/column grips | Reorder in source; widths may misattach if table order changes (accepted limitation) |
| Click inactive cell | Activate for inline edit |
| Right-click cell | Row/column context menu |

---

## Version preview

Read-only CM6 uses the same table widgets and layout rules. No separate table chrome.

---

## Related settings

| Setting | Effect on tables |
|---------|------------------|
| `xlsxViewer.md.wordWrap` | Locks document horizontal scroll when on; does **not** change table scroll policy |
| Column widths storage | Per-file; survives reload; migrates on external file move |

---

## Out of scope

- Separate "expand beyond page" toggle (resize is the override).
- Document-level horizontal pan for wide tables.
- Sticky first column.
- Per-table wrap toggle.
- Column widths in raw markdown on disk (extension state only).

---

## Code map

| Concern | File |
|---------|------|
| Widget DOM, resize, scroll UI, cell edit | `src/webviews/md/livePreview/tableWidget.ts` |
| Width persistence (host) | `src/shared/tableColumnWidthStorageService.ts` |
| Table CSS | `resources/md/mdWebview.css`, `src/webviews/md/livePreview/cm6Theme.ts` |
| Dev navigation | `.docs/dev/MAP-mdWebview.md` |
