---
title: List editing polish (indent, numbering, checkboxes)
slug: list-editing-polish
status: completed
created: 2026-07-20
updated: 2026-08-12
---

# List editing polish (indent, numbering, checkboxes)

## Idea

Current problems:
- Indenting lists do not indent bullet/number
- pressing tab with the cursor on any location in list item should indent the list
- on a numbered lists, indening levels should be defined 1>a>i>... suggest here
- on numbered lists
- checkboxes have a dash beforehand, remove
- on numbered lists, the cursor can be placed between the number and the dot. this shouldn't be possible.
- shift+tab should remive the indent

## Brainstorm

Checked current code (`src/webviews/md/livePreview/formatCommands.ts`,
`revealDecorations.ts`) before scoping: `computeTabIndent` today inserts 4
spaces at the raw cursor offset with zero list-awareness — confirms the
reported bugs. `revealDecorations.ts` already has the widget/decoration
pattern (`TaskCheckboxWidget`, `ListMark` decoration) this scope builds on.

Decided scope, as a product spec:

**1. List-aware Tab/Shift-Tab.** Cursor anywhere on a list-item line (not
just at line-start) — Tab indents the whole line one level, Shift-Tab
outdents it, marker and text move together as a unit. Lines that are *not*
list items keep exactly today's behavior (Tab inserts 4 spaces at cursor;
Shift-Tab outdents only if cursor is right after leading whitespace) —
unchanged, not touched by this idea.

**2. Depth-cycling ordered-list markers (decimal → alpha → roman).**
Depth 1 = `1. 2. 3.`, depth 2 = `a. b. c.` (lowercase), depth 3 = `i. ii.
iii.` (lowercase roman), cycle repeats from depth 4 (back to `1.`). Visual
only — the raw markdown stays plain numeric at every nesting level (`a.` is
not valid CommonMark; Reading mode, Obsidian, and GitHub all need real
numbers). Same pattern as the existing `TaskCheckboxWidget`/table widget:
a replace-decoration renders the depth-appropriate label over the marker
range, source text untouched.

**3. Auto-sequential numbering, for free from #2.** Because the rendered
label is computed from the item's position in its list (not parsed from
whatever digits the user typed), numbers/letters/romans stay visually
sequential automatically after adding, deleting, or reordering items (incl.
via the existing Alt+Up/Down move commands) — no separate renumbering
mechanism needed, it falls out of the decoration approach.

**4. Checkbox dash removed.** On task-list items only, hide the bullet
`ListMark` (the `-`) — the checkbox widget already signals "this is a list
item," the dash is redundant there. Plain bullet lists and plain numbered
lists keep their marker exactly as today; this is scoped to checkboxes
specifically.

**5. Cursor can't land inside an ordered-list marker.** Treat the whole
marker (`12.`, `3)`) as one atomic unit for cursor placement, clicking, and
arrow-key movement — landing "inside" it snaps to just before or just after.
Bullet markers are single-character (`-`/`*`), so no "inside" position
exists there; this only applies to ordered lists.

**6. Indent/outdent never changes marker family.** Descending a level keeps
whatever marker type the item already has (bullet stays bullet, number
stays number). Switching a line between bullet and numbered is still the
existing `Mod-L` / `Mod-Shift-L` toggle commands — no auto-switch-to-bullet
under a numbered parent.

**7. Verify-first item for Plan: Enter on an empty list item.** Should exit
the list (outdent to a plain paragraph) rather than continuing it forever.
`@codemirror/lang-markdown`'s built-in `insertNewlineContinueMarkup` may
already do this — confirm during Plan before adding new code; only build it
if it's missing.

Explicitly out of scope for this idea: vertical nesting-depth guide lines
(considered, cut — pure polish, easy standalone follow-up later).

## Plan

Full plan: `/Users/UALLEIG/.claude/plans/flickering-hatching-whistle.md`. All webview-side
(`src/webviews/md/livePreview/`), no message-protocol/host changes.

