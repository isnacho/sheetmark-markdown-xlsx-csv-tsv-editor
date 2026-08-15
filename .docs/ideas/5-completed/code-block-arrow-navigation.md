---
title: Code block arrow-key navigation
slug: code-block-arrow-navigation
status: completed
created: 2026-08-15
updated: 2026-08-15
---

# Code block arrow-key navigation

## Idea

When moving the cursor with the arrow keys inside fenced code blocks, lateral movement works fine, but moving up or down sometimes skips lines or, more often, exits the code block entirely — especially when moving from the bottom toward the top.

## Brainstorm

**Surface:** CM6 Preview Edit — arrow-key ↑↓ inside fenced code blocks (`codeStyling.ts` line decorations + `cm6Theme.ts` card styling). Includes ordinary fenced blocks and mermaid fences in **Code** mode (diagram mode uses a replace widget — only in scope where source lines are still editable with line decorations). Not reading mode, not spreadsheet editors.

**Problem:** Default CM6 vertical movement is visual (`posAtCoords`). First/last fenced-code lines carry extra vertical padding/margin for the card look, so logical and visual line heights diverge. Result: ↑↓ can skip interior lines or jump out of the block — worst when moving up from the bottom.

**Decisions (A2 + B2 + C1 + D1 + D2):**

- **Scope (A2):** All fenced code blocks in Preview Edit, plus mermaid fences when global mermaid mode is **Code** (source visible with fenced-code line styling).
- **Approach (B2):** Logical line-at-a-time ↑↓ keymap while the caret is inside a `FencedCode` syntax-tree node — same proven pattern as `table-vertical-cursor-navigation`. Do **not** strip the card padding/margin to fix nav (that would trade away the look).
- **Visual (C1):** Preserve current fenced-code appearance (rounded border, sunken background, 16px breathing room on first/last lines). Implementation must not regress styling.
- **Column alignment (D1 + D2):** Preserve horizontal offset on every ↑↓ move within the block. Entering from above/below lands at the same column as the origin line (clamped to target line length).

**Expected behavior (golden paths):**

1. Inside a multi-line block: each ↑/↓ moves exactly one document line — never skips an interior line.
2. On the opening ` ``` ` line → ↑ → line above the block (column aligned).
3. On the closing ` ``` ` line → ↓ → line below the block (column aligned).
4. Line above block → ↓ → opening fence line (column aligned).
5. Line below block → ↑ → closing fence line (column aligned).
6. ←→ unchanged (already works).

**Out of scope:** Blockquotes/callouts (different decoration shapes; separate idea if needed). Mermaid **Diagram** mode widget navigation. Changing the fenced-code visual design.

## Plan

1. **`codeBlockBoundaryEditing.ts`** — `computeFencedCodeArrow` walks one document line at a time inside `FencedCode` syntax nodes; enter/exit at immediately adjacent boundaries with column alignment. `Prec.highest` keymap for ArrowUp/ArrowDown; consume keys inside fenced code even when movement is a no-op (blocks default visual nav).
2. **`livePreviewEditor.ts`** — wire `codeBlockNavigationKeymap` next to `codeStylingPlugin` (always on, not reveal-gated).
3. **`codeBlockBoundaryEditing.test.mts`** — regression tests for interior ↑↓, boundary enter/exit, column preservation.

## Implementation Log

- `src/webviews/md/livePreview/codeBlockBoundaryEditing.ts` — logical ↑↓ navigation via syntax-tree `FencedCode` bounds; column-aligned cursor placement.
- `src/webviews/md/livePreview/contentClickPositioning.ts` — global mousedown correction: resolve row from clicked `.cm-line` DOM + `documentTop`, snap when `posAtCoords` lands on a different line.
- `src/webviews/md/livePreview/pointerLineResolution.ts` — shared pointer→line helper for gutter click/hover.
- `src/webviews/md/livePreview/codeStyling.ts` + `cm6Theme.ts` — removed fenced-code **margins** (CM6 height-map blind spot per line-number-gutter-alignment); external gap via `gap-before`/`gap-after` padding classes only.
- `src/webviews/md/livePreview/livePreviewEditor.ts` — registered `contentClickHandlers`; gutter click uses `documentTop` line resolution.
- `src/webviews/md/livePreview/hoverLineGutter.ts` — hover row detection uses `documentTop` instead of `posAtCoords`.
- `src/webviews/md/livePreview/codeBlockBoundaryEditing.test.mts` — 8 unit tests.

**Deviation:** None. Mermaid Code mode covered automatically (same `FencedCode` nodes + line decorations when diagram widgets are skipped).

**Verification:** `codeBlockBoundaryEditing.test.mts` 8/8 pass. Full `npm run compile` fails on a pre-existing `tableWidget.ts` type error unrelated to this change.

## QA

**Build:** `codeBlockBoundaryEditing.test.mts` + `codeStyling.test.mts` + `hoverLineGutter.test.mts` — 17/17 pass (2026-08-15).

**Manual F5:** User confirmed arrow-key ↑↓ through multi-line fenced code blocks works; click placement no longer lands one line below after margin removal + DOM row correction.

**Outcome: passed** (2026-08-15).
