---
title: Line number gutter alignment
slug: line-number-gutter-alignment
status: completed
created: 2026-08-12
updated: 2026-08-12
---

# Line number gutter alignment

## Idea

It seems that there is a bit of a mismatch sometimes between the line indicator and where the actual text is rendered, or maybe where the line actually is and where the text is rendered. If they're not perfectly aligned, I feel like I'm actually clicking on a specific line, but it's going to the line underneath because they are not very well aligned. Let's review that and maybe fix it.

## Brainstorm

**Decision:** visual alignment fix only (option 1). No hover highlights, typography
rescale, wrapped-line indicators, or custom gutter over widgets.

**Problem:** In Preview Edit with line numbers on, gutter numbers can look
vertically offset from the text row they represent — especially on tall lines
(headings, callouts, fenced code). Users aim at a number but the caret lands on
the line below because the number doesn't sit where the eye expects.

**UX goal:** Each gutter number should appear vertically centered on its
corresponding text row so scanning the gutter feels 1:1 with the content.
Click-to-select-line behavior stays as today (stock CM6 `lineNumbers()` handler).

**Scope:**
- Fix alignment for all normal text lines CM6 already numbers (paragraphs,
  headings, lists, blockquotes, callout lines, fenced-code source lines).
- Keep existing subtle styling: `--text-faint`, 12px, right-aligned tabular nums.
- **Out of scope:** gutter numbers over block widgets (tables, mermaid, images,
  YAML frontmatter card) — unchanged from prior line-numbers QA; numbering gaps
  at widgets are acceptable.
- **Out of scope:** status bar `Ln X`, word-wrap continuation marks, hover
  preview, active-line gutter restyle beyond whatever falls out of the alignment
  fix.

**Success criteria (manual):**
- On a sample doc with mixed headings, paragraphs, lists, and a code fence,
  every visible gutter number lines up with the vertical center of its text row.
- Clicking a gutter number selects the line whose number was clicked (no
  off-by-one feel on plain and heading lines).
- No regression to gutter toggle, click handler, or widget skip behavior.

## Plan

1. **`src/webviews/md/livePreview/cm6Theme.ts`** — on `.cm-lineNumbers .cm-gutterElement`,
   add flexbox (`display: flex`, `alignItems: center`, `justifyContent: flex-end`) so
   the 12px digit centers vertically inside CM6's per-line gutter cell. No changes to
   `lineNumbers()` handler, settings, or message protocol.

## Implementation Log

- `src/webviews/md/livePreview/cm6Theme.ts` — flex-center line-number gutter cells
  (see inline comment). No deviations from plan.
- `npm run compile` — clean (0 type errors, 0 lint issues, bundle built).

**QA bounce-back (2026-08-12):** flex-center improved headings but paragraph gaps
still felt one line off (e.g. line 41 between paragraphs selected line 42). Root
causes: (1) CM6 gutter clicks resolve via the gutter cell's vertical midpoint, not
the click Y; (2) `.cm-scroller` vertical padding desynced gutter vs content positions.

- `src/webviews/md/livePreview/livePreviewEditor.ts` — gutter click maps
  `event.clientY` through `posAtCoords` on the content column so the selected line
  matches the row under the pointer.
- `src/webviews/md/livePreview/cm6Theme.ts` — move vertical padding from
  `.cm-scroller` to `.cm-content`; gutter numbers use first-row flex alignment +
  `lineHeight: 1.7` (not vertical center).
- `src/mdEditorProvider.ts` — `workspaceFolder?.uri.fsPath` (pre-existing tsc error
  blocking compile; unrelated one-liner).
- `npm run compile` — clean after bounce-back fix.

## QA

**Round 1 (2026-08-12):** flex-center helped but line 41/42 gap still misaligned —
click on perceived line 41 selected paragraph below. Bounced to implement (above).

**Round 2:** pending manual re-test — especially the line 41/42 paragraph-gap case.

**Round 2 feedback (2026-08-12):** still misaligned by line 31 (first content after YAML),
likely headings + cumulative drift.

**Round 3 fix:** CM6 height map ignores CSS margins on replace widgets and decorated
lines ([codemirror/dev#1164](https://github.com/codemirror/dev/issues/1164)). YAML card
`margin-bottom: 20px` pushed content down without moving gutters — constant offset from
~line 31 onward.

- `resources/md/mdWebview.css` — zero YAML card margin under `body.cm6-preview-active`.
- `src/webviews/md/livePreview/cm6Theme.ts` — replace widget/line margins with padding
  (frontmatter, mermaid, images, callouts); heading-sized gutter digits
  (`.cm-md-gutter-h1`…`h6`); `.cm-md-heading-line` weight.
- `src/webviews/md/livePreview/headingGutterSync.ts` — always-on heading line decorations
  + `gutterLineClass` markers (outside reveal compartment).
- `src/webviews/md/livePreview/livePreviewEditor.ts` — register heading gutter sync fields.
- `npm run compile` — clean.

**Round 4 (2026-08-12):** heading gutter `cm-md-gutter-heading` re-bases em to 15px;
reuses `.cm-md-hN` for per-level digit size matching content.

**Round 3:** pending re-test — line 31 after YAML, headings, paragraph gaps.

**Round 4 (2026-08-12):** heading gutter digits re-based to 15px editor font + shared
`.cm-md-hN` classes so numbers match heading text size (not 12px gutter em). User
confirmed alignment holds and heading numbers scale correctly.

**Outcome: passed** (2026-08-12). Gutter rows track content after YAML/widgets;
click selects the line under the pointer; body lines stay 12px faint; heading lines
show level-matched gutter digits.

**Post-complete polish (2026-08-12):** per-level gutter em sizing made H1 digits
~30px — too loud. Tried uniform 14px — still too large on H1/H2. Final: **all
gutter digits 12px** (same as body); removed gutter heading markers; scoped
`.cm-md-hN` font rules to `.cm-content` only so heading scale never hits the
gutter. Alignment unchanged.