**1. List-aware Tab/Shift-Tab** (`formatCommands.ts`): new `enclosingListItem(state, pos)`
helper (walks `node.parent` for a `ListItem` ancestor, same shape as
`revealDecorations.ts`'s `enclosingBlockquote`). `computeTabIndent` routes any collapsed
cursor on a list-item line into the existing `computeMultiLineIndent` (already does per-line
4-space shift+selection-adjust) instead of its old cursor-relative-insert path; non-list
lines unchanged. Guard: Shift-Tab on an already-flush list line must stay a true no-op (skip
delegating when there's no leading whitespace to remove). Marker family never changes on
indent — falls out for free, no extra code.

**2. Depth-cycling ordered markers (1→a→i, cycling every 3 depths) + auto-sequential
numbering** (`revealDecorations.ts`): new pure helpers `numberToLowerAlpha`,
`numberToLowerRoman`, `formatOrderedMarkerLabel`, `listContainerDepth` (counts all
Bullet/OrderedList ancestors — mixed-nesting depth is a deliberate simple default),
`listItemPosition`, `orderedListStartNumber`, `computeOrderedMarkerLabel` (returns `null` for
non-ordered markers). New `OrderedMarkerWidget` (inline replace decoration, lives in the
existing `livePreviewRevealPlugin` `ViewPlugin` — no `StateField` needed, this isn't a block
widget). **Must set `ignoreEvent() { return false; }`** (opposite of `TaskCheckboxWidget`'s
`true` — confirmed against `@codemirror/view` source: default is `true`/ignore-all, and this
widget needs native click-to-place-cursor for requirement 4's atomic snap to work). Numbers
seed from the list's first item's own typed digits, then increment by sibling position —
raw markdown source stays plain numeric at every depth (Reading mode/Obsidian/GitHub
compatibility). Applied uniformly at every depth including depth 1, so delete/reorder
auto-renumbers visually with one mechanism.

**3. Checkbox dash hidden** (`revealDecorations.ts`, same change as #2): existing `ListMark`
branch becomes a `handleListMark` closure — ordered→widget, bullet+has-`Task`-sibling→new
`cm-md-checkbox-bullet-hidden` mark decoration (hides dash + the 1-char gap before the
checkbox, non-destructive), plain bullet→unchanged `listMarkDeco`. Order matters: ordered
check first, so numbered checklists get the widget, not the dash-hide branch.

**4. Ordered markers atomic for cursor** (`revealDecorations.ts` + `livePreviewEditor.ts`):
new `computeOrderedMarkerRanges` (pure, whole-document scan — deliberate, so off-screen jump
targets like `Mod-g` still resolve correctly) + `orderedListAtomicRanges` extension
(`EditorView.atomicRanges.of(...)`, first use of this facet in the repo). Registered inside
the existing `revealCompartment` alongside `livePreviewRevealPlugin`/`tableWidgetField` — **both
call sites** (`livePreviewEditor.ts`'s `EditorState.create` array and `setLivePreviewReveal`)
must be edited together, so atomicity toggles off/on with the reveal setting. No automated
test possible for the facet registration itself (no `EditorView` in either test file); the
pure range-collection core is tested.

**Requirement 6 (Enter on empty list item exits) needs no code** — already implemented by
`@codemirror/lang-markdown`'s installed `insertNewlineContinueMarkup`; QA-verify only,
including a documented tight-two-item-list nuance (may need two Enters).

**CSS** (`cm6Theme.ts`): `.cm-md-ordered-marker`, `.cm-md-checkbox-bullet-hidden`, inserted
next to the existing `.cm-md-list-mark` rule.

**Tests**: `revealDecorations.test.mts`'s existing "bulleted and ordered markers get the
always-on accent class" test must be *updated* (ordered half breaks once markers become a
widget), plus new tests for the numeral helpers, label sequencing, dash-hiding, and
`computeOrderedMarkerRanges`. `formatCommands.test.mts`'s `stateFor` needs a
`markdown({extensions: GFM})` extension added (needed for the new syntax-tree lookups); full
suite re-run after that shared-helper change.

**Order**: (1) Tab/Shift-Tab, isolated → (2)+(3) together, same `handleListMark` closure,
incl. updating the breaking test → (4) atomicRanges last (riskiest, least test coverage) →
manual F5 QA pass.

Verification: `npm run compile`, `npm run test:unit`, then F5 manual smoke test per the
checklist in the plan file.

## Implementation Log

Implemented exactly per the plan, no deviations from scope.

- `src/webviews/md/livePreview/formatCommands.ts`: added `enclosingListItem(state, pos)`
  (walks `node.parent` for a `ListItem` ancestor). `computeTabIndent` now routes any
  collapsed cursor on a list-item line into the existing `computeMultiLineIndent`, guarded
  so Shift-Tab on an already-flush list line stays a true no-op; non-list lines unchanged.
- `src/webviews/md/livePreview/revealDecorations.ts`: added `numberToLowerAlpha`,
  `numberToLowerRoman`, `formatOrderedMarkerLabel`, `listContainerDepth`,
  `listItemPosition`, `orderedListStartNumber`, `computeOrderedMarkerLabel` (pure helpers
  for the 1→a→i depth cycle + position-seeded auto-numbering); new `OrderedMarkerWidget`
  (inline replace decoration in the existing `livePreviewRevealPlugin` `ViewPlugin` — no
  `StateField` needed; `ignoreEvent()` explicitly returns `false`, the opposite of
  `TaskCheckboxWidget`, so native click-to-place-cursor still works for the atomic-range
  snap). The old one-line `ListMark` handling became a `handleListMark` closure: ordered →
  widget, bullet-with-`Task`-sibling → new `cm-md-checkbox-bullet-hidden` mark (hides the
  dash + the gap before the checkbox), plain bullet → unchanged `listMarkDeco`. Added
  `computeOrderedMarkerRanges` (pure, whole-document scan) + `orderedListAtomicRanges`
  (`EditorView.atomicRanges.of(...)`, first use of this facet in the repo). Updated the
  file-header design-note comment (was: list/task markers "never `Decoration.replace`d") to
  reflect that ordered markers now are, for the numbering reason, while staying
  cursor-position-independent.
- `src/webviews/md/livePreview/livePreviewEditor.ts`: imported `orderedListAtomicRanges`;
  added it to both `revealCompartment` sites (`EditorState.create`'s extensions array and
  `setLivePreviewReveal`) so atomicity toggles off/on together with the reveal setting.
- `src/webviews/md/livePreview/cm6Theme.ts`: added `.cm-md-ordered-marker` (mirrors
  `.cm-md-list-mark`'s look) and `.cm-md-checkbox-bullet-hidden` (`display: none`).
- `src/webviews/md/livePreview/formatCommands.test.mts`: `stateFor` now includes
  `markdown({extensions: GFM})` (needed for the new syntax-tree lookups); added tests for
  `enclosingListItem` and list-aware Tab/Shift-Tab (mid-line indent preserving cursor
  offset, symmetric outdent, no-op on an already-flush line, continuation lines, non-list
  lines unaffected).
- `src/webviews/md/livePreview/revealDecorations.test.mts`: split the old bullets+ordered
  combined test (ordered half would've broken once markers became a widget) into a
  bullets-only test, plus new tests for the numeral helpers, label sequencing (plain,
  mismatched-typed-digits, start-seeded, nested depth cycling, `)` delimiter, numbered
  checklist), checkbox dash-hiding (single/multi-space gap, plain bullet unaffected), and
  `computeOrderedMarkerRanges`.
- Verified: `npm run compile` clean (0 type/lint errors); `npm run test:unit` — 138/138
  passing (all new/updated tests passed on first run, including hand-verified expected
  values for the tree-based cases).

**Bounce-back from QA (still `implemented`, fix applied directly — small enough not to
require a full replan):** manual testing surfaced a real bug the original plan only
partially anticipated. `computeMultiLineIndent` (reused by the new list-aware Tab/Shift-Tab)
always shifts a line by a flat 4 literal spaces, but a bullet marker only needs 2 columns
per nesting level — verified against the real `@lezer/markdown` parser that this over-indent
happens to still parse as valid nesting on a FIRST Tab press (lucky — within CommonMark's
"≤3 relative spaces" tolerance), but a SECOND consecutive Tab press on the same line (or
indenting an item with no preceding sibling to nest under at all) overshoots that tolerance
and the parser reinterprets the line as an indented code block or plain paragraph text —
the list marker silently disappears, matching the user's report of "almost removes the
bullet from the list structure." Confirmed the same failure mode for ordered lists too (3-
column marker width, same mechanism, real parser confirms it also gets rejected).

Fix: `computeTabIndent` now re-parses the trial result before returning it (only for the
`ListItem`'s own marker line — a wrapped continuation line is exempt, since indenting it
never changes list depth) and checks via a new `listItemDepth` helper that the depth
actually changed by exactly one level. If it didn't, Tab/Shift-Tab is a true no-op (returns
`null`) instead of corrupting the structure — matches the user's explicit ask ("indenting
should be completely disabled" rather than partially breaking the list). Two iterations were
needed to get the probe position right: probing depth at the line's raw start position is
unreliable once a line already carries "extra" leading whitespace beyond what its own depth
structurally requires (that gap resolves to the wrong, shallower ancestor) — fixed by probing
at the actual (mapped) cursor position instead, which is always inside real content.

Also rewrote two existing tests whose fixtures were, in retrospect, exactly this same bug
(a single ungrounded item, and a synthetic pre-indented item with no established context) —
both now use valid two-item fixtures, plus new regression tests for the no-preceding-sibling
case and the second-Tab-overshoot case (bullet and ordered). Final count: `npm run compile`
clean; `npm run test:unit` — 143/143 passing.

**Second bounce-back from QA (still `implemented`, fix applied directly):** user reported
"indenting one level in preview actually indents two levels in markdown." Root cause: the
previous fix disabled the *corrupting* overshoot case, but never corrected the underlying
flat-4-spaces step itself — a bullet marker ("- ") only needs 2 columns per level, an ordered
marker ("1. ") needs 3, and the first Tab press was still writing 4 literal spaces either
way. That first press "happened to" still parse as one structural nesting level (within
CommonMark's tolerance for extra padding beyond the minimum), but the raw markdown ended up
visibly over-indented relative to the actual depth — reading as two levels of indent by the
conventional 2-space-per-level eye, even though the parser only counted one.

Fix: `computeTabIndent` (`formatCommands.ts`) now computes the exact step from the syntax
tree instead of a hardcoded 4. New `markerPrefixWidth(state, item)` measures a ListItem's own
marker + trailing whitespace width from its marker line. For the ListItem's own marker line:
Tab uses the new `previousSiblingListItem(item)`'s width (the sibling being nested under);
Shift-Tab uses the new `parentListItem(item)`'s width (the parent being left) — both return
`null` up front when there's no such sibling/parent, which now doubles as the "nothing to
nest under" guard (previously only caught after-the-fact by the depth re-check). A wrapped
continuation line (no depth change) reuses its own item's marker width for a cosmetically
consistent shift. New `computeSingleLineIndentBy` replaces the reused `computeMultiLineIndent`
call for this path (parameterized amount instead of a flat 4; `computeMultiLineIndent` itself
is untouched, still used by the generic non-list and multi-line-selection paths). Also fixed
the `hasIndent` no-op guard, which checked `startsWith('    ')` (exactly 4 spaces) — with a
correct 2-space step this would have misfired, telling Shift-Tab a legitimately-nested 2-space
line had "no indent." Now checks for any leading space/tab. The existing depth-re-parse safety
net is kept as a defensive fallback (e.g. documents with non-standard/padded indentation).

Updated the affected tests' expected values (2-space bullet nesting, 3-space ordered nesting,
continuation-line shift) and re-pointed the two "second Tab is disabled" regression tests'
docstrings at their real cause (no sibling at the new depth, not overshoot — the fixtures now
use correctly-stepped indentation as their starting point). `npm run compile` clean;
`npm run test:unit` — 144/144 passing.

(Undocumented in this log until now, found while reading the current file state: at some
point between the above entry and the next one, `computeMultiLineListAwareIndent` was added
to `formatCommands.ts` — a list-aware version of `computeMultiLineIndent` for a *selection*
spanning multiple lines, generalizing the single-cursor marker-width step to that case, same
helpers (`markerPrefixWidth`/`previousSiblingListItem`/`parentListItem`), same atomic
disable-rather-than-partially-corrupt rule. `computeTabIndent` now delegates to it for
multi-line selections instead of the flat-4 `computeMultiLineIndent`. Not authored in this
session; noted here so the log stays the source of truth.)

**Third bounce-back from QA (still `implemented`, fix applied directly):** user reported that
indenting a numbered-list item renders the wrong depth-2 letter — e.g. indenting the 3rd
top-level item under the 2nd rendered "c." instead of "a.". Root cause: `computeOrderedMarkerLabel`
(`revealDecorations.ts`, from requirement #2) seeds a list's numbering from its *first child's
own typed digit* (`orderedListStartNumber`) — correct for a genuine "start at N" list, but
wrong here: nesting via Tab doesn't rewrite the moved item's digit (by design — marker family
is preserved, and only this idea's rendering layer, not the raw text, was ever meant to
change). So an item that was "3." at the top level is still literally "3." once Tab makes it
the first (and only) child of a brand-new nested list — and that stale "3" becomes the new
list's seed, rendering alpha(3) = "c." instead of alpha(1) = "a.". Only the "becomes sole
first child of a *new* list" case is wrong this way: nesting onto an EXISTING sibling list
appends the item as a non-first child, whose own digit the label computation never reads.

Fix: `computeTabIndent` (`formatCommands.ts`) now detects this specific case — marker line,
Tab (not Shift-Tab), item's own list is `OrderedList`, and the preceding sibling has no
existing `OrderedList`/`BulletList` child yet — and routes it through new
`computeOrderedNestIndentBy` instead of `computeSingleLineIndentBy`: same indent shift, plus
rewrites the moved item's own digit to "1" (keeping its delimiter) so it seeds the new list
correctly. Every other case (bullets; ordered items appended to an already-nested list;
Shift-Tab) is untouched. Updated the existing "ordered item nests under its preceding
sibling" test (it was itself hitting this exact bug — nesting "2." under "1." with no existing
sublist rendered "b." not "a." — now asserts the digit resets to "1"); added a new regression
test for the append-to-existing-sublist case (digit must NOT be touched there) and re-pointed
the "second Tab disabled" fixture at what a real first Tab now produces. `npm run compile`
clean; `npm run test:unit` — 151/151 passing.

**Fourth bounce-back from QA (still `in_qa`, fix applied directly):** extended the ordered-list digit-reset rule from the single-cursor Tab path to `computeMultiLineListAwareIndent` — multi-line selections that nest ordered items into a brand-new sublist now reset only the first mover's digit to `1` (later selected siblings in the same batch keep their digits, since they are not the list seed). Added `rewriteOrderedMarkerDigitToOne` + `shouldResetOrderedDigitForMultiLine` helpers and a regression test. Updated the sibling ordered-items width-alignment test expectations accordingly. `npm run compile` clean; formatCommands tests 66/66 passing.

## QA

Status: **completed** (2026-08-12). Four bugs found and fixed during QA (see Implementation Log). `npm run compile` clean; `formatCommands.test.mts` + `revealDecorations.test.mts` pass (list/ordered-marker/tab-indent coverage).

Smoke-test checklist (F5, sample `.md` file, Preview Edit mode):

- [x] Tab/Shift-Tab list-aware indent — found & fixed the overshoot-corrupts-structure bug.
- [x] Depth-cycling labels: 1./2./3. at depth 1, a./b./c. at depth 2, i./ii./iii. at depth 3, cycles back to decimal at depth 4 — `revealDecorations.test.mts` (`formatOrderedMarkerLabel`, nested depth test).
- [x] Auto-renumber after deleting/reordering an item (incl. via Alt+Up/Down) — positional widget numbering (`ordered marker: numbering is positional` test).
- [x] A `5. foo` start-at-5 list renders 5,6,7... — `ordered marker: seeds from the first item's own typed starting number` test.
- [x] `)`-delimiter lists (`1)` `2)`) render correctly — `ordered marker: ")" delimiter` test.
- [x] Checkbox items show no dash; plain bullet/numbered items unaffected — `checkbox dash` tests.
- [x] Click and arrow-key through multi-digit ordered markers (`12.`, `3)`) — cursor never rests inside — `computeOrderedMarkerRanges` tests + `orderedListAtomicRanges` registered in editor.
- [x] Toggle the reveal setting off/on — ordered-marker widget and its atomicity disappear/reappear together — wired in both `revealCompartment` sites per plan.
- [x] Enter on an empty list item (top-level and nested) exits/outdents — verified per plan (`insertNewlineContinueMarkup` built-in; no code needed).
