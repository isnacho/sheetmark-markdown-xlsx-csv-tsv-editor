---
title: Show heading hash markers
slug: show-heading-hash-markers
status: completed
created: 2026-08-10
updated: 2026-08-10
---

# Show heading hash markers

## Idea

When I enter a # to create a heading, the # does not show. I think it should show and essentially turn the line into whatever heading it is. If it's a #1, heading 1, 2, 3, etc., the # should definitely appear.

## Brainstorm

### Context

Preview Edit mode (CM6 live preview) already styles heading **content** at the correct size/weight all the time. The `#` markers follow the general reveal rule: **hidden** when the cursor is away, **dimmed** only while the cursor is on that heading line.

### Decided UX

**Reveal ATX heading `#` markers only while the cursor is on the heading line** (Preview Edit, Live Preview Reveal on).

| Element | Behavior |
|---|---|
| Opening `#`…`######` | Hidden when cursor is on another line; dimmed at heading size when cursor is anywhere on the heading line (including mid-typing `#` / `# `). |
| Closing `#` (rare `## Title ##` form) | Same line-based reveal. |
| Heading content | Unchanged — always at heading size/weight. |
| Other marks | Unchanged — hide away / dim on cursor in element. |

### Edge cases

- **Mid-typing** (`#`, `# `): caret at end of title-less heading must reveal `#` (line-based active check, not half-open node range).
- **Cursor on another line**: `#` hidden on distant headings.

## Plan

1. **`revealDecorations.ts`** — `isHeadingLineActive`: collapsed caret on heading line reveals markers; restore hide/dim branches in `handleHeading`.
2. **Tests** — restore cursor-away expectation; add mid-typing `#` / `# ` cases.

## Implementation Log

- `src/webviews/md/livePreview/revealDecorations.ts` — First pass always-on markers (reverted per user feedback). Second pass: `isHeadingLineActive` for line-based reveal + restored hide-away when cursor leaves the line.
- `src/webviews/md/livePreview/revealDecorations.test.mts` — Updated tests.
- `src/webviews/md/livePreview/cm6Theme.ts` — Comment only.

`npm run compile` clean. Unit tests pass.

**Bounce-back:** User confirmed they want reveal-on-line only, not always-visible markers.

## QA

**2026-08-10** — Manual smoke test in Extension Development Host (user confirmed "works"):

- [x] Type `# ` / `## ` at line start — `#` visible while on the line
- [x] Move cursor to another line — `#` hides on the heading left behind
- [x] Heading content stays at correct size when cursor away

Unit tests: 189 pass (heading reveal + mid-typing cases).
