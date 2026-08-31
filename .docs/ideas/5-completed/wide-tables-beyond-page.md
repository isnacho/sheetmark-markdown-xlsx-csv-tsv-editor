---
title: Wide tables beyond page width
slug: wide-tables-beyond-page
status: completed
created: 2026-08-15
updated: 2026-08-30
---

# Wide tables beyond page width

## Idea

For tables, I should be able to make tables wider than the max width of the page. I think: how can we start defining tables in a better way? I feel like we are getting a little bit confused around table behavior. Maybe we need some sort of documentation around tables and how they should work. Essentially, I definitely want to be able to make tables wider than the page, even though that's not the default behavior. When the document is loaded, by default, the table should never be wider than the width of the page, but I can manually override that.

## Brainstorm

**Scope:** Markdown editor only — CM6 live preview is the sole surface (normal edit and version-preview read-only). No separate reading/split modes exist; table rules apply to CM6 table widgets everywhere they appear.

**Problem:** Table behavior is implicit across CSS (`mdWebview.css`, `cm6Theme.ts`), `wireTableScrollUI`, column-width persistence, and several completed/in-flight ideas (`table-outline-hugs-content`, `responsive-wrap-table-scroll`). Without a canonical product definition, improvements fight each other (hug vs fill, wrap vs nowrap, document scroll vs table scroll).

**Decided UX — two layout modes:**

### Default layout (on load, no persisted column widths)

- Table never exceeds the content column width (`width: 100%`, `max-width: 100%`).
- Columns share available width equally (`table-layout: fixed`).
- Cell text wraps (`overflow-wrap` / `word-break`) so content does not force horizontal overflow.
- Bordered wrapper (`.cm-md-table-scroll`) spans the full content column.

### Manual layout (user override)

- **Enter:** first column resize on a table, or reopening a file with persisted column widths (`tableColumnWidthStorageService`).
- Table width = sum of explicit column widths (`width: auto`, `max-width: none` on `.cm-md-table-resized`).
- User can make the table **wider than the pane** by dragging columns — no upper cap (minimum column width only).
- **Leave:** double-click a resize handle clears that column; when no explicit widths remain, revert to default layout.
- Cell text: `nowrap` on inactive cells when manual layout + table overflows (per `responsive-wrap-table-scroll`); active editing cell keeps `pre-wrap`.

### When manual layout fits within the pane

- Bordered wrapper **hugs** table width (`cm-md-table-hug-content`) — already shipped in `table-outline-hugs-content`.
- Left-aligned with text column; row-grip gutter unchanged.

### When manual layout exceeds the pane (wide-table override)

- **Isolated horizontal scroll:** wrapper stays pane-width (scroll viewport); bordered chrome is the scrollbox; **document does not scroll horizontally** (when word wrap is on).
- Toggle `cm-md-table-overflow-x` only when `tableWidth > parentWidgetWidth`.
- **No vertical scroll** on the table wrapper — tall tables grow with the document; only `.cm-scroller` owns vertical scroll.
- **Fade edge** on the right when content is clipped off-screen (from `responsive-wrap-table-scroll`).

### Fixed outcomes

- Fresh table with no stored widths → always default layout, never wider than pane.
- Reopening a file with stored widths → manual layout restored (may exceed pane + inner scroll). Persistence is intentional override.
- Column widths persist per file URI via existing storage service.
- Version preview (read-only CM6) follows the same layout rules — no separate table chrome.

**Documentation (canonical product spec):**

- Create `.docs/product/MARKDOWN-TABLES.md` as the **source of truth** for table product behavior (like `MESSAGE-PROTOCOL.md` for messages).
- Include a **behavior matrix** (layout mode × fits pane × editing × scroll ownership).
- Link from `.docs/dev/MAP-mdWebview.md` (short pointer, not duplicate rules).
- **Change rule:** any table behavior PR updates `MARKDOWN-TABLES.md` in the same change.
- Reconcile `responsive-wrap-table-scroll` as implementing the scroll/wrap slice of this spec — do not maintain competing table rules in multiple idea files.
- **Doc hygiene:** remove or reword stale "reading mode / split view / preview-only" references in active pipeline ideas, `PLAN.md`, `MAP-mdWebview.md`, and stale code comments (`mdWebview.ts`, `cm6Theme.ts`). Note: `.markdown-preview` CSS class is the CM6 container shell — not a separate view.

**Implementation sequencing:**

1. Write `MARKDOWN-TABLES.md` from this spec.
2. Implement `responsive-wrap-table-scroll` against the spec.
3. Fix any remaining gaps between code and spec (width policy, overflow detection).

