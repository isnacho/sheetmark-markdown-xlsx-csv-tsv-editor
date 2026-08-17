---
title: Better List Styling and Navigation
slug: better-list-styling-navigation
status: to-qa
created: 2026-08-16
updated: 2026-08-16
---

# Better List Styling and Navigation

## Idea

I want to style lists better, including bullet lists and number lists. I want the bullet or number to be slightly offset from the left margin of the page. This could be very small, maybe 2 to 4 px, and then I want to increase the space between the bullet or number and the start of the text by maybe 30%.

I'm also finding a problem with the bullets when moving the cursor through the bullets with my arrow. It seems like if I'm at the leftmost of the text before the bullet, then I go left and I can still go closer to the bullet. I go left and I go to the left of the bullet, and then left again to go to the top, to the line above.

I want this to work like in Notion, in which a bullet is almost one unit. If I'm in the leftmost of the text and I click left, that should take me to the line above.

Also, there's another issue here: if I delete a bullet, so I'm in the leftmost of the text and I click delete or backspace, then there's still one space remaining. I need to delete, so clicking delete deletes one bullet. Clicking delete again then deletes that orphan space. Again, the bullet should be this one unit, so clicking delete should delete the whole bullet.

## Brainstorm

Checked current code before scoping: `revealDecorations.ts` already renders
bullet/ordered markers as replace-widgets (`BulletMarkerWidget`,
`OrderedMarkerWidget`); ordered lists already use `orderedListAtomicRanges`
so the cursor can't rest inside multi-char markers like `12.`. Plain bullet
markers do not — and the mandatory gap space after every `ListMark` (`- `,
`1. `) is still a real document character unless hidden (checkbox items
already hide dash + gap; plain bullets leave the gap exposed). That explains
the reported arrow-key stepping and two-press delete.

Decided scope, as a product spec:

**1. Preview Edit only.** CM6 live preview — no Reading-mode HTML pipeline
changes.

**2. Notion-style marker unit (navigation + delete).** For bullet lists,
ordered lists, checkbox task items, and setext-as-bullet marker lines: treat
the marker plus its single gap space as one atomic cursor unit.

- **Arrow left** from the leftmost position in item text skips the whole
  unit in one step — lands on the previous line (or end of previous item),
  not on positions inside/around the marker.
- **Backspace / Delete** at item start removes the whole unit in one
  keypress (marker char(s) + gap space), not marker then orphan space.
- Extends today's ordered-only `atomicRanges` pattern to bullets and
  includes the gap space in the atomic span; add explicit delete handling
  where CM6 default still leaves a remnant.

**3. Marker inset ~4px.** Nudge the visible marker (dot or number label)
~4px right from the line's content-left edge at every list depth. Nested
indent from Tab/space rules stays as today — this is a small visual inset
within each level, not a change to indent semantics.

**4. 6px gap between marker and text.** Increase marker-to-text spacing to
6px (bullet widget margin and ordered-marker spacing aligned). Hide the
literal gap space in preview (same approach as task checkboxes) so users
don't see a phantom character — the 6px gap is purely visual via widget
margin/CSS.

**5. Checkbox task items included.** `[ ]` / `[x]` widget + gap follow the
same atomic navigation and one-press delete rules; dash already hidden.

**6. Setext-as-bullet lines included.** `paragraph\n- ` ambiguity lines get
the same inset, 6px gap, hidden gap space, and atomic unit behavior.

**Out of scope:** new settings toggle; changing marker family, depth-cycling
labels, auto-sequential numbering, or Tab/Shift-Tab indent behavior
(list-editing-polish territory).

## Plan

1. **`listMarkerEditing.ts` (new)** — `computeListItemPrefixRange` (ListMark or
   TaskMarker + gap space), `computeListMarkerRanges` (+ setext-as-bullet lines),
   `listMarkerAtomicRanges`, keymap for Backspace/Delete/ArrowLeft at prefix
   boundaries. Export `listMarkerBoundaryExtensions`.

2. **`revealDecorations.ts`** — Hide gap space after plain bullet and ordered
   markers (`hideMarkerGapAfter`). Remove `orderedListAtomicRanges` (superseded
   by unified list marker atomic ranges).

3. **`cm6Theme.ts`** — Marker inset `marginLeft: 4px`; marker-to-text gap
   `marginRight: 6px` on bullet, ordered, and checkbox widgets.

4. **`livePreviewEditor.ts`** — Replace `orderedListAtomicRanges` with
   `...listMarkerBoundaryExtensions` in both `revealCompartment` sites.

5. **Tests** — `listMarkerEditing.test.mts` (prefix ranges, backspace, delete,
   arrow-left). Update `revealDecorations.test.mts` for hidden bullet gap.

## Implementation Log

- **New** `src/webviews/md/livePreview/listMarkerEditing.ts` + test file.
- **Updated** `revealDecorations.ts`, `cm6Theme.ts`, `livePreviewEditor.ts`,
  `revealDecorations.test.mts`.
- Checkbox prefix uses `TaskMarker` node (not full `Task`, which incorrectly
  includes item text in the lezer tree).
- Setext-as-bullet detection inlined in `listMarkerEditing.ts` (same rules as
  `listSetextAmbiguity.ts`) so unit tests load without Node ESM extension issues.
- `npm run compile` clean; `listMarkerEditing.test.mts` 13/13 passing.
- **QA fix:** `ArrowRight` skips marker prefix — from line above (or marker
  start) lands at item text start; `ArrowLeft` from marker start also jumps to
  previous line end so cursor cannot rest before the visible marker.
- **QA fix:** Tab indent — keymap always returned `true` even on no-op
  (swallowed Tab); moved Tab/Shift-Tab to `Prec.highest` `livePreviewTabKeymap`.
  Top-level only list items now indent at line start by marker width when there
  is no preceding sibling to nest under.

## QA

_Not started._
