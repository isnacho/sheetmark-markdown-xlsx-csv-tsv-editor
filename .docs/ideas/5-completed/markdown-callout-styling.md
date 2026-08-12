---
title: Markdown Callout Styling
slug: markdown-callout-styling
status: completed
created: 2026-08-12
updated: 2026-08-12
---

# Markdown Callout Styling

## Idea

At the moment, in the markdown editor, callouts are not styled. Find a way to actually style them, even if it's just a grey background or something like that.

## Brainstorm

### Problem

Callouts (`:::info` / `:::warning` / `:::error` / `:::success`) are already styled in **reading/preview mode** (markdown-it-container + `mdWebview.css`). In **Preview Edit** (CM6 live preview) they render as raw fence text — the slash menu inserts them, but nothing styles them. CM6's markdown parser has no native container node; detection must be custom (scan for `^:::\w+` open / `^:::` close fences).

### Decision

**Type-aware line decorations + reveal-on-approach fences** (options 2 + 5). No full widget replacement (option 3 dropped — too heavy for v1). No always-visible fences (option 4 dropped).

### UX spec

**Scope:** Preview Edit (CM6) only. Reading mode is already correct; legacy WYSIWYG engine is out of scope.

**Detection:** Scan the document for container blocks: an opening line matching `^:::(\w+)` and a closing line matching `^:::\s*$`. Content is everything between (exclusive of fence lines). Unclosed blocks (open fence with no close before EOF) are styled through EOF — same lenient behavior as reading mode would attempt.

**When cursor is away from the block:**
- Hide the opening `:::type` line and closing `:::` line (dim/reveal-mark treatment, same family as heading markers).
- Apply a **line decoration** to every content line inside the block:
  - Background from semantic token: `--info-bg`, `--warning-bg`, `--error-bg`, `--success-bg`.
  - Left border (4px) in the matching semantic color.
  - Slight horizontal padding so text doesn't hug the border.
- First content line gets a small type icon (⚠ ℹ ✗ ✓) via CSS `::before`, matching reading-mode iconography.

**When cursor is inside the block (node-wide active, same rule as blockquotes):**
- Fence lines become visible (dimmed, not hidden) so the user can edit the type or add/remove fences.
- Content lines keep their colored background/border so the block still reads as a callout while editing.

**Callout types:**
- `info`, `warning`, `error`, `success` — use existing theme palette.
- Any other `:::foo` — neutral fallback: `--panel-bg` background, `--border-color` left border, no icon. No new types or slash-menu picker in v1.

**Toggle / setting:** Always active when Preview Edit + reveal decorations are on (same gate as blockquote/heading reveal — tied to `livePreviewReveal`). No separate setting.

**Edge cases (user-visible):**
- Empty callout (open fence immediately followed by close): still shows as a thin styled box.
- Nested markdown inside (lists, code, blockquotes): inner content lines inherit the callout line decoration; inner block styling (e.g. blockquote border) stacks visually — acceptable v1.
- Multiple callouts in one doc: each styled independently.
- Typing a new `:::info` at line start: styling appears once the closing `:::` exists (or unclosed styling kicks in after the open fence).

### Out of scope (v1)

- Full rendered widget / click-to-edit replacement (table pattern).
- Slash-menu type picker (stays `:::info` default).
- New callout types or custom CSS per type.
- Reading-mode changes (already works).

## Plan

1. Add `calloutDecorations.ts` — line-scan `findCalloutBlocks()`, `appendCalloutDecorationSpecs()` hooked into `computeRevealDecorations` (same `livePreviewReveal` gate as blockquotes).
2. Add CM6 theme rules in `cm6Theme.ts` for per-type backgrounds, borders, and first-line icons.
3. Headless tests in `calloutDecorations.test.mts`.

## Implementation Log

- **Added** `src/webviews/md/livePreview/calloutDecorations.ts` — line decorations + fence hide/dim via reveal engine.
- **Added** `src/webviews/md/livePreview/calloutTypes.ts` — fence parsing, block scan, built-in/custom type helpers.
- **Added** `src/webviews/md/livePreview/calloutWidget.ts` — type dropdown when cursor is inside a callout.
- **Added** `src/webviews/md/livePreview/calloutEditing.ts` — opener-line rewrite on type change.
- **Added** `src/webviews/md/livePreview/calloutDefaultType.ts` + `src/shared/calloutDefaultTypeStorageService.ts` — persistent default type for `/callout`.
- **Updated** `revealDecorations.ts`, `cm6Theme.ts`, `slashMenu.ts`, `livePreviewEditor.ts`, `mdWebview.ts`, `mdEditorProvider.ts`, `MESSAGE-PROTOCOL.md`.
- **Iterated UX:** unified block (all lines including fences styled), lighter `color-mix` backgrounds, no left border, rounded corners, icon vertically centered with extra left padding; broader opener detection (`::: info`, optional title, blank `:::`); type dropdown (Info/Warning/Error/Success/Custom) with slug edited on opener line; custom default `:::custom`.
- **Tests:** `calloutTypes.test.mts` — 10 cases. `npm run compile`: 0 errors.

## QA

**Status:** passed (manual smoke test by user, 2026-08-12).

- Preview Edit: existing and new callouts render as unified styled blocks; multi-line content has no white gaps.
- Built-in types show correct colors/icons; custom/`:::custom`/other slugs use neutral grey.
- Type dropdown switches built-ins; Custom sets `:::custom` (editable on opener line); last choice persists for `/callout`.
- Fence hide/reveal and icon alignment accepted after padding/centering tweaks.
- Reading mode unchanged (built-in containers still styled via markdown-it).
