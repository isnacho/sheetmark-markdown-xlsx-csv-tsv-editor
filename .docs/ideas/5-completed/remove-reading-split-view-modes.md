---
title: Simplify Markdown editor — drop legacy engine, Reading, and Split
slug: remove-reading-split-view-modes
status: completed
created: 2026-08-10
updated: 2026-08-12
---

# Simplify Markdown editor — drop legacy engine, Reading, and Split

## Idea

For the Markdown editor, simplify to a single editing paradigm: **Preview Edit (CM6 live preview) only**.

1. Remove **Reading** and **Split Edit** view modes (and the view-mode dropdown / `defaultViewMode` setting).
2. Remove the **legacy contentEditable Preview Edit engine** (`livePreviewEngine: legacy` kill-switch) — the old render-HTML → `contentEditable` → turndown-on-save path.

Assumption: these modes aren't needed and cutting them reduces maintenance burden. CM6 is already the default; legacy is a fallback almost nobody uses.

**Not in scope:** spreadsheet in-cell `contentEditable`, or CM6 table-cell `contentEditable` in `tableWidget.ts` — those are unrelated and stay.

## Brainstorm

### Investigation summary (pre-brainstorm)

Three Markdown surfaces today:

| Mode | What it is | Removable? |
|---|---|---|
| **Reading** | markdown-it rendered HTML, read-only | Yes — but `renderMarkdown()` stays for version-preview |
| **Split Edit** | `<textarea>` + rendered preview + sync scroll | Yes — ~1,000–1,200 LOC in `mdWebview.ts` + split CSS/settings |
| **Preview Edit (CM6)** | CodeMirror live preview (default) | **Keep** — `livePreview/**` (~5,700 LOC) |
| **Preview Edit (legacy)** | `contentEditable` + `execCommand` + turndown | Yes — ~700–900 LOC + `turndown` deps; Markdown-only |

**What does *not* shrink much:** CM6 stack, markdown-it + plugins (still needed for version-history read-only preview).

**Legacy engine is Markdown-only.** `turndown` is only imported in `mdWebview.ts`. Spreadsheet cell editing uses its own `contentEditable` path in `spreadsheetWebview.ts`.

### Proposed phased scope (implementation order)

Do these as separate commits/PRs if pursued — each is independently shippable:

1. **Remove legacy contentEditable engine** — lowest risk; no UX change for default (`cm6`) users. Delete `applyWysiwygFormat`, preview HTML undo stack, `turndown`/`turndown-plugin-gfm`, `xlsxViewer.md.livePreviewEngine` setting, and collapse `isLivePreviewActive()` branches.
2. **Remove Split Edit** — delete textarea, sync scroll, split CSS, `syncScroll`/`previewPosition` settings.
3. **Remove Reading mode** — always open in CM6; redesign save/cancel (no "exit to Reading"); drop view-mode dropdown and `defaultViewMode`.

### Open product questions (need decisions before Plan)

- **Save/cancel UX** when Reading is gone: always-editing with explicit save? auto-save? hide save until dirty?
- **Version preview** stays read-only via `renderMarkdown()` — confirm that's sufficient.
- **Users on `livePreviewEngine: legacy` or `defaultViewMode: reading|split`** — silent migration to CM6/preview, or one-time notice?

### Verdict so far

- **Legacy engine removal:** clear win, do first.
- **Split removal:** good cleanup if nobody uses raw textarea.
- **Reading removal:** moderate LOC gain but real UX/product change — only worth it if committed to CM6-only workflow.

## Plan

### Phase 1 — Remove legacy contentEditable engine (done)

1. Delete `applyWysiwygFormat` + table-hover WYSIWYG helpers, preview HTML undo stack, turndown imports.
2. Simplify `setPreviewEditMode` to always mount CM6.
3. Remove `xlsxViewer.md.livePreviewEngine` setting from `package.json` and `mdEditorProvider.ts`.
4. Remove `turndown`, `turndown-plugin-gfm`, `@types/turndown` dependencies.
5. Trim `wirePreviewInteractions` to reading-mode click handlers only (copy, anchors, lightbox, links).

### Phase 2 — Remove Split Edit (done)

1. Delete `setEditMode`, `#markdownEditor` textarea, `wireEditor`, sync scroll, split textarea formatting helpers.
2. Remove split resize handle; TOC resize only.
3. Remove `syncScroll` / `previewPosition` settings and split CSS.
4. View dropdown: Reading + Preview Edit only; migrate `defaultViewMode: split` → Preview Edit on load.

### Phase 3 — Remove Reading mode (done)

1. Always open in CM6 Preview Edit on first `initSettings`; remove view-mode dropdown.
2. Remove `xlsxViewer.md.defaultViewMode` from `package.json` and `mdEditorProvider.ts`.
3. Simplify save/cancel — save stays in edit mode; cancel resets CM6 content in place.
4. Version preview still uses `renderMarkdown()` read-only; exiting version preview re-enters Preview Edit.

## Implementation Log

**Phase 1 (2026-08-10):** Removed legacy contentEditable Preview Edit path (~1,000 lines from `mdWebview.ts`, 4,299 → 3,331 lines).

- `src/webviews/md/mdWebview.ts` — deleted WYSIWYG/turndown/preview-undo stack; CM6-only `setPreviewEditMode` and `applyFormat`; simplified `getActiveEditorContent`, `applyReloadedContent`, `wirePreviewInteractions`.
- `src/mdEditorProvider.ts` — dropped `livePreviewEngine` from settings push/persist.
- `package.json` / `package-lock.json` — removed `livePreviewEngine` setting and turndown deps.

No deviations from plan. `npm run compile` clean.

**Phase 2 (2026-08-10):** Removed Split Edit mode (~1,065 lines from `mdWebview.ts`, 3,331 → 2,266; CSS 1,795 → 1,661).

- `src/webviews/md/mdWebview.ts` — deleted split editor, sync scroll, textarea format commands; simplified view-mode switching.
- `src/mdEditorProvider.ts` — removed textarea HTML; dropped `syncScroll`/`previewPosition` from settings.
- `package.json` — removed split-related settings; `defaultViewMode` enum is `preview` | `reading` only.
- `resources/md/mdWebview.css` — removed split-view and `.markdown-editor` styles.

Users with `defaultViewMode: split` open in Preview Edit. `npm run compile` clean.

**Phase 3 (2026-08-12):** Removed Reading mode — CM6-only editing surface.

- `src/webviews/md/mdWebview.ts` — removed view-mode dropdown, `setViewMode`/`getCurrentViewMode`, exit-to-reading save path; always mount Preview Edit on first `initSettings`; cancel reloads CM6 in place; version-preview exit calls `ensurePreviewEditMode()`.
- `src/mdEditorProvider.ts` — dropped `defaultViewMode` from settings payloads.
- `package.json` — removed `xlsxViewer.md.defaultViewMode` setting.
- `resources/md/mdWebview.css` — removed `.view-mode-select` styles.

No deviations from plan. `npm run compile` clean.

## QA

`npm run compile` clean. Manual smoke (2026-08-12): Markdown opens directly in Preview Edit (no Reading dropdown); save stays in edit mode; cancel resets CM6 in place; version preview still read-only and returns to Preview Edit on exit. Phases 1–3 all shipped. Marked **completed**.
