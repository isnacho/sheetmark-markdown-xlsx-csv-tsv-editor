---
title: Table outline hugs content width
slug: table-outline-hugs-content
status: completed
created: 2026-08-15
updated: 2026-08-15
---

# Table outline hugs content width

## Idea

When using tables, if I make the width of the columns smaller than the width of the view, the outline of the table container still remains full width. I want the outline to always hug the content.

## Brainstorm

**Decision:** Shrink the bordered table wrapper to hug column content after manual resize, while preserving full-width default tables, left alignment, drag grips, and horizontal overflow scroll.

**UX goal:** When a user resizes columns narrower than the pane, the table's visible outline (border + rounded corners) should match the actual table width — not stretch across the full editor width.

**Scope:**
- **Preview Edit only** (CM6 live preview) — the only surface with column resize.
- **Resized tables only** — default/unresized tables continue to fill the available pane width (`width: 100%`).
- Reading preview and split view are out of scope.

**Behavior:**

### Default (unresized) tables
- No visual change — `.cm-md-table-scroll` stays `width: 100%`; table fills the content column as today.

### Resized tables (`.cm-md-table-resized`, explicit column widths)
- When total table width **≤ pane width**: the bordered wrapper (`.cm-md-table-scroll`) shrinks to hug the table (`width: fit-content` / `max-content`), capped with `max-width: 100%`.
- When total table width **> pane width**: wrapper stays at `max-width: 100%` with horizontal scroll (`cm-md-table-overflow-x`) — same overflow behavior as the in-flight `responsive-wrap-table-scroll` idea; only the "fits in pane" case changes visually.
- **Left-aligned** — outline sits flush with the text column; row-grip gutter on the left is unchanged.

### Fixed outcomes (no options)
- Border radius and cell border styling unchanged.
- No new setting — this is default table chrome behavior.
- Row/column drag grips must continue to position correctly when the wrapper is narrower.

## Plan

**Root cause:** `.cm-md-table-scroll` (the bordered wrapper) is always `width: 100%`. After column resize, the inner `<table>` shrinks via `.cm-md-table-resized { width: auto }`, but the wrapper border still spans the full pane.

**No message-protocol changes.**

### Step 1 — Toggle hug class in `wireTableScrollUI`

**File:** `src/webviews/md/livePreview/tableWidget.ts`

- Extend existing `wireTableScrollUI()` (already toggles `cm-md-table-overflow-x`).
- Compare table width against the **parent widget** width (not `scroll.clientWidth`, which tracks the table when hugging).
- Toggle `cm-md-table-hug-content` when `table.cm-md-table-resized` **and** table fits within the widget.
- Observe parent resize + table `class` mutations so hug state updates on resize commit/reset.

### Step 2 — CSS for hugged wrapper

**Files:** `resources/md/mdWebview.css`, `src/webviews/md/livePreview/cm6Theme.ts`

```css
.cm-md-table-scroll.cm-md-table-hug-content {
  width: fit-content;
  max-width: 100%;
}
```

Default (unresized) tables unchanged — no class, `width: 100%` remains.

## Implementation Log

**Files changed:**
- `src/webviews/md/livePreview/tableWidget.ts` — `wireTableScrollUI()` toggles `cm-md-table-hug-content`; overflow measured against parent widget width; observes parent + table class changes.
- `resources/md/mdWebview.css` — hug-content rule on `.cm-md-table-scroll`.
- `src/webviews/md/livePreview/cm6Theme.ts` — mirror hug-content rule in CM6 theme.

**Deviations:** None.

**Verification:** `npm run compile` — 0 type errors, 0 lint errors.

## QA

**Tested:** 2026-08-15 — manual smoke test in Preview Edit (`samples/test.md`).

| Check | Result |
|---|---|
| Default table — border spans full width | Pass |
| Resize columns narrower than pane — border hugs table | Pass |
| Resize wider than pane — horizontal scroll, full-width wrapper | Pass |
| Double-click resize handle reset — returns to full width | Pass |
| Row/column drag grips on hugged table | Pass |

**Outcome:** Pass — user confirmed "works".