**Out of scope:**

- Separate "expand table beyond page" toggle or menu (resize is the override).
- Document-level horizontal pan for wide tables.
- Sticky first column, per-table wrap toggle.

## Plan

**Goal:** Canonical table product spec + finish the remaining scroll/wrap work from `responsive-wrap-table-scroll`, aligned to the two layout modes above.

**Already shipped (do not re-implement):**

| Area | Where |
|------|--------|
| `wordWrap` live toggle → `setLivePreviewLineWrapping` + `cm6-word-wrap` body class | `mdWebview.ts` |
| Document horizontal scroll lock when word wrap on | `mdWebview.css` `.cm-scroller { overflow-x: hidden }` |
| Fenced code + inline code wrap when word wrap on | `mdWebview.css` |
| Table scroll wrapper DOM (`cm-md-table-widget` > `cm-md-table-scroll` > `table`) | `tableWidget.ts` |
| `wireTableScrollUI` — overflow + hug classes on `.cm-md-table-scroll` | `tableWidget.ts` |
| Default vs manual table CSS (`cm-md-table-resized`, hug-content, overflow-x) | `mdWebview.css`, `cm6Theme.ts` |
| Column width persistence | `tableColumnWidthStorageService.ts`, `setColumnWidthsEffect` |

**No message-protocol changes.**

### Step 1 — Write `.docs/product/MARKDOWN-TABLES.md`

Canonical product spec derived from `## Brainstorm`:

- Purpose and scope (CM6 only).
- **Layout modes:** Default vs Manual (enter/leave, persistence).
- **Behavior matrix** (table):

| Layout | Fits pane? | Wrapper | Cell text (inactive) | Horizontal scroll | Vertical scroll |
|--------|------------|---------|----------------------|---------------------|-----------------|
| Default | always | `width: 100%` | wraps | none | document |
| Manual | yes | hugs (`cm-md-table-hug-content`) | wraps within column | none | document |
| Manual | no (wide) | pane-width scrollbox | `nowrap` | table wrapper | document |

- Scroll ownership, resize/double-click reset, version-preview parity.
- **Change rule:** update this file with any table behavior PR.
- Link to code map: `tableWidget.ts`, `tableColumnWidthStorageService.ts`, table CSS in `mdWebview.css` / `cm6Theme.ts`.
- Note: `.markdown-preview` is the CM6 container shell class name (legacy), not a separate view.

### Step 2 — Link from dev map + doc hygiene

| File | Change |
|------|--------|
| `.docs/dev/MAP-mdWebview.md` | Add row/link under `tableWidget.ts`: "Table product rules → `MARKDOWN-TABLES.md`". Fix "Preview Edit" wording to "CM6 live preview" where it's the only surface. |
| `.docs/product/PLAN.md` | Line 19: replace "split-view preview/editor" with "CM6 live-preview editor". |
| `src/webviews/md/mdWebview.ts` | Reword stale comment at ~857 ("Reading mode" → CM6-only). |
| `src/webviews/md/livePreview/cm6Theme.ts` | Reword table CSS comment (~253–262): remove "Reading mode"; explain shared `.markdown-preview table.md-table` override. |
| `.docs/ideas/3-to-implement/responsive-wrap-table-scroll.md` | Add `**Superseded by:** wide-tables-beyond-page` at top of Plan; trim stale scope lines in Brainstorm when archiving (Step 6). |

### Step 3 — Remaining scroll/wrap code (from absorbed idea)

**3a — `nowrap` on overflowing manual-layout cells**

When `cm-md-table-overflow-x` is active on `.cm-md-table-scroll`, inactive cells in `.cm-md-table-resized` tables should not wrap (prevents table growing past column sum). Active cell keeps `pre-wrap`.

**Files:** `resources/md/mdWebview.css`, `src/webviews/md/livePreview/cm6Theme.ts`

```css
.cm-md-table-scroll.cm-md-table-overflow-x table.md-table.cm-md-table-resized th,
.cm-md-table-scroll.cm-md-table-overflow-x table.md-table.cm-md-table-resized td:not(.cm-md-table-cell-editing) {
    white-space: nowrap;
}
```

Default-layout cells unchanged (still wrap). Manual layout that fits pane unchanged (still wrap within fixed columns).

**3b — Table fade edge**

**Files:** `src/webviews/md/livePreview/tableWidget.ts`, `resources/md/mdWebview.css`, `cm6Theme.ts`

