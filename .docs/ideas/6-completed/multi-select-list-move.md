---
title: Multi-select list items with Tab/Shift+Tab move
slug: multi-select-list-move
status: completed
created: 2026-07-20
updated: 2026-07-21
---

# Multi-select list items with Tab/Shift+Tab move

## Idea

Select multiple list items with cursor. Then press Tab or Shift+Tab to
indent/outdent all selected items as one unit (move them one level
together), not just the single item the cursor sits on.

## Brainstorm

Checked current code first (`src/webviews/md/livePreview/formatCommands.ts`).
`computeTabIndent` already has a multi-line branch: any selection spanning
more than one line routes into `computeMultiLineIndent`, which shifts every
line by a flat 4 spaces. This is the pre-fix behavior that the sibling idea
([[list-editing-polish]]) found corrupts list structure for the single-cursor
case (second Tab press, or an item with no sibling to nest under, overshoots
CommonMark's indent tolerance and swallows the marker) — the multi-line path
never got that fix, so the exact same corruption is reachable today just by
selecting multiple lines first. So this idea is not new selection UI, it's
extending the marker-aware, structure-safe Tab/Shift-Tab logic (built for one
cursor) to cover a multi-line selection. Also confirmed no multi-cursor
extension (`EditorState.allowMultipleSelections`) is enabled in this editor —
"select multiple list items with my cursor" means an ordinary contiguous
drag/shift-click text selection spanning several item lines, which already
works natively today. No new selection mechanism needed.

Decided scope, as a product spec:

**1. Atomic all-or-nothing move.** Tab/Shift-Tab on a multi-line selection
indents/outdents every list-item marker line in the selection by exactly one
level, together, as a single unit — but only if *every* marker line in the
selection can safely make that move (same per-item depth-validation the
single-cursor path already does). If even one item in the selection would
corrupt (no sibling to nest under, already at max valid depth, etc.), the
whole key press is a no-op — nothing in the selection moves. Confirmed with
user over best-effort/partial (some items move, others don't) specifically
to preserve "move them as one unit" and stay consistent with the existing
disable-rather-than-partially-corrupt philosophy from the sibling idea's
bugfix.

**2. Mixed selections handled per-line by kind.** A selection can contain
list-item marker lines, their wrapped continuation lines, and ordinary
non-list lines (e.g. a plain paragraph between two bullets) together. Marker
lines get the safe list-aware shift (validated per #1); continuation lines
shift by whatever amount their owning marker line shifts, staying visually
aligned under it; ordinary non-list lines keep exactly today's flat
4-space/tab shift. Same per-line-kind split the single-cursor path already
does, just applied across every line touched by the selection.

**3. Selection boundaries follow today's line-touching rule.** If the
selection only partially covers the first or last line, the whole line
still participates (matches `computeMultiLineIndent`'s existing behavior —
no new edge case introduced).

**4. Items already at different depths move independently but together.**
If the selection spans items at different existing nesting levels, each
still gains/loses exactly one level relative to its own current depth (the
per-item validation in #1 is evaluated per item, not against one global
depth) — a flat 2-space-vs-4-space marker-width difference between bullet
and ordered items doesn't block the batch.

Explicitly out of scope: discontiguous multi-cursor multi-select (Cmd/Ctrl+
click to select several non-adjacent items) — not enabled in this editor at
all today, and out of scope to add just for this.

## Plan

_Not started._

## Implementation Log

Plan phase explicitly skipped at user's request (confirmed via prompt: "Skip Plan
phase... jump straight to Implement?" -> yes). Implemented directly against the
Brainstorm spec.

Before coding, re-read `formatCommands.ts` fresh and found it had moved on since the
brainstorm — the sibling idea's single-cursor Tab path (`computeTabIndent`) no longer
uses a flat 4-space shift; it now computes the exact neighbor marker width
(`markerPrefixWidth`/`previousSiblingListItem`/`parentListItem`) and validates the
resulting depth change. Only the multi-line branch (`computeTabIndent`'s
`from !== to` + contains `\n` check) still delegated to the old flat, unsafe
`computeMultiLineIndent` — same unvalidated-flat-shift bug this idea targets was still
live there.

- `src/webviews/md/livePreview/formatCommands.ts`: added
  `computeMultiLineListAwareIndent(state, outdent)`. Per touched line: resolves the
  enclosing `ListItem` at that line's first non-whitespace position; a marker line
  gets its step from `markerPrefixWidth` of the neighbor it's moving to/from
  (`previousSiblingListItem` for indent, `parentListItem` for outdent) — if that
  neighbor doesn't exist, returns `null` immediately, aborting the whole selection
  (atomic, per the confirmed all-or-nothing decision); a continuation line rides along
  at its own item's marker width; a line outside any list item keeps today's flat
  4-space/tab step. After building the combined edit, re-parses the trial result and
  re-checks every marker line's depth changed by exactly one level (same
  belt-and-suspenders check as the single-cursor path) — any mismatch aborts the whole
  batch too. If the selection touches no list items at all, returns the same result as
  the old flat behavior (no behavior change for plain multi-line Tab). `computeTabIndent`'s
  multi-line branch now calls this instead of `computeMultiLineIndent` directly.
  `computeMultiLineIndent` itself is untouched (still used/tested as the plain flat
  primitive; no other call site needed changing).
- `src/webviews/md/livePreview/formatCommands.test.mts`: added
  `computeMultiLineListAwareIndent` to the import list and 6 new tests — sibling items
  nesting together under a preceding item, symmetric outdent, atomic abort when one
  item in the selection has no sibling/parent to move to, a mixed list+plain-line
  selection (plain lines keep the flat shift), a wrapped continuation line riding along,
  and a no-list-items selection matching the old flat behavior exactly.
- Verified: `npm run compile` clean (0 type/lint errors); `npm run test:unit` — all
  150 tests passing, including the 6 new ones.

No message-protocol changes (pure webview-side CM6 logic, same as the sibling idea).

**Bounce-back from manual QA:** user reported it "mostly doesn't work," with two
concrete symptoms — "the cursor and selection can be at any point in the line, any
selected character should count" and "the last bullet point should also be moved."
Diagnosis (confirmed by direct function probes, not guessed):

1. The atomic all-or-nothing rule (confirmed earlier in Brainstorm) bites hardest on
   the single most natural test: selecting a WHOLE list and pressing Tab. Item 1 can
   structurally never have a sibling above it, so any selection including it was a
   permanent no-op — most of the reported failures. Re-confirmed with the user via
   prompt: switch to best-effort (a line that can't move stays put, doesn't block the
   rest) — approved over keeping atomic.
2. A real, separate bug found via direct probing: sibling ordered-list items whose raw
   marker text differs in width (single- vs double-digit, "9." vs "10.") were each
   computing their step from their OWN immediate neighbor independently, producing a
   jagged, inconsistent shift instead of landing as clean siblings.

Fix, `computeMultiLineListAwareIndent` rewritten:
- Classifies each line as marker/continuation/ordinary (unchanged from before).
- Per marker line, its own neighbor (`previousSiblingListItem`/`parentListItem`)
  determines ELIGIBILITY individually — "only" (no neighbor, ever) is never eligible,
  regardless of what any other line in the selection can do. (First attempt at the
  best-effort fix got this wrong: it shared a step map keyed only by depth, so any
  OTHER line at the same depth having a neighbor incorrectly made the neighborless
  line "eligible" too — caught by a test and fixed.)
- Once eligible, the ACTUAL step width is shared across every line at that same
  original depth (first eligible one sets it), not each line's own neighbor width —
  fixes the double-digit misalignment.
- Validation is a fixed-point loop: build the full combined trial with every
  still-"movable" candidate applied, re-parse, check each one's depth in THAT trial
  (not in isolation against the un-shifted original — a second bug found the same
  way: item 11 nesting correctly under item 9 depends on item 10 ALSO having moved,
  so isolated single-line validation gave a false negative), drop any that fail, and
  repeat until stable.
- Genuine no-op (nothing in the selection could move) still returns `null`.
- `src/webviews/md/livePreview/formatCommands.test.mts`: updated the "atomic" test to
  best-effort ("only" stays, "two" still nests under it), added a whole-list-selected
  test and a single/double-digit-boundary uniform-shift test.
- Verified via direct function probes (ad hoc, not committed) before writing the real
  tests — reproduced both bugs empirically rather than guessing from re-reading code.
- `npm run compile` clean; `npm run test:unit` — 153/153 passing.

Known limitation, out of scope for this fix: the sibling idea's single-cursor path has
a digit-reset trick (`computeOrderedNestIndentBy`) for when an ordered item becomes the
first child of a brand-new nested list, so the visual numbering widget seeds correctly.
The multi-line path does not replicate this — nesting multiple ordered items together
into a new list may show a stale seed digit until re-verified in manual QA.

**Bounce-back #2 from manual QA:** user reported a specific remaining break: selecting
3 items where 2 are at one depth and 1 is a level deeper — the 2 shallower items moved,
but the deeper one didn't, breaking their relative nesting. Root cause: the "best-effort
per marker line" model from bounce-back #1 gated EVERY marker line's eligibility on
"does it have its own sibling/parent to move to" — correct for independent siblings,
wrong for a child whose parent is ALSO in the selection: a lone child (no sibling at its
OWN depth, which is the common case) always failed that check and got left behind.

Fix: marker lines now split into "roots" (no marker-line ancestor within the same
selection) and "descendants" (nearest list-item ancestor's marker line IS also
selected). Only roots run the independent eligibility check; a descendant never checks
its own sibling situation — it simply inherits whatever shift its nearest selected
ancestor ends up getting (mirrored via `parentMarkerIndex`, propagated top-to-bottom
since ancestors' lines always precede descendants' in a contiguous selection). Shifting
a descendant by the exact same column amount as its ancestor mathematically preserves
the gap between them (proven via `markerPrefixWidth` being relative, not
absolute-column-dependent), so the whole selected subtree — including 3+ level
ancestor chains — moves as one rigid unit, keeping pre-existing depth differences
intact. Descendants are never independently re-validated by re-parsing (skipped as an
optimization, since the gap-preservation argument makes it provably safe); only roots
go through the existing fixed-point re-parse loop, now re-propagating to descendants
after every root gets disabled.

Verified via direct function probes before writing permanent tests: 2-sibling +
1-deeper-child selection, a 3-level ancestor chain, the outdent-symmetric case, and the
case where the root itself can't move (its child correctly stays put too, doesn't
independently nest deeper on its own). All four behaved correctly on first try with
this design.

- `src/webviews/md/livePreview/formatCommands.test.mts`: added 4 tests for the above
  scenarios.
- `npm run compile` clean; `npm run test:unit` — 157/157 passing.

## QA

Status: completed. Two bounce-backs along the way — see Implementation Log:
1. Atomic all-or-nothing → best-effort, plus double-digit ordered-marker misalignment.
2. Mixed-depth selections (some items shallower, one deeper) didn't preserve relative
   depth — the deeper item got left behind. Fixed via root/descendant propagation.

`npm run compile` clean, `npm run test:unit` 157/157 passing. User ran the manual F5
smoke-test pass (round 3) and confirmed it now works — marked complete.

Smoke-test checklist (F5, sample `.md` file, Preview Edit mode):

- [ ] Select an ENTIRE flat bullet list (all items, including the first) and press
      Tab — item 1 stays put, every other item nests under it together.
- [ ] Drag-select (or Shift-click) across 2-3 sibling bullet items with a preceding
      item to nest under; Tab nests all selected items together, one level, staying
      siblings of each other.
- [ ] Select items at MIXED depths together (e.g. two siblings plus one of their
      existing children) and press Tab — everything moves down one level together,
      the pre-existing depth gap between the child and its siblings is unchanged.
- [ ] Same with a 3+ level ancestor chain all selected together — the whole chain
      shifts as one rigid block.
- [ ] Shift-Tab on any of the above outdents symmetrically, gaps still intact.
- [ ] A numbered list with 10+ items: select two items straddling the single/double-
      digit boundary (e.g. items 9 and 10, or 10 and 11) — both shift by the same
      amount, no jagged/mismatched indent.
- [ ] Select a range mixing list items and an ordinary paragraph line (separated by
      a blank line from the list) — Tab shifts the list items by their marker width
      and the plain line by the old flat 4 spaces, in the same key press.
- [ ] Select a list item plus its own wrapped continuation line — Tab moves both
      together, continuation line staying visually aligned under the marker.
- [ ] Selection with mid-line start/end points (not snapped to line boundaries) —
      confirm every touched line still participates correctly.
- [ ] Same tests against an ordered (numbered) list, incl. with the depth-cycling
      marker widget from the sibling idea visibly updating for all moved items. Watch
      specifically for the known limitation noted in the Implementation Log (stale
      seed digit when nesting multiple ordered items into a brand-new nested list).
- [ ] Select a range of plain, non-list text spanning multiple lines — Tab still
      behaves exactly as before (flat 4-space indent), no regression.
- [ ] Toggle the reveal setting off/on — no interaction issues with the new
      multi-line path (it's plain text editing, not a decoration/widget).
