---
title: Active line gutter indicator
slug: active-line-gutter-indicator
status: to-qa
created: 2026-08-14
updated: 2026-08-14
---

# Active line gutter indicator

## Idea

When editing Markdown files and the line number functionality is on, I want the line where the cursor is on to have some sort of visual indicator that shows the line. Next to the number, for example, if I'm in line 49, there should be some visual indicator next to line 49. I'm thinking there should be a relatively simple one. Maybe it's just a line or an outline on the left edge of the document that is as high as the line itself, but it shouldn't affect the layout or remove the layout. I really like that the numbers are completely aligned.

## Brainstorm

**Decision:** gutter-only active-line cue in Preview Edit when the line-number gutter is on.

**UX goal:** Make the cursor line obvious in the gutter without disturbing number alignment or document layout.

**Scope:**
- **Preview Edit only**, when **Line Numbers (Preview Edit)** (`livePreviewLineNumbers`) is enabled.
- **Gutter only** — no tint or marker in the content/text column.
- **No new setting** — follows the existing line-number toggle.

**Active-line indicator (two parts, both on `.cm-activeLineGutter`):**
1. **Left-edge bar** — 2px-wide vertical bar on the gutter's left edge, absolutely positioned. Color: `--text-color`. Spans full gutter cell height.
2. **Bold line number** — active row digit uses `font-weight: 700`; numbers stay right-aligned with tabular nums.

**When it shows:** focused editor only (`&.cm-focused`); primary cursor line on multi-line selection.

**Fixed constraints:** no gutter width/alignment/click regressions; tall lines span full cell; out of scope for Reading/Split preview.

## Plan

1. **`src/webviews/md/livePreview/cm6Theme.ts`** — style `&.cm-focused .cm-activeLineGutter` with bold + `--text-color`; add `::before` 2px left-edge bar (absolute, no layout shift).
2. **`src/webviews/md/livePreview/livePreviewEditor.ts`** — add `highlightActiveLineGutter()` (required for `.cm-activeLineGutter` class).
3. **`src/webviews/md/mdWebview.ts`** — gutter toggle uses `livePreviewLineNumbers` only (not OR with code-block `showLineNumbers`).

## Implementation Log

- `src/webviews/md/livePreview/cm6Theme.ts` — focused active-line gutter: bold number, `--text-color`, 2px `::before` left bar.
- `src/webviews/md/livePreview/livePreviewEditor.ts` — added `highlightActiveLineGutter()` so gutter active-line class is applied.
- `src/webviews/md/mdWebview.ts` — removed `wantsLivePreviewLineNumbers()` OR logic; Preview Edit gutter now follows `livePreviewLineNumbers` only (fixes toggle not hiding numbers when code-block line numbers stayed on).
- `npm run compile` — clean after bounce-back fix.

## QA

_Not started._