- In `wireTableScrollUI` `update()`, toggle `cm-md-table-scroll-fade` when `cm-md-table-overflow-x` **and** `scrollLeft + clientWidth < scrollWidth - 1`.
- CSS on `.cm-md-table-scroll.cm-md-table-overflow-x.cm-md-table-scroll-fade::after` — right-edge ~24px gradient, `pointer-events: none`, `position: relative` on scroll wrapper (or pseudo on scroll with `position: relative`).

### Step 4 — Width-policy verification (no new features expected)

Manual smoke during QA — confirm code matches spec:

1. Fresh table → default layout, ≤ pane, no inner horizontal scrollbar.
2. Resize column wider than pane → manual layout, `cm-md-table-overflow-x`, document does not pan sideways (`wordWrap` on).
3. Resize columns narrower than pane → `cm-md-table-hug-content`, outline hugs table.
4. Double-click handle → column reset; all cleared → back to default layout.
5. Reload file with persisted wide widths → manual layout restored.

If default-layout table still widens the document (long cell content without resize), check shared `table.md-table { display: block }` rules in `mdWebview.css` — widget override in `cm6Theme.ts` should already win; fix specificity only if QA fails.

### Step 5 — Archive absorbed idea

Move `.docs/ideas/3-to-implement/responsive-wrap-table-scroll.md` → `.docs/ideas/5-completed/archived/responsive-wrap-table-scroll.md` with `status: archived`, reason: "Absorbed into wide-tables-beyond-page + MARKDOWN-TABLES.md", date.

### Step 6 — Verify compile

```bash
npm run compile
```

### Files touched (expected)

| File | Change |
|------|--------|
| `.docs/product/MARKDOWN-TABLES.md` | **New** — canonical spec |
| `.docs/dev/MAP-mdWebview.md` | Link + wording |
| `.docs/product/PLAN.md` | Stale split-view line |
| `src/webviews/md/mdWebview.ts` | Comment hygiene |
| `src/webviews/md/livePreview/cm6Theme.ts` | Comment + nowrap mirror + fade if themed |
| `src/webviews/md/livePreview/tableWidget.ts` | Fade class toggle in `wireTableScrollUI` |
| `resources/md/mdWebview.css` | nowrap + fade CSS |
| `.docs/ideas/5-completed/archived/responsive-wrap-table-scroll.md` | Archived absorbed idea |

### Manual QA checklist (Phase 5)

1. F5 → `samples/test.md`.
2. **Default table:** fits pane; cells wrap; no table horizontal scrollbar; document does not scroll sideways (`wordWrap` on).
3. **Resize wider than pane:** inner horizontal scroll only; fade visible when clipped right; gone at scroll end.
4. **Resize narrower than pane:** outline hugs columns; left-aligned.
5. **Tall wide table:** vertical wheel over table scrolls document only — no inner vertical scrollbar on wrapper.
6. **Cell edit on wide table:** active cell wraps; row grows vertically; document scrolls.
7. **Double-click resize handle:** clears column; full reset returns default full-width layout.
8. **Reload** file after wide resize: persisted widths restore manual wide layout + scroll.
9. **Version preview** (if sample has history): same table chrome as edit mode.
10. Toggle `wordWrap` off: prose/code may scroll document horizontally; table scroll behavior unchanged.

## Implementation Log

**Files changed:**
- `.docs/product/MARKDOWN-TABLES.md` — **new** canonical table product spec + behavior matrix.
- `.docs/dev/MAP-mdWebview.md` — link to MARKDOWN-TABLES; CM6 wording.
- `.docs/product/PLAN.md` — removed stale split-view line.
- `src/webviews/md/mdWebview.ts` — comment hygiene.
- `src/webviews/md/livePreview/tableWidget.ts` — `cm-md-table-scroll-fade` toggle in `wireTableScrollUI`.
- `src/webviews/md/livePreview/cm6Theme.ts` — nowrap on overflowing manual layout; comment cleanup.
- `resources/md/mdWebview.css` — nowrap + fade gradient CSS.
- `.docs/ideas/5-completed/archived/responsive-wrap-table-scroll.md` — archived absorbed idea.

**Deviations:** Prose/word-wrap and core scroll isolation were already shipped before this implementation; only nowrap-on-overflow, fade edge, and documentation were added here. Images/Mermaid best-effort unchanged (lineWrapping + existing widget CSS).

**Verification:** `npm run compile` — 0 type errors, 0 lint errors.

## QA

**Outcome (2026-08-30):** Default tables fit pane with wrapping; manual resize can exceed pane with inner horizontal scroll and right-edge fade; hug-content when narrower; persisted widths restore on reload; `MARKDOWN-TABLES.md` documents behavior. Marked **completed**.
