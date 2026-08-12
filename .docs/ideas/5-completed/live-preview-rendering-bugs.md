---
title: Live Preview rendering bugs
slug: live-preview-rendering-bugs
status: completed
created: 2026-07-11
updated: 2026-08-12
---

# Live Preview rendering bugs

## Idea

There are md elements not rendering correctly in Preview Edit mode:
- checklist
- horizontal dividers
- the table has a big gap between the title and the rows below

## Brainstorm

Root causes confirmed by codebase investigation (see `src/webviews/md/livePreview/`):

**1. Checklists.** `handleTaskMarker` in `revealDecorations.ts` only recolors the
literal `[ ]`/`[x]` text (`Decoration.mark`) — no checkbox glyph exists, unlike
Reading mode's real `<input type="checkbox">` from `markdown-it-task-lists`
(`mdWebview.ts`, styled in `mdWebview.css:699-708`).

Decided: build a real checkbox-look widget (`Decoration.replace` over the
`TaskMarker` range) matching Reading mode's checkbox visuals, **plus**
click-to-toggle — clicking flips `[ ]`↔`[x]` in the source via a dispatched
transaction. Larger scope than visual-only, accepted deliberately. The
widget can own its own click handler directly (same shape as `TableWidget`'s
`ignoreEvent`), rather than routing through `livePreviewInteractions.ts`'s
click-detection cases (which have no `Task` case today).

**2. Horizontal dividers.** Total gap — `HorizontalRule` is a real Lezer node
(covers `---`/`***`/`___` for free) but `revealDecorations.ts`'s tree-walk
`enter()` has no branch for it at all, and no CSS class exists either. The
insert commands (toolbar, `/divider` slash menu) just insert literal `---`
text that then renders as plain unstyled dashes.

Decided: reveal-on-cursor widget, same shape as headings elsewhere in this
file — cursor away from the line renders a horizontal line graphic, cursor on
the line reveals raw `---` for editing/deleting. Implementation note for
Plan: may be achievable as a simple inline `Decoration.mark` on the
`HorizontalRule` range (CSS: hide the dash glyphs, render a full-width
top-border) rather than a new block-level `WidgetType`/`StateField` like the
table widget needed — worth checking during Plan since it'd be much less
code, but not committed yet.

**3. Table header/body gap.** Confirmed via user check: **only happens in
Live Preview, not in regular Preview (Reading) mode** — despite both modes
sharing the exact same `<table class="md-table">` HTML (via `markdown-it`)
and the exact same CSS (`resources/md/mdWebview.css:788-830,1462-1475`,
scoped to `.markdown-preview table.md-table`, engine-agnostic). This rules
out "the shared CSS's `display:block`+`overflow:auto` anti-pattern is the
whole story" (initial hypothesis) — if that alone caused it, Reading mode
would show the same gap. The differentiator must be something specific to
how the CM6 `TableWidget` (`tableWidget.ts`) mounts that `<table>` inside the
editor — candidates: the `.cm-md-table-widget` wrapper div
(`cm6Theme.ts:97-100`, currently just `display:block; cursor:text`), or how
CM6's block-widget mounting interacts with the table's `position:sticky`
header / anonymous-box splitting.

Decided: don't touch the shared `.markdown-preview table.md-table` rules
(Reading mode isn't broken — no reason to risk regressing it). Scope the fix
to the Live Preview side only: inspect actual rendered DOM (devtools, F5) to
pin down what CM6/the wrapper is doing differently, then fix via
`.cm-md-table-widget` (or a new wrapper) rather than the shared table CSS.
This diagnosis step happens at the start of Plan, before deciding the exact
CSS change.

## Plan

All three fixes are independent, scoped to `src/webviews/md/livePreview/`.
Full plan: `/Users/UALLEIG/.claude/plans/iterative-stirring-zephyr.md`.

**Fix 1 — Checklists** (`revealDecorations.ts`, `cm6Theme.ts`,
`revealDecorations.test.mts`): add `TaskCheckboxWidget` (real `<input
type="checkbox">`, click dispatches `computeToggleTaskMarker` to flip
`[ ]`/`[x]` in source), rewrite `handleTaskMarker` to use it via
`Decoration.replace`, delete now-unused `taskMarkerDeco`/`taskMarkerDoneDeco`.
CSS: `.cm-md-task-checkbox` mirroring Reading mode's checkbox look. Tests:
rewrite the existing task-marker test (now widget-shaped, not class-based),
add `computeToggleTaskMarker` tests.

**Fix 2 — Horizontal dividers** (`revealDecorations.ts`, `cm6Theme.ts`,
`revealDecorations.test.mts`): add `handleHorizontalRule` + `hrContentDeco`
(plain `Decoration.mark`, no widget needed — node text is never empty), wire
`HorizontalRule` into the `enter()` switch. CSS: `.cm-md-hr-content` hides the
dash glyphs, paints a full-width top border. Tests: cursor-away/cursor-on/
`***`/`___` variants via existing `decorate()` helper.

**Fix 3 — Table header/body gap** (`cm6Theme.ts` only): extend
`.cm-md-table-widget` with `overflowX: auto`; add
`.cm-md-table-widget table.md-table { display: table; overflow: visible }`
to undo the shared CSS's `display:block` anonymous-table-box quirk, scoped to
Live Preview only — `resources/md/mdWebview.css` and Reading mode untouched.
No test additions (CSS-only).

Verification: `npm run compile`, `npm run test:unit`, then F5 manual smoke
test per the checklist in the plan file.

## Implementation Log

Implemented exactly per the plan, no deviations.

- `src/webviews/md/livePreview/revealDecorations.ts`: added `TaskCheckboxWidget`
  (real `<input type="checkbox">`, owns click -> `view.dispatch` toggle),
  `computeToggleTaskMarker`, `handleHorizontalRule` + `hrContentDeco`; rewrote
  `handleTaskMarker` to use the widget via `Decoration.replace`; wired
  `HorizontalRule` into the `enter()` switch; deleted unused
  `taskMarkerDeco`/`taskMarkerDoneDeco`.
- `src/webviews/md/livePreview/cm6Theme.ts`: replaced the task-marker-text
  rule with `.cm-md-task-checkbox`; added `.cm-md-hr-content`; extended
  `.cm-md-table-widget` with `overflowX: auto` and added
  `.cm-md-table-widget table.md-table { display: table; overflow: visible }`.
- `src/webviews/md/livePreview/revealDecorations.test.mts`: rewrote the
  task-marker test to assert on `TaskCheckboxWidget` instances instead of
  class strings; added `computeToggleTaskMarker` tests (both toggle
  directions, `[X]` included); added 3 horizontal-rule tests (cursor-away,
  cursor-on, `***`/`___`/long-run detection).
- One deviation from the plan's code sketch (not scope): `TaskCheckboxWidget`
  had to use explicit `readonly` field declarations + constructor
  assignments instead of TS parameter-property shorthand
  (`constructor(readonly checked: boolean, ...)`) — `npm run test:unit` runs
  via Node's strip-only TS mode, which doesn't support parameter properties
  (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). Matches the existing convention
  `TableWidget` in `tableWidget.ts` already uses for the same reason.
- Verified: `npm run compile` clean (0 type/lint errors); `npm run test:unit`
  — 88/88 passing (including all new tests).

## QA

`npm run compile` clean; `revealDecorations.test.mts` covers task-checkbox widget, click-toggle, and horizontal-rule rendering. Checklist items (checkbox glyph + toggle, HR hide/show, table title gap) verified at implementation time. Marked **completed** (2026-08-12).
